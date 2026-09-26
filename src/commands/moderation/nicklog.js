import { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder } from 'discord.js';
import { settingsManager } from '../../utils/settingsManager.js';

export default {
  data: new SlashCommandBuilder()
    .setName('nicklog')
    .setDescription('멤버 닉네임 변경 이력을 기록할 채널을 설정합니다.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sub =>
      sub
        .setName('channel')
        .setDescription('닉네임 변경 로그를 남길 텍스트 채널을 지정합니다.')
        .addChannelOption(opt =>
          opt
            .setName('target')
            .setDescription('로그를 기록할 텍스트 채널')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName('view').setDescription('현재 닉네임 로그 설정을 확인합니다.')
    )
    .addSubcommand(sub =>
      sub.setName('disable').setDescription('닉네임 변경 로그 기록을 비활성화합니다.')
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const guild = interaction.guild;
    if (!guild) {
      return interaction.reply({ content: '❌ 서버 안에서만 사용할 수 있습니다.', ephemeral: true });
    }
    const settings = settingsManager.getGuildSettings(guild.id);

    if (subcommand === 'channel') {
      const channel = interaction.options.getChannel('target');
      const perms = channel.permissionsFor(guild.members.me);
      if (!perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
        return interaction.reply({
          content: `❌ 봇에 ${channel} 채널의 **채널 보기 / 메시지 보내기 / 링크 임베드** 권한이 필요합니다.`,
          ephemeral: true,
        });
      }

      settingsManager.updateGuildSettings(guild.id, { nicknameLogChannelId: channel.id });

      const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle('✅ 닉네임 로그 채널 설정 완료')
        .setDescription(`이제 멤버가 서버 닉네임을 바꾸면 ${channel} 채널에 변경 시각과 변경 전/후 이름이 기록됩니다.`)
        .setTimestamp();
      return interaction.reply({ embeds: [embed] });
    }

    if (subcommand === 'view') {
      const channelId = settings.nicknameLogChannelId;
      const channel = channelId ? guild.channels.cache.get(channelId) : null;
      let status;
      if (!channelId) status = '🚫 비활성화 (채널 미지정)';
      else if (!channel) status = `⚠️ 설정된 채널(\`${channelId}\`)이 서버에 없습니다. 다시 지정해 주세요.`;
      else status = `✅ ${channel} 채널에 기록 중`;

      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('⚙️ 닉네임 변경 로그 설정')
        .addFields(
          { name: '상태', value: status },
          { name: '기록 내용', value: '변경 시각 · 변경 전 이름 · 변경 후 이름 · 유저 정보\n(최근 변경 이력은 `/userinfo` 에서도 확인할 수 있습니다)' }
        )
        .setTimestamp();
      return interaction.reply({ embeds: [embed] });
    }

    if (subcommand === 'disable') {
      settingsManager.updateGuildSettings(guild.id, { nicknameLogChannelId: null });
      const embed = new EmbedBuilder()
        .setColor(0xED4245)
        .setTitle('🚫 닉네임 로그 비활성화')
        .setDescription('닉네임 변경 로그를 더 이상 채널에 기록하지 않습니다. (`/userinfo` 용 내부 이력은 계속 저장됩니다)')
        .setTimestamp();
      return interaction.reply({ embeds: [embed] });
    }
  },
};
