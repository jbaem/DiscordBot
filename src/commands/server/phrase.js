import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { CommandTier, ADMIN_DEFAULT_PERMISSION } from '../../core/permissions.js';
import { settingsManager, DEFAULT_VOICE_NAME_TEMPLATE } from '../../stores/settingsManager.js';
import { MESSAGE_VARIABLES } from '../../services/memberNotifications.js';
import { buildTempVoiceName } from '../../services/tempVoiceChannels.js';

/**
 * /문구 서브커맨드 정의
 * - option: 문구를 받는 옵션 이름 (비워두고 실행하면 현재 문구와 미리보기만 표시)
 * - preview: 템플릿 → 미리보기 문자열
 */
const TARGETS = {
  입장: {
    settingKey: 'welcomeMessage',
    label: '👋 입장 알림 문구',
    option: '문구',
    optionDescription: '입장 문구 ({user}, {userName}, {server}, {joinedAt}, {joinCount}, {isRejoin} 등) · 비우면 현재 문구 확인',
    maxLength: 1000,
    variables: MESSAGE_VARIABLES,
    preview: (template, interaction) =>
      settingsManager.formatMessage(template, { member: interaction.member, guild: interaction.guild }) || '없음',
  },
  퇴장: {
    settingKey: 'leaveMessage',
    label: '🚪 퇴장 알림 문구',
    option: '문구',
    optionDescription: '퇴장 문구 ({user}, {userName}, {server}, {joinedAt}, {accountAge} 등) · 비우면 현재 문구 확인',
    maxLength: 1000,
    variables: MESSAGE_VARIABLES,
    preview: (template, interaction) =>
      settingsManager.formatMessage(template, { member: interaction.member, guild: interaction.guild }) || '없음',
  },
  음성방서식: {
    settingKey: 'voiceNameTemplate',
    label: '🔊 임시 음성방 이름 서식',
    option: '서식',
    optionDescription: '이름 서식 ({userName}: 유저 닉네임, {server}: 서버명) · 비우면 현재 서식 확인',
    maxLength: 50,
    variables: '{userName}(닉네임), {server}(서버이름)',
    fallback: DEFAULT_VOICE_NAME_TEMPLATE,
    preview: (template, interaction) => buildTempVoiceName(template, interaction.member, interaction.guild),
  },
};

function buildData() {
  const builder = new SlashCommandBuilder()
    .setName('문구')
    .setDescription('입장/퇴장 알림 문구와 임시 음성방 이름 서식을 설정합니다.')
    .setDefaultMemberPermissions(ADMIN_DEFAULT_PERMISSION);

  for (const [name, target] of Object.entries(TARGETS)) {
    builder.addSubcommand(sub =>
      sub
        .setName(name)
        .setDescription(`${target.label.replace(/^\S+\s/, '')}을(를) 설정합니다.`)
        .addStringOption(opt =>
          opt.setName(target.option).setDescription(target.optionDescription).setMaxLength(target.maxLength)
        )
    );
  }
  return builder;
}

export default {
  tier: CommandTier.ADMIN,
  data: buildData(),

  /** @param {import('discord.js').ChatInputCommandInteraction} interaction */
  async execute(interaction) {
    const guild = interaction.guild;
    if (!guild) {
      return interaction.reply({ content: '❌ 서버 안에서만 사용할 수 있습니다.', ephemeral: true });
    }

    const target = TARGETS[interaction.options.getSubcommand()];
    if (!target) {
      return interaction.reply({ content: '❌ 알 수 없는 문구 종류입니다.', ephemeral: true });
    }

    // 문구를 입력하면 저장, 비우면 현재 값 확인
    const input = interaction.options.getString(target.option);
    const settings = input
      ? settingsManager.updateGuildSettings(guild.id, { [target.settingKey]: input })
      : settingsManager.getGuildSettings(guild.id);
    const template = settings[target.settingKey] || target.fallback || '';

    const embed = new EmbedBuilder()
      .setColor(input ? 0x57F287 : 0x5865F2)
      .setTitle(input ? `✅ ${target.label} 설정 완료` : `⚙️ ${target.label}`)
      .addFields(
        { name: '📝 현재 문구', value: `\`\`\`${template || '없음'}\`\`\`` },
        { name: '👀 미리보기 (현재 관리자 기준)', value: target.preview(template, interaction) || '없음' }
      )
      .setFooter({ text: `지원 변수: ${target.variables}` })
      .setTimestamp();
    return interaction.reply({ embeds: [embed] });
  },
};
