import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { CommandTier } from '../../utils/permissions.js';
import { memberHistoryManager } from '../../utils/memberHistoryManager.js';
import {
  activityManager,
  POINTS_PER_MESSAGE,
  POINTS_PER_VOICE_MINUTE,
  MESSAGE_POINT_COOLDOWN_MS,
} from '../../utils/activityManager.js';

/** 초 단위 시간을 "N시간 M분" 형태로 변환 */
export function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours === 0 && minutes === 0) return seconds > 0 ? '1분 미만' : '0분';
  if (hours === 0) return `${minutes}분`;
  return minutes > 0 ? `${hours.toLocaleString()}시간 ${minutes}분` : `${hours.toLocaleString()}시간`;
}

/** 타임스탬프(ms)를 디스코드 절대 + 상대 시간 표기로 변환 */
function formatDate(timestamp) {
  if (!timestamp) return '알 수 없음';
  const sec = Math.floor(timestamp / 1000);
  return `<t:${sec}:D> (<t:${sec}:R>)`;
}

export default {
  tier: CommandTier.EVERYONE,
  data: new SlashCommandBuilder()
    .setName('유저정보')
    .setDescription('유저의 기본 정보와 서버 활동(포인트, 활동일, 입장일 등)을 확인합니다.')
    .addUserOption(opt =>
      opt
        .setName('유저')
        .setDescription('정보를 확인할 유저 (비워두면 본인)')
    ),

  async execute(interaction) {
    if (!interaction.guild) {
      return interaction.reply({ content: '❌ 서버 안에서만 사용할 수 있습니다.', ephemeral: true });
    }

    const targetUser = interaction.options.getUser('유저') || interaction.user;
    let member = interaction.options.getMember('유저') || (targetUser.id === interaction.user.id ? interaction.member : null);

    // 캐시에 없으면 API로 조회
    if (!member) {
      member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    }
    if (!member) {
      return interaction.reply({ content: '❌ 해당 유저는 이 서버의 멤버가 아닙니다.', ephemeral: true });
    }

    try {
      const guildId = interaction.guild.id;
      const activity = activityManager.getUserActivity(guildId, member.id);
      const history = memberHistoryManager.getGuildHistory(guildId)[member.id];
      const joinCount = memberHistoryManager.getJoinCount(guildId, member.id);
      const nicknameHistory = memberHistoryManager.getNicknameHistory(guildId, member.id);

      // 역할 목록 (@everyone 제외, 높은 순)
      const roles = member.roles.cache
        .filter(role => role.id !== interaction.guild.id)
        .sort((a, b) => b.position - a.position);
      const MAX_ROLES_SHOWN = 10;
      const rolesText = roles.size
        ? roles.map(r => `${r}`).slice(0, MAX_ROLES_SHOWN).join(' ') +
          (roles.size > MAX_ROLES_SHOWN ? ` 외 ${roles.size - MAX_ROLES_SHOWN}개` : '')
        : '없음';

      const now = Date.now();
      const accountAgeDays = Math.floor((now - member.user.createdTimestamp) / 86_400_000);
      const memberDays = member.joinedTimestamp ? Math.floor((now - member.joinedTimestamp) / 86_400_000) : null;

      const rejoinText = joinCount > 1 ? `${joinCount}회 (재입장)` : '1회 (최초 입장)';
      const historyLines = [
        `• 서버 입장일: ${formatDate(member.joinedTimestamp)}`,
        memberDays !== null ? `• 함께한 기간: **${memberDays.toLocaleString()}일**` : null,
        `• 입장 횟수: **${rejoinText}**`,
        history?.firstJoinedAt && joinCount > 1 ? `• 최초 입장 기록: ${formatDate(history.firstJoinedAt)}` : null,
        history?.lastLeftAt ? `• 마지막 퇴장: ${formatDate(history.lastLeftAt)}` : null,
      ].filter(Boolean);

      const activityLines = [
        `• 포인트: **${(activity.points || 0).toLocaleString()}점**`,
        `• 활동일: **${(activity.activeDays || 0).toLocaleString()}일**`,
        `• 메시지: ${(activity.messages || 0).toLocaleString()}개`,
        `• 음성 채널: ${formatDuration(activity.voiceSeconds)}`,
        `• 마지막 활동: ${activity.lastActiveAt ? `<t:${Math.floor(activity.lastActiveAt / 1000)}:R>` : '기록 없음'}`,
      ];

      const embed = new EmbedBuilder()
        .setColor(member.displayHexColor && member.displayHexColor !== '#000000' ? member.displayHexColor : 0x5865F2)
        .setAuthor({ name: `${member.displayName} 님의 정보`, iconURL: member.user.displayAvatarURL({ size: 64 }) })
        .setThumbnail(member.displayAvatarURL({ size: 256 }))
        .addFields(
          {
            name: '👤 기본 정보',
            value: [
              `• 이름: **${member.displayName}**`,
              `• 유저명: ${member.user.tag}`,
              `• ID: \`${member.id}\``,
              `• 계정 생성일: ${formatDate(member.user.createdTimestamp)} · ${accountAgeDays.toLocaleString()}일 경과`,
              member.user.bot ? '• 🤖 봇 계정' : null,
              member.premiumSince ? `• 💎 서버 부스트 중 (${formatDate(member.premiumSinceTimestamp)})` : null,
            ].filter(Boolean).join('\n'),
          },
          { name: '📅 서버 기록', value: historyLines.join('\n') },
          { name: '📊 활동', value: activityLines.join('\n') },
          { name: `🎭 역할 (${roles.size}개)`, value: rolesText }
        );

      // 최근 닉네임 변경 이력 (최대 3건)
      if (nicknameHistory.length) {
        const MAX_SHOWN = 3;
        const lines = nicknameHistory.slice(0, MAX_SHOWN).map(h => {
          const from = h.from ?? '(닉네임 없음)';
          const to = h.to ?? '(닉네임 없음)';
          return `• <t:${Math.floor(h.at / 1000)}:d> ${from} → **${to}**`;
        });
        if (nicknameHistory.length > MAX_SHOWN) lines.push(`… 외 ${nicknameHistory.length - MAX_SHOWN}건`);
        embed.addFields({ name: `✏️ 최근 닉네임 변경 (${nicknameHistory.length}건)`, value: lines.join('\n') });
      }

      embed
        .setFooter({
          text: `포인트: 메시지 1개 ${POINTS_PER_MESSAGE}점(${MESSAGE_POINT_COOLDOWN_MS / 1000}초 쿨다운) · 음성 1분 ${POINTS_PER_VOICE_MINUTE}점 · 봇 도입 이후 활동만 집계`,
        })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      console.error('[Command:userinfo] 에러:', error);
      const errorMsg = { content: '❌ 유저 정보를 불러오는 중 오류가 발생했습니다.', ephemeral: true };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(errorMsg).catch(() => {});
      } else {
        await interaction.reply(errorMsg).catch(() => {});
      }
    }
  },
};
