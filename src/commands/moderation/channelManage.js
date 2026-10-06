import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { CommandTier, ADMIN_DEFAULT_PERMISSION } from '../../core/permissions.js';

export default {
  tier: CommandTier.ADMIN,
  data: new SlashCommandBuilder()
    .setName('채널관리')
    .setDescription('현재 텍스트 채널을 잠그거나, 슬로우 모드를 설정하거나, 메시지를 정리합니다.')
    .setDefaultMemberPermissions(ADMIN_DEFAULT_PERMISSION)
    .addSubcommand(sub =>
      sub
        .setName('잠금')
        .setDescription('현재 채널을 잠가 일반 멤버가 메시지를 보낼 수 없도록 합니다.')
        .addStringOption(opt => opt.setName('사유').setDescription('채널을 잠그는 이유').setMaxLength(200))
    )
    .addSubcommand(sub => sub.setName('잠금해제').setDescription('잠긴 채널을 다시 활성화하여 채팅이 가능하게 합니다.'))
    .addSubcommand(sub =>
      sub
        .setName('슬로우모드')
        .setDescription('현재 채널의 메시지 전송 간격(슬로우 모드)을 설정합니다.')
        .addIntegerOption(opt =>
          opt
            .setName('초')
            .setDescription('슬로우 모드 시간 (초 단위, 0은 해제, 최대 21600초/6시간)')
            .setRequired(true)
            .setMinValue(0)
            .setMaxValue(21600)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('메시지삭제')
        .setDescription('현재 채널의 최근 메시지를 일괄 삭제합니다. (14일 이내 메시지만 가능)')
        .addIntegerOption(opt =>
          opt.setName('개수').setDescription('삭제할 메시지 수 (1~100)').setRequired(true).setMinValue(1).setMaxValue(100)
        )
        .addUserOption(opt => opt.setName('유저').setDescription('특정 유저의 메시지만 삭제하려면 지정'))
    ),

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

    // 3. 슬로우 모드
    if (subcommand === '슬로우모드') {
      const seconds = interaction.options.getInteger('초');
      try {
        await channel.setRateLimitPerUser(seconds, `슬로우 모드 설정 by ${interaction.user.tag}`);

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
        return interaction.reply({ embeds: [embed] });
      } catch (error) {
        console.error('[ChannelManage] 슬로우 모드 오류:', error);
        return interaction.reply({ content: '❌ 슬로우 모드를 변경하는 중 오류가 발생했습니다. 봇의 권한을 확인해 주세요.', ephemeral: true });
      }
    }

    // 4. 메시지 삭제
    if (subcommand === '메시지삭제') {
      const count = interaction.options.getInteger('개수');
      const targetUser = interaction.options.getUser('유저');

      await interaction.deferReply({ ephemeral: true });
      try {
        if (targetUser) {
          // 특정 유저 메시지만 골라서 삭제 (최근 100개 내에서)
          const messages = await channel.messages.fetch({ limit: 100 });
          const userMessages = messages.filter(m => m.author.id === targetUser.id).first(count);

          if (userMessages.length === 0) {
            return interaction.editReply({ content: `⚠️ 최근 100개의 메시지 중 ${targetUser} 님의 메시지를 찾지 못했습니다.` });
          }

          const deleted = await channel.bulkDelete(userMessages, true);
          const embed = new EmbedBuilder()
            .setColor(0x57F287)
            .setDescription(`🧹 ${targetUser} 님의 메시지 **${deleted.size}**개를 삭제했습니다.`);
          return interaction.editReply({ embeds: [embed] });
        }

        const deleted = await channel.bulkDelete(count, true);
        const embed = new EmbedBuilder().setColor(0x57F287).setDescription(`🧹 메시지 **${deleted.size}**개를 정리했습니다.`);
        return interaction.editReply({ embeds: [embed] });
      } catch (error) {
        console.error('[ChannelManage] 메시지 삭제 오류:', error);
        return interaction.editReply({
          content: '❌ 메시지 삭제 중 오류가 발생했습니다. (14일 이상 지난 메시지는 디스코드 정책상 일괄 삭제할 수 없습니다.)',
        });
      }
    }
  },
};
