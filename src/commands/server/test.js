import { SlashCommandBuilder } from 'discord.js';
import { CommandTier, ADMIN_DEFAULT_PERMISSION } from '../../core/permissions.js';
import { settingsManager } from '../../stores/settingsManager.js';
import { memberHistoryManager } from '../../stores/memberHistoryManager.js';
import { buildWelcomeEmbed, buildLeaveEmbed } from '../../services/memberNotifications.js';
import { resolveLinkedChannelId } from '../../services/channelLinks.js';

/** 테스트 종류별 정의 */
const TESTS = {
  입장알림: {
    linkName: '입장알림',
    label: '입장(환영) 알림',
    build: params => buildWelcomeEmbed(params),
  },
  퇴장알림: {
    linkName: '퇴장알림',
    label: '퇴장 알림',
    build: params => buildLeaveEmbed(params),
  },
};

export default {
  tier: CommandTier.ADMIN,
  data: new SlashCommandBuilder()
    .setName('테스트')
    .setDescription('설정된 알림을 실제 채널로 테스트 전송합니다.')
    .setDefaultMemberPermissions(ADMIN_DEFAULT_PERMISSION)
    .addSubcommand(sub => sub.setName('입장알림').setDescription('연결된 입장 알림 채널로 환영 메시지를 테스트 전송합니다.'))
    .addSubcommand(sub => sub.setName('퇴장알림').setDescription('연결된 퇴장 알림 채널로 퇴장 메시지를 테스트 전송합니다.')),

  /** @param {import('discord.js').ChatInputCommandInteraction} interaction */
  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const guild = interaction.guild;
    if (!guild) {
      return interaction.reply({ content: '❌ 서버 안에서만 사용할 수 있습니다.', ephemeral: true });
    }

    const test = TESTS[subcommand];
    if (!test) {
      return interaction.reply({ content: '❌ 알 수 없는 테스트 종류입니다.', ephemeral: true });
    }

    const settings = settingsManager.getGuildSettings(guild.id);
    const channelId = resolveLinkedChannelId(settings, test.linkName);
    if (!channelId) {
      return interaction.reply({
        content: `❌ 먼저 \`/연결 채널 ${test.linkName}\` 명령어로 알림 채널을 연결해 주세요.`,
        ephemeral: true,
      });
    }

    const channel = guild.channels.cache.get(channelId);
    if (!channel || !channel.isTextBased()) {
      return interaction.reply({
        content: '❌ 연결된 채널을 찾을 수 없습니다. `/연결 채널` 로 채널을 다시 연결해 주세요.',
        ephemeral: true,
      });
    }

    try {
      const embed = test.build({
        member: interaction.member,
        guild,
        settings,
        joinCount: memberHistoryManager.getJoinCount(guild.id, interaction.user.id),
        invite: { type: 'test', inviterId: interaction.user.id }, // 입장 알림의 초대 칸 예시 (퇴장 알림은 사용 안 함)
        test: true,
        testerTag: interaction.user.tag,
      });

      await channel.send({ embeds: [embed] });
      return interaction.reply({
        content: `✅ ${channel} 채널로 ${test.label} 테스트 메시지를 발송했습니다!`,
        ephemeral: true,
      });
    } catch (error) {
      console.error(`[Test] ${test.label} 테스트 전송 실패:`, error);
      return interaction.reply({
        content: '❌ 테스트 메시지를 보내는 중 오류가 발생했습니다. 봇의 채널 권한을 확인해 주세요.',
        ephemeral: true,
      });
    }
  },
};
