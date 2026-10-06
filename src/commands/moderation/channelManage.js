import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { CommandTier, ADMIN_DEFAULT_PERMISSION } from '../../core/permissions.js';

export default {
  tier: CommandTier.ADMIN,
  data: new SlashCommandBuilder()
    .setName('채널관리')
    .setDescription('현재 텍스트 채널을 잠그거나 잠금을 해제합니다.')
    .setDefaultMemberPermissions(ADMIN_DEFAULT_PERMISSION)
    .addSubcommand(sub =>
      sub
        .setName('잠금')
        .setDescription('현재 채널을 잠가 일반 멤버가 메시지를 보낼 수 없도록 합니다.')
        .addStringOption(opt => opt.setName('사유').setDescription('채널을 잠그는 이유').setMaxLength(200))
    )
    .addSubcommand(sub => sub.setName('잠금해제').setDescription('잠긴 채널을 다시 활성화하여 채팅이 가능하게 합니다.')),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const channel = interaction.channel;

    if (!interaction.guild || !channel || !channel.isTextBased()) {
      return interaction.reply({ content: '❌ 서버의 텍스트 채널에서만 사용할 수 있는 명령어입니다.', ephemeral: true });
    }

    // 1. 잠금
    if (subcommand === '잠금') {
      const reason = interaction.options.getString('사유') || '사유 미지정';
      try {
        await channel.permissionOverwrites.edit(
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
        return interaction.reply({ embeds: [embed] });
      } catch (error) {
        console.error('[ChannelManage] 채널 잠금 오류:', error);
        return interaction.reply({ content: '❌ 채널을 잠그는 중 오류가 발생했습니다. 봇의 권한을 확인해 주세요.', ephemeral: true });
      }
    }

    // 2. 잠금 해제
    if (subcommand === '잠금해제') {
      try {
        await channel.permissionOverwrites.edit(
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
        return interaction.reply({ embeds: [embed] });
      } catch (error) {
        console.error('[ChannelManage] 채널 잠금 해제 오류:', error);
        return interaction.reply({ content: '❌ 채널 잠금을 해제하는 중 오류가 발생했습니다. 봇의 권한을 확인해 주세요.', ephemeral: true });
      }
    }
  },
};
