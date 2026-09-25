import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';

export default {
  data: new SlashCommandBuilder()
    .setName('slowmode')
    .setDescription('현재 채널의 메시지 전송 간격(슬로우 모드)을 설정합니다.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addIntegerOption(option =>
      option
        .setName('seconds')
        .setDescription('슬로우 모드 시간(초 단위, 0초는 해제, 최대 21600초/6시간)')
        .setRequired(true)
        .setMinValue(0)
        .setMaxValue(21600)
    ),
  async execute(interaction) {
    const seconds = interaction.options.getInteger('seconds');

    if (!interaction.channel || !interaction.channel.isTextBased()) {
      return interaction.reply({
        content: '❌ 텍스트 채널에서만 사용할 수 있는 명령어입니다.',
        ephemeral: true,
      });
    }

    try {
      await interaction.channel.setRateLimitPerUser(
        seconds,
        `슬로우 모드 설정 by ${interaction.user.tag}`
      );

      const embed = new EmbedBuilder()
        .setColor(seconds === 0 ? 0x57F287 : 0xFEE75C)
        .setTitle(seconds === 0 ? '⚡ 슬로우 모드 해제' : '⏱️ 슬로우 모드 적용')
        .setDescription(
          seconds === 0
            ? '슬로우 모드가 해제되어 자유롭게 대화할 수 있습니다.'
            : `이제 사용자는 **${seconds}초**마다 한 번씩만 메시지를 보낼 수 있습니다.`
        )
        .setFooter({ text: `관리자: ${interaction.user.tag}` })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      console.error('슬로우 모드 설정 중 오류:', error);
      await interaction.reply({
        content: '❌ 슬로우 모드를 변경하는 중 오류가 발생했습니다. 권한을 확인해주세요.',
        ephemeral: true,
      });
    }
  },
};
