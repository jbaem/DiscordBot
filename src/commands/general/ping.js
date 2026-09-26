import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { CommandTier, ADMIN_DEFAULT_PERMISSION } from '../../utils/permissions.js';

export default {
  tier: CommandTier.ADMIN,
  data: new SlashCommandBuilder()
    .setName('핑')
    .setDescription('봇의 응답 속도 및 웹소켓 핑을 확인합니다.')
    .setDefaultMemberPermissions(ADMIN_DEFAULT_PERMISSION),
  async execute(interaction) {
    const sent = await interaction.reply({
      content: '핑 측정 중...',
      fetchReply: true,
    });

    const latency = sent.createdTimestamp - interaction.createdTimestamp;
    const wsPing = interaction.client.ws.ping;

    const embed = new EmbedBuilder()
      .setColor(0x00FF88)
      .setTitle('🏓 퐁(Pong)!')
      .addFields(
        { name: '왕복 지연 시간 (Latency)', value: `\`${latency}ms\``, inline: true },
        { name: '웹소켓 핑 (API Ping)', value: `\`${wsPing}ms\``, inline: true }
      )
      .setTimestamp();

    await interaction.editReply({ content: null, embeds: [embed] });
  },
};
