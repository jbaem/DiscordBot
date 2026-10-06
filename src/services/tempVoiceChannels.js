import { RESTJSONErrorCodes } from 'discord.js';
import { tempVoiceManager } from '../stores/tempVoiceManager.js';
import { DEFAULT_VOICE_NAME_TEMPLATE } from '../stores/settingsManager.js';
import { fillTemplate } from '../utils/template.js';

/** 임시 음성방 이름 생성 (디스코드 채널 이름 최대 100자) */
export function buildTempVoiceName(template, member, guild) {
  const name = fillTemplate(template || DEFAULT_VOICE_NAME_TEMPLATE, {
    user: member.displayName,
    userName: member.displayName,
    server: guild.name,
  });
  return name.slice(0, 100) || member.displayName;
}

/**
 * 임시 음성 채널 삭제 후 목록에서 제거
 * - 삭제에 실패하면 목록에 남겨 두어 다음 퇴장 이벤트나 재시작 시 다시 정리되도록 함
 * - 이미 삭제된 채널(Unknown Channel)은 목록에서만 제거
 */
export async function deleteTempChannel(channel, reason) {
  try {
    await channel.delete(reason);
    tempVoiceManager.removeChannel(channel.id);
    console.log(`[TempVoice] 빈 임시 음성 채널 삭제 완료 (${channel.name})`);
  } catch (error) {
    if (error.code === RESTJSONErrorCodes.UnknownChannel) {
      tempVoiceManager.removeChannel(channel.id);
      return;
    }
    console.error('[TempVoice] 임시 채널 삭제 오류:', error);
  }
}

/**
 * 봇 시작 시 저장된 임시 채널 정리
 * - 이미 삭제된 채널: 목록에서 제거
 * - 봇이 꺼져 있는 동안 비어 버린 채널: 채널 삭제 후 목록에서 제거
 * @param {import('discord.js').Client} client
 * @returns {Promise<{ kept: number, deleted: number, forgotten: number }>}
 */
export async function reconcileTempChannels(client) {
  const result = { kept: 0, deleted: 0, forgotten: 0 };

  for (const [channelId, info] of tempVoiceManager.entries()) {
    const guild = client.guilds.cache.get(info.guildId);
    // 디스코드 장애로 서버 정보를 받지 못한 경우에는 판단을 미룸
    if (guild && !guild.available) {
      result.kept++;
      continue;
    }
    // 봇이 더 이상 참여하지 않는 서버의 채널은 관리할 수 없으므로 잊음
    // (ready 시점에는 Guilds 인텐트로 모든 채널이 캐시되어 있으므로 API 조회 없이 캐시만 확인)
    const channel = guild?.channels.cache.get(channelId) ?? null;

    if (!channel) {
      tempVoiceManager.removeChannel(channelId);
      result.forgotten++;
      continue;
    }
    if (channel.members.size > 0) {
      result.kept++;
      continue;
    }

    // 삭제에 실패하면 목록에 남겨 두고, 다음 퇴장 이벤트 또는 재시작 때 다시 시도
    await deleteTempChannel(channel, '봇 재시작 중 비어 있던 임시 음성 채널 정리');
    if (tempVoiceManager.isTempChannel(channelId)) result.kept++;
    else result.deleted++;
  }

  return result;
}
