import { EmbedBuilder, Events } from 'discord.js';
import { settingsManager } from '../../stores/settingsManager.js';
import { memberHistoryManager } from '../../stores/memberHistoryManager.js';
import { formatDateTime } from '../../utils/format.js';

/** 닉네임이 없을 때 표시할 이름 (서버 닉네임 미설정 → 디스코드 표시 이름) */
function displayNickname(nickname, user) {
  if (nickname) return nickname;
  const base = user?.globalName || user?.username || '알 수 없음';
  return `${base} (닉네임 없음)`;
}

/**
 * 멤버 정보 변경 감지 → 서버 닉네임 변경 시 로그 채널 기록 및 이력 저장
 */
export default {
  name: Events.GuildMemberUpdate,
  /**
   * @param {import('discord.js').GuildMember | import('discord.js').PartialGuildMember} oldMember
   * @param {import('discord.js').GuildMember} newMember
   */
  async execute(oldMember, newMember) {
    // 캐시에 없던 멤버는 이전 닉네임을 알 수 없으므로 비교 불가
    if (oldMember.partial) return;
    if (oldMember.nickname === newMember.nickname) return;
    if (newMember.user?.bot) return;

    const guild = newMember.guild;
    const changedAt = Date.now();
    const before = displayNickname(oldMember.nickname, newMember.user);
    const after = displayNickname(newMember.nickname, newMember.user);

    console.log(`[NickLog] ${newMember.user.tag}: "${before}" → "${after}"`);

    // 1. 내부 이력 저장 (/userinfo 표시용)
    try {
      memberHistoryManager.recordNicknameChange(guild.id, newMember.id, {
        at: changedAt,
        from: oldMember.nickname ?? null,
        to: newMember.nickname ?? null,
      });
    } catch (error) {
      console.error('[NickLog] 이력 저장 오류:', error);
    }

    // 2. 로그 채널 기록
    const settings = settingsManager.getGuildSettings(guild.id);
    const channelId = settingsManager.resolveId(settings, 'nicknameLogChannelId');
    if (!channelId) return;

    try {
      const channel = guild.channels.cache.get(channelId);
      if (!channel || !channel.isTextBased()) {
        console.warn(`[NickLog] 로그 채널(${channelId})을 찾을 수 없습니다.`);
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(0xFEE75C)
        .setTitle('✏️ 닉네임 변경')
        .setThumbnail(newMember.displayAvatarURL({ size: 128 }))
        .addFields(
          { name: '👤 유저', value: `${newMember}`, inline: false },
          { name: '변경 전', value: before, inline: true },
          { name: '변경 후', value: after, inline: true },
          { name: '🕒 변경 시각', value: formatDateTime(changedAt), inline: false }
        )
        .setFooter({ text: guild.name })
        .setTimestamp(changedAt);

      await channel.send({ embeds: [embed] });
    } catch (error) {
      console.error('[NickLog] 로그 전송 실패:', error);
    }
  },
};
