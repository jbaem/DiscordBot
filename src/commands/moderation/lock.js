import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';

export default {
  data: new SlashCommandBuilder()
    .setName('lock')
    .setDescription('현재 채널을 잠가 일반 유저가 메시지를 보낼 수 없도록 합니다.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addStringOption(option =>
      option
        .setName('reason')
        .setDescription('채널을 잠그는 이유')
        .setRequired(false)
    ),
  async execute(interaction) {
    const reason = interaction.options.getString('reason') || '사유 미지정';

    if (!interaction.channel || !interaction.channel.isTextBased()) {
      return interaction.reply({
        content: '❌ 텍스트 채널에서만 사용할 수 있는 명령어입니다.',
        ephemeral: true,
      });
    }

    try {
      await interaction.channel.permissionOverwrites.edit(
        interaction.guild.roles.everyone,
        { SendMessages: false },
        { reason: `채널 잠금 by ${interaction.user.tag}: ${reason}` }
      );

      const embed = new EmbedBuilder()
        .setColor(0xED4245)
        .setTitle('🔒 채널이 잠겼습니다')
        .setDescription('관리자 외 일반 멤버는 현재 이 채널에서 메시지를 전송할 수 없습니다.')
        .addFields({ name: '사유', value: reason })
        .setFooter({ text: `관리자: ${interaction.user.tag}` })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      console.error('채널 잠금 중 오류:', error);
      await interaction.reply({
        content: '❌ 채널을 잠그는 중 오류가 발생했습니다. 봇의 권한을 확인해주세요.',
        ephemeral: true,
      });
    }
  },
};
