import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';

export default {
  data: new SlashCommandBuilder()
    .setName('unlock')
    .setDescription('잠긴 채널을 다시 활성화하여 채팅이 가능하게 합니다.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
  async execute(interaction) {
    if (!interaction.channel || !interaction.channel.isTextBased()) {
      return interaction.reply({
        content: '❌ 텍스트 채널에서만 사용할 수 있는 명령어입니다.',
        ephemeral: true,
      });
    }

    try {
      await interaction.channel.permissionOverwrites.edit(
        interaction.guild.roles.everyone,
        { SendMessages: null }, // 기본 상속 상태로 복원
        { reason: `채널 잠금 해제 by ${interaction.user.tag}` }
      );

      const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle('🔓 채널 잠금이 해제되었습니다')
        .setDescription('이제 모든 멤버가 다시 메시지를 보낼 수 있습니다.')
        .setFooter({ text: `관리자: ${interaction.user.tag}` })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      console.error('채널 잠금 해제 중 오류:', error);
      await interaction.reply({
        content: '❌ 채널 잠금을 해제하는 중 오류가 발생했습니다. 봇의 권한을 확인해주세요.',
        ephemeral: true,
      });
    }
  },
};
