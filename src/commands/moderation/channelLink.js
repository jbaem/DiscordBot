import { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder } from 'discord.js';
import { CommandTier, ADMIN_DEFAULT_PERMISSION } from '../../utils/permissions.js';
import { settingsManager } from '../../utils/settingsManager.js';
import { config } from '../../config.js';

/**
 * 채널 연결 종류 정의
 * key: 서브커맨드 이름(한글) → 설정 키, 표시 이름, 채널 종류, 봇에 필요한 권한, 안내 문구
 */
export const CHANNEL_LINKS = {
  입장알림: {
    settingKey: 'welcomeChannelId',
    envFallback: () => config.welcomeChannelId,
    label: '👋 입장 알림',
    channelType: ChannelType.GuildText,
    requiredPermissions: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks],
    doneText: channel => `이제 새로운 멤버가 들어오면 ${channel} 채널에 환영 메시지가 전송됩니다.`,
  },
  퇴장알림: {
    settingKey: 'leaveChannelId',
    envFallback: () => config.leaveChannelId,
    label: '🚪 퇴장 알림',
    channelType: ChannelType.GuildText,
    requiredPermissions: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks],
    doneText: channel => `이제 멤버가 서버를 떠나면 ${channel} 채널에 퇴장 알림이 전송됩니다.`,
  },
  닉네임로그: {
    settingKey: 'nicknameLogChannelId',
    envFallback: () => null,
    label: '✏️ 닉네임 변경 로그',
    channelType: ChannelType.GuildText,
    requiredPermissions: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks],
    doneText: channel => `이제 멤버가 서버 닉네임을 바꾸면 ${channel} 채널에 변경 시각과 변경 전/후 이름이 기록됩니다.`,
  },
  음성생성: {
    settingKey: 'joinToCreateChannelId',
    envFallback: () => config.joinToCreateChannelId,
    label: '🔊 임시 음성방 생성 채널',
    channelType: ChannelType.GuildVoice,
    requiredPermissions: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.MoveMembers],
    doneText: channel =>
      `이제 멤버가 ${channel} 채널에 접속하면 전용 통화방이 자동 생성됩니다.\n💡 생성용 채널의 인원 제한을 1명으로 두면 더 자연스럽게 동작합니다.`,
  },
};

/** 현재 적용 중인 채널 ID (슬래시 설정 우선, 없으면 .env 폴백) */
export function resolveLinkedChannelId(settings, linkName) {
  const link = CHANNEL_LINKS[linkName];
  return settings[link.settingKey] || link.envFallback() || null;
}

function buildData() {
  const builder = new SlashCommandBuilder()
    .setName('채널연결')
    .setDescription('입장/퇴장 알림, 닉네임 로그, 임시 음성방 생성 채널을 연결합니다.')
    .setDefaultMemberPermissions(ADMIN_DEFAULT_PERMISSION);

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
  tier: CommandTier.ADMIN,
  data: buildData(),

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
      return interaction.reply({ embeds: [embed] });
    }

    // 2. 전체 확인
    if (subcommand === '확인') {
      const fields = Object.entries(CHANNEL_LINKS).map(([name, link]) => {
        const channelId = resolveLinkedChannelId(settings, name);
        let value;
        if (!channelId) value = '미연결 (비활성화)';
        else if (!guild.channels.cache.has(channelId)) value = `⚠️ 연결된 채널(\`${channelId}\`)이 서버에 없습니다.`;
        else value = `<#${channelId}>`;
        if (channelId && !settings[link.settingKey]) value += ' · `.env` 설정 사용 중';
        return { name: link.label, value, inline: true };
      });

      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('🔗 채널 연결 상태')
        .addFields(fields)
        .setFooter({ text: '연결: /채널연결 <기능> <채널> · 해제: /채널연결 해제 <기능>' })
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

      settingsManager.updateGuildSettings(guild.id, { [link.settingKey]: null });

      const embed = new EmbedBuilder()
        .setColor(0xED4245)
        .setTitle(`🚫 ${link.label} 연결 해제`)
        .setDescription('채널 연결이 해제되어 해당 기능이 비활성화되었습니다. 다시 사용하려면 `/채널연결` 로 채널을 연결하세요.')
        .setTimestamp();
      return interaction.reply({ embeds: [embed] });
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
  ]);

  constructor(flags) {
    this.flags = flags;
  }

  toKorean() {
    return this.flags.map(f => PermissionsList.NAMES.get(f) || String(f)).join(' / ');
  }
}
