import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { CommandTier, isAdmin } from '../../core/permissions.js';
import { memberHistoryManager } from '../../stores/memberHistoryManager.js';
import { activityManager } from '../../stores/activityManager.js';
import { formatDate, formatDuration } from '../../utils/format.js';

export default {
  tier: CommandTier.EVERYONE,
  data: new SlashCommandBuilder()
    .setName('정보')
    .setDescription('내 정보를 확인합니다. (본인에게만 표시)')
    .addUserOption(opt =>
      opt
        .setName('유저')
        .setDescription('정보를 확인할 유저 (비워두면 본인 정보, 다른 유저는 관리자만 조회 가능 · 본인에게만 표시)')
    ),

  /** @param {import('discord.js').ChatInputCommandInteraction} interaction */
  async execute(interaction) {
    if (!interaction.guild) {
      return interaction.reply({ content: '❌ 서버 안에서만 사용할 수 있습니다.', ephemeral: true });
    }

    const targetUser = interaction.options.getUser('유저') || interaction.user;
    const isSelf = targetUser.id === interaction.user.id;

    // 다른 유저의 정보는 관리자만 조회 가능
    if (!isSelf && !isAdmin(interaction)) {
      return interaction.reply({
        content: '🔒 다른 유저의 정보는 관리자만 볼 수 있습니다. 본인 정보는 유저를 비우고 `/정보` 를 실행하면 확인할 수 있습니다.',
        ephemeral: true,
      });
    }

    let member = interaction.options.getMember('유저') || (isSelf ? interaction.member : null);

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

      embed.setFooter({ text: '활동·입장 횟수·닉네임 변경은 봇 도입 이후 기록만 집계 · 서버 AFK 채널 시간 제외' }).setTimestamp();

      // 본인 조회, 관리자의 다른 유저 조회 모두 실행한 사람에게만 보이는 메시지로 표시
      await interaction.reply({ embeds: [embed], ephemeral: true });
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
