import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { CommandTier, ADMIN_DEFAULT_PERMISSION } from '../../utils/permissions.js';
import { settingsManager } from '../../utils/settingsManager.js';
import { MESSAGE_VARIABLES } from '../../utils/memberNotifications.js';

const TARGETS = {
  입장: { settingKey: 'welcomeMessage', label: '입장(환영) 문구', emoji: '👋' },
  퇴장: { settingKey: 'leaveMessage', label: '퇴장 문구', emoji: '🚪' },
};

export default {
  tier: CommandTier.ADMIN,
  data: new SlashCommandBuilder()
    .setName('알림문구')
    .setDescription('입장/퇴장 알림에 사용할 메시지 문구를 설정합니다.')
    .setDefaultMemberPermissions(ADMIN_DEFAULT_PERMISSION)
    .addSubcommand(sub =>
      sub
        .setName('입장')
        .setDescription('입장(환영) 알림 문구를 설정합니다.')
        .addStringOption(opt =>
          opt
            .setName('문구')
            .setDescription('메시지 템플릿 ({user}, {userName}, {server}, {joinedAt}, {joinCount}, {isRejoin} 등)')
            .setRequired(true)
            .setMaxLength(1000)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('퇴장')
        .setDescription('퇴장 알림 문구를 설정합니다.')
        .addStringOption(opt =>
          opt
            .setName('문구')
            .setDescription('메시지 템플릿 ({user}, {userName}, {server}, {joinedAt}, {accountAge} 등)')
            .setRequired(true)
            .setMaxLength(1000)
        )
    )
    .addSubcommand(sub => sub.setName('확인').setDescription('현재 설정된 입장/퇴장 문구와 미리보기를 확인합니다.')),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const guild = interaction.guild;
    if (!guild) {
      return interaction.reply({ content: '❌ 서버 안에서만 사용할 수 있습니다.', ephemeral: true });
    }
    const guildId = guild.id;

    const preview = template =>
      settingsManager.formatMessage(template, { member: interaction.member, guild }) || '없음';

    // 1. 문구 설정
    if (TARGETS[subcommand]) {
      const target = TARGETS[subcommand];
      const text = interaction.options.getString('문구');
      settingsManager.updateGuildSettings(guildId, { [target.settingKey]: text });

      const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle(`✅ ${target.label} 설정 완료`)
        .addFields(
          { name: '📝 설정된 원본 템플릿', value: `\`\`\`${text}\`\`\`` },
          { name: '👀 미리보기 (현재 관리자 기준)', value: preview(text) }
        )
        .setFooter({ text: `지원 변수: ${MESSAGE_VARIABLES}` })
        .setTimestamp();
      return interaction.reply({ embeds: [embed] });
    }

    // 2. 확인
    if (subcommand === '확인') {
      const settings = settingsManager.getGuildSettings(guildId);
      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('⚙️ 입장 / 퇴장 알림 문구')
        .addFields(
          { name: '👋 입장 문구', value: `\`\`\`${settings.welcomeMessage || '없음'}\`\`\`` },
          { name: '👀 입장 미리보기', value: preview(settings.welcomeMessage) },
          { name: '🚪 퇴장 문구', value: `\`\`\`${settings.leaveMessage || '없음'}\`\`\`` },
          { name: '👀 퇴장 미리보기', value: preview(settings.leaveMessage) }
        )
        .setFooter({ text: `지원 변수: ${MESSAGE_VARIABLES}` })
        .setTimestamp();
      return interaction.reply({ embeds: [embed] });
    }
  },
};
