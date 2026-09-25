import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';

export default {
  data: new SlashCommandBuilder()
    .setName('clear')
    .setDescription('현재 채널의 메시지를 대량으로 삭제합니다.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption(option =>
      option
        .setName('count')
        .setDescription('삭제할 메시지 수 (1~100)')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(100)
    )
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('특정 사용자의 메시지만 삭제하려면 지정하세요.')
        .setRequired(false)
    ),
  async execute(interaction) {
    const count = interaction.options.getInteger('count');
    const targetUser = interaction.options.getUser('user');

    if (!interaction.channel || !interaction.channel.isTextBased()) {
      return interaction.reply({
        content: '❌ 텍스트 채널에서만 사용할 수 있는 명령어입니다.',
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      if (targetUser) {
        // 특정 유저 메시지만 골라서 삭제
        const messages = await interaction.channel.messages.fetch({ limit: 100 });
        const userMessages = messages
          .filter(m => m.author.id === targetUser.id)
          .first(count);

        if (userMessages.length === 0) {
          return interaction.editReply({
            content: `⚠️ 최근 100개의 메시지 중 ${targetUser} 님의 메시지를 찾지 못했습니다.`,
          });
        }

        const deleted = await interaction.channel.bulkDelete(userMessages, true);
        const embed = new EmbedBuilder()
          .setColor(0x00FF88)
          .setDescription(`🧹 ${targetUser} 님의 메시지 **${deleted.size}**개를 삭제했습니다.`);

        return interaction.editReply({ embeds: [embed] });
      } else {
        // 일반 전체 삭제
        const deleted = await interaction.channel.bulkDelete(count, true);
        const embed = new EmbedBuilder()
          .setColor(0x00FF88)
          .setDescription(`🧹 메시지 **${deleted.size}**개를 정리했습니다.`);

        return interaction.editReply({ embeds: [embed] });
      }
    } catch (error) {
      console.error('메시지 삭제 중 오류:', error);
      return interaction.editReply({
        content: '❌ 메시지 삭제 중 오류가 발생했습니다. (14일 이상 지난 메시지는 디스코드 정책상 일괄 삭제할 수 없습니다.)',
      });
    }
  },
};
