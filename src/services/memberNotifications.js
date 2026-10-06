import { EmbedBuilder } from 'discord.js';
import { settingsManager } from '../stores/settingsManager.js';
import { formatDateTime, formatStayDuration } from '../utils/format.js';

/**
 * 입장(환영) 알림 임베드 생성 — 실제 입장 이벤트와 /테스트 입장알림 이 공유
 * @param {object} params
 * @param {import('discord.js').GuildMember} params.member 대상 멤버
 * @param {import('discord.js').Guild} params.guild 서버
 * @param {object} params.settings 서버 설정 (welcomeMessage 사용)
 * @param {number} params.joinCount 입장 횟수
 * @param {boolean} [params.test] 테스트 발송 여부
 * @param {string} [params.testerTag] 테스트 발송자 태그
 */
export function buildWelcomeEmbed({ member, guild, settings, joinCount, test = false, testerTag = '' }) {
  const description = settingsManager.formatMessage(settings.welcomeMessage, { member, guild, joinCount });
  const isRejoin = joinCount > 1;
  const isRejoinText = isRejoin ? `⚠️ 재입장 (${joinCount}회차)` : '✨ 최초 입장';
  // 실제 입장 시각 (테스트나 캐시 누락 시 현재 시각)
  const joinedAt = test ? Date.now() : member.joinedTimestamp || Date.now();

  return new EmbedBuilder()
    .setColor(isRejoin ? 0xFEE75C : 0x57F287)
    .setTitle((isRejoin ? '🔁 멤버가 다시 입장했습니다' : '🎉 새로운 멤버가 입장했습니다!') + (test ? ' (테스트)' : ''))
    .setDescription(description || '​')
    .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
    .addFields(
      { name: '👤 유저명', value: member.user.tag, inline: true },
      { name: '📊 입장 횟수', value: isRejoinText, inline: true },
      { name: '🕒 입장 시각', value: formatDateTime(joinedAt), inline: false }
    )
    .setFooter({ text: test ? `테스트 발송 by ${testerTag}` : guild.name })
    .setTimestamp();
}

/**
 * 퇴장 알림 임베드 생성 — 실제 퇴장 이벤트와 /테스트 퇴장알림 이 공유
 */
export function buildLeaveEmbed({ member, guild, settings, joinCount, test = false, testerTag = '' }) {
  const description = settingsManager.formatMessage(settings.leaveMessage, { member, guild, joinCount });
  const leftAt = Date.now();
  // 퇴장 이벤트의 멤버 객체는 캐시가 없으면 입장 시각을 모를 수 있음
  const joinedAt = member.joinedTimestamp || null;

  const fields = [
    { name: '👤 유저명', value: member.user.tag, inline: true },
    { name: '⏳ 함께한 기간', value: joinedAt ? formatStayDuration(joinedAt, leftAt) : '알 수 없음', inline: true },
    { name: '🕒 퇴장 시각', value: formatDateTime(leftAt), inline: false },
  ];
  if (joinedAt) fields.push({ name: '📅 입장했던 시각', value: formatDateTime(joinedAt), inline: false });

  return new EmbedBuilder()
    .setColor(0xED4245)
    .setTitle('👋 멤버가 서버를 떠났습니다' + (test ? ' (테스트)' : ''))
    .setDescription(description || '​')
    .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
    .addFields(fields)
    .setFooter({ text: test ? `테스트 발송 by ${testerTag}` : guild.name })
    .setTimestamp();
}

/** 입장/퇴장 문구에서 지원하는 변수 목록 (안내용) */
export const MESSAGE_VARIABLES =
  '{user}, {userName}, {userTag}, {userId}, {server}, {count}, {joinedAt}, {joinedAtRelative}, {createdAt}, {accountAge}, {joinCount}, {isRejoin}';
