import { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder } from 'discord.js';
import { settingsManager } from '../../utils/settingsManager.js';
import { memberHistoryManager } from '../../utils/memberHistoryManager.js';

export default {
  data: new SlashCommandBuilder()
    .setName('welcome')
    .setDescription('신규 멤버 입장(환영) 채널 및 메시지를 설정합니다.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sub =>
      sub
        .setName('channel')
        .setDescription('입장 메시지를 전송할 텍스트 채널을 지정합니다.')
        .addChannelOption(opt =>
          opt
            .setName('target')
            .setDescription('환영 메시지를 받을 텍스트 채널')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('message')
        .setDescription('입장 시 전송할 메시지 문구를 커스텀합니다.')
        .addStringOption(opt =>
          opt
            .setName('text')
            .setDescription('메시지 템플릿 ({user}, {userName}, {server}, {count}, {joinedAt}, {joinCount}, {isRejoin} 등)')
            .setRequired(true)
            .setMaxLength(1000)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('view')
        .setDescription('현재 설정된 입장 채널 및 메시지를 확인합니다.')
    )
    .addSubcommand(sub =>
      sub
        .setName('test')
        .setDescription('설정된 환영 채널로 테스트 메시지를 전송해 봅니다.')
    )
    .addSubcommand(sub =>
      sub
        .setName('disable')
        .setDescription('입장 메시지 전송을 비활성화합니다.')
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const guildId = interaction.guildId;
    const settings = settingsManager.getGuildSettings(guildId);

    if (subcommand === 'channel') {
      const channel = interaction.options.getChannel('target');
      settingsManager.updateGuildSettings(guildId, { welcomeChannelId: channel.id });

      const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle('✅ 입장 알림 채널 설정 완료')
        .setDescription(`이제 새로운 멤버가 들어오면 ${channel} 채널에 환영 메시지가 전송됩니다.`)
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    }

    if (subcommand === 'message') {
      const newText = interaction.options.getString('text');
      settingsManager.updateGuildSettings(guildId, { welcomeMessage: newText });

      const preview = settingsManager.formatMessage(newText, {
        member: interaction.member,
        guild: interaction.guild,
      });

      const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle('✅ 입장 메시지 문구 설정 완료')
        .setDescription('새 멤버 입장 시 아래와 같이 전송됩니다.')
        .addFields(
          { name: '📝 설정된 원본 템플릿', value: `\`\`\`${newText}\`\`\`` },
          { name: '👀 미리보기 (현재 관리자 기준)', value: preview }
        )
        .setFooter({ text: '지원 변수: {user}, {userName}, {userTag}, {userId}, {server}, {count}, {joinedAt}, {joinedAtRelative}, {createdAt}, {accountAge}, {joinCount}, {isRejoin}' })
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    }

    if (subcommand === 'view') {
      const channelMention = settings.welcomeChannelId ? `<#${settings.welcomeChannelId}>` : '미설정 (비활성화)';
      const preview = settingsManager.formatMessage(settings.welcomeMessage, {
        member: interaction.member,
        guild: interaction.guild,
      });

      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('⚙️ 현재 입장(환영) 설정')
        .addFields(
          { name: '📢 전송 채널', value: channelMention, inline: true },
          { name: '📝 설정된 템플릿', value: `\`\`\`${settings.welcomeMessage || '없음'}\`\`\`` },
          { name: '👀 실제 출력 예시', value: preview || '없음' }
        )
        .setFooter({ text: '지원 변수: {user}, {userName}, {userTag}, {userId}, {server}, {count}, {joinedAt}, {joinedAtRelative}, {createdAt}, {accountAge}, {joinCount}, {isRejoin}' })
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    }

    if (subcommand === 'test') {
      if (!settings.welcomeChannelId) {
        return interaction.reply({
          content: '❌ 먼저 `/welcome channel` 명령어로 알림 채널을 지정해 주세요.',
          ephemeral: true,
        });
      }

      const targetChannel = interaction.guild.channels.cache.get(settings.welcomeChannelId);
      if (!targetChannel) {
        return interaction.reply({
          content: '❌ 설정된 채널을 찾을 수 없습니다. 다시 채널을 설정해 주세요.',
          ephemeral: true,
        });
      }

      // 실제 입장 알림과 동일한 형태로 미리보기 (입장 횟수 포함)
      const joinCount = memberHistoryManager.getJoinCount(guildId, interaction.user.id);
      const isRejoinText = joinCount > 1 ? `⚠️ 재입장 (${joinCount}회차)` : '✨ 최초 입장';

      const formatted = settingsManager.formatMessage(settings.welcomeMessage, {
        member: interaction.member,
        guild: interaction.guild,
        joinCount,
      });

      const testEmbed = new EmbedBuilder()
        .setColor(joinCount > 1 ? 0xFEE75C : 0x57F287)
        .setTitle(joinCount > 1 ? '🔁 멤버가 다시 입장했습니다 (테스트)' : '🎉 새로운 멤버가 입장했습니다! (테스트)')
        .setDescription(formatted)
        .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true, size: 256 }))
        .addFields(
          { name: '👤 유저명', value: interaction.user.tag, inline: true },
          { name: '👥 현재 서버 멤버 수', value: `${interaction.guild.memberCount}명`, inline: true },
          { name: '📊 입장 횟수', value: isRejoinText, inline: true }
        )
        .setFooter({ text: `테스트 발송 by ${interaction.user.tag}` })
        .setTimestamp();

      await targetChannel.send({ embeds: [testEmbed] });

      return interaction.reply({
        content: `✅ ${targetChannel} 채널로 테스트 환영 메시지를 발송했습니다!`,
        ephemeral: true,
      });
    }

    if (subcommand === 'disable') {
      settingsManager.updateGuildSettings(guildId, { welcomeChannelId: null });

      const embed = new EmbedBuilder()
        .setColor(0xED4245)
        .setTitle('🚫 입장 알림 비활성화')
        .setDescription('입장 알림 채널 설정이 해제되어 더 이상 환영 메시지를 보내지 않습니다.')
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    }
  },
};
