import { PermissionFlagsBits, ChannelType, EmbedBuilder } from 'discord.js';
import { settingsManager, DISABLED } from '../../../stores/settingsManager.js';
import { CHANNEL_LINKS, resolveLinkedChannelId } from '../../../services/channelLinks.js';

/**
 * /연결 채널 — 입장/퇴장 알림, 닉네임 로그, 임시 음성방 생성 채널 연결
 * (/연결 명령어의 서브커맨드 그룹, ../link.js 에서 조립)
 * @param {import('discord.js').SlashCommandSubcommandGroupBuilder} builder
 */
function build(builder) {
  builder
    .setName('채널')
    .setDescription('입장/퇴장 알림, 닉네임 로그, 임시 음성방 생성 채널을 연결합니다.');

  for (const [name, link] of Object.entries(CHANNEL_LINKS)) {
    builder.addSubcommand(sub =>
      sub
        .setName(name)
        .setDescription(`${link.label.replace(/^\S+\s/, '').replace(/ 채널$/, '')} 채널을 연결합니다.`)
        .addChannelOption(opt =>
          opt
            .setName('채널')
            .setDescription(link.channelType === ChannelType.GuildVoice ? '연결할 음성 채널' : '연결할 텍스트 채널')
            .addChannelTypes(link.channelType)
            .setRequired(true)
        )
    );
  }

  builder
    .addSubcommand(sub => sub.setName('확인').setDescription('현재 연결된 채널을 모두 확인합니다.'))
    .addSubcommand(sub =>
      sub
        .setName('해제')
        .setDescription('연결된 채널을 해제하여 해당 기능을 비활성화합니다.')
        .addStringOption(opt =>
          opt
            .setName('기능')
            .setDescription('연결을 해제할 기능')
            .setRequired(true)
            .addChoices(...Object.entries(CHANNEL_LINKS).map(([name, link]) => ({ name: link.label, value: name })))
        )
    );

  return builder;
}

export default {
  name: '채널',
  build,

  /** @param {import('discord.js').ChatInputCommandInteraction} interaction */
  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const guild = interaction.guild;
    if (!guild) {
      return interaction.reply({ content: '❌ 서버 안에서만 사용할 수 있습니다.', ephemeral: true });
    }
    const settings = settingsManager.getGuildSettings(guild.id);

    // 1. 채널 연결
    if (CHANNEL_LINKS[subcommand]) {
      const link = CHANNEL_LINKS[subcommand];
      const channel = interaction.options.getChannel('채널');

      const perms = channel.permissionsFor(guild.members.me);
      if (!perms?.has(link.requiredPermissions)) {
        const names = new PermissionsList(link.requiredPermissions).toKorean();
        return interaction.reply({
          content: `❌ 봇에 ${channel} 채널의 **${names}** 권한이 필요합니다.`,
          ephemeral: true,
        });
      }

      settingsManager.updateGuildSettings(guild.id, { [link.settingKey]: channel.id });

      const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle(`✅ ${link.label} 채널 연결 완료`)
        .setDescription(link.doneText(channel))
        .setTimestamp();
      if (!link.onLink) return interaction.reply({ embeds: [embed] });

      // 연결 후 작업(예: 역할 패널 게시)은 3초를 넘길 수 있으므로 지연 응답
      await interaction.deferReply();
      const extra = await link.onLink(guild).catch(error => {
        console.error(`[ChannelLink] ${link.label} 연결 후 작업 오류:`, error);
        return '⚠️ 연결은 완료했지만 후속 작업 중 오류가 발생했습니다. 봇의 채널 권한을 확인해 주세요.';
      });
      if (extra) embed.addFields({ name: '​', value: extra });
      return interaction.editReply({ embeds: [embed] });
    }

    // 2. 전체 확인
    if (subcommand === '확인') {
      const fields = Object.entries(CHANNEL_LINKS).map(([name, link]) => {
        const channelId = resolveLinkedChannelId(settings, name);
        let value;
        if (!channelId) value = '미연결 (비활성화)';
        else if (!guild.channels.cache.has(channelId)) value = `⚠️ 연결된 채널(\`${channelId}\`)이 서버에 없습니다.`;
        else value = `<#${channelId}>`;
        if (settingsManager.resolveIdSource(settings, link.settingKey) === 'env') value += ' · `.env` 설정 사용 중';
        return { name: link.label, value, inline: true };
      });

      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('🔗 채널 연결 상태')
        .addFields(fields)
        .setFooter({ text: '연결: /연결 채널 <기능> <채널> · 해제: /연결 채널 해제 <기능>' })
        .setTimestamp();
      return interaction.reply({ embeds: [embed] });
    }

    // 3. 연결 해제
    if (subcommand === '해제') {
      const name = interaction.options.getString('기능');
      const link = CHANNEL_LINKS[name];
      if (!link) {
        return interaction.reply({ content: '❌ 알 수 없는 기능입니다.', ephemeral: true });
      }

      // null 은 ".env 폴백"을 뜻하므로, .env 에 값이 있어도 꺼지도록 DISABLED 로 저장
      settingsManager.updateGuildSettings(guild.id, { [link.settingKey]: DISABLED });

      const embed = new EmbedBuilder()
        .setColor(0xED4245)
        .setTitle(`🚫 ${link.label} 연결 해제`)
        .setDescription('채널 연결이 해제되어 해당 기능이 비활성화되었습니다. 다시 사용하려면 `/연결 채널` 로 채널을 연결하세요.')
        .setTimestamp();
      if (!link.onUnlink) return interaction.reply({ embeds: [embed] });

      await interaction.deferReply();
      const extra = await link.onUnlink(guild).catch(error => {
        console.error(`[ChannelLink] ${link.label} 해제 후 작업 오류:`, error);
        return '';
      });
      if (extra) embed.addFields({ name: '​', value: extra });
      return interaction.editReply({ embeds: [embed] });
    }
  },
};

/** 권한 비트 배열을 한글 이름으로 표시하는 간단한 헬퍼 */
class PermissionsList {
  static NAMES = new Map([
    [PermissionFlagsBits.ViewChannel, '채널 보기'],
    [PermissionFlagsBits.SendMessages, '메시지 보내기'],
    [PermissionFlagsBits.EmbedLinks, '링크 임베드'],
    [PermissionFlagsBits.ManageChannels, '채널 관리'],
    [PermissionFlagsBits.MoveMembers, '멤버 이동'],
    [PermissionFlagsBits.AddReactions, '반응 추가'],
    [PermissionFlagsBits.ReadMessageHistory, '메시지 기록 보기'],
  ]);

  constructor(flags) {
    this.flags = flags;
  }

  toKorean() {
    return this.flags.map(f => PermissionsList.NAMES.get(f) || String(f)).join(' / ');
  }
}
