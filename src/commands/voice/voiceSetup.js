import { SlashCommandBuilder, ChannelType, EmbedBuilder } from 'discord.js';
import { CommandTier, ADMIN_DEFAULT_PERMISSION } from '../../core/permissions.js';
import { settingsManager, DEFAULT_VOICE_NAME_TEMPLATE } from '../../stores/settingsManager.js';
import { buildTempVoiceName } from '../../services/tempVoiceChannels.js';

export default {
  tier: CommandTier.ADMIN,
  data: new SlashCommandBuilder()
    .setName('음성방설정')
    .setDescription('임시 음성방(Join-to-Create) 자동 생성 기능을 설정합니다.')
    .setDefaultMemberPermissions(ADMIN_DEFAULT_PERMISSION)
    .addSubcommand(sub =>
      sub
        .setName('자동설정')
        .setDescription('봇이 전용 카테고리와 "➕ 방 만들기" 채널을 자동으로 생성하고 연결합니다. (원클릭 설정)')
    )
    .addSubcommand(sub =>
      sub
        .setName('이름서식')
        .setDescription('새로 생성될 임시 음성방의 기본 이름 서식을 설정합니다.')
        .addStringOption(opt =>
          opt
            .setName('서식')
            .setDescription('이름 서식 ({userName}: 유저 닉네임, {server}: 서버명)')
            .setRequired(true)
            .setMaxLength(50)
        )
    )
    .addSubcommand(sub => sub.setName('확인').setDescription('현재 임시 음성방 설정 상태를 확인합니다.')),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const guild = interaction.guild;
    if (!guild) {
      return interaction.reply({ content: '❌ 서버 안에서만 사용할 수 있습니다.', ephemeral: true });
    }
    const guildId = guild.id;
    const settings = settingsManager.getGuildSettings(guildId);

    // 1. 원클릭 자동 생성 및 연결
    if (subcommand === '자동설정') {
      await interaction.deferReply();

      try {
        const category = await guild.channels.create({
          name: '🔊 개인 통화방',
          type: ChannelType.GuildCategory,
        });

        const voiceChannel = await guild.channels.create({
          name: '➕ 클릭하여 통화방 생성',
          type: ChannelType.GuildVoice,
          parent: category.id,
          userLimit: 1, // 방 생성용이므로 1명 입장 즉시 이동되도록 설정
        });

        settingsManager.updateGuildSettings(guildId, { joinToCreateChannelId: voiceChannel.id });

        const embed = new EmbedBuilder()
          .setColor(0x57F287)
          .setTitle('🎉 임시 음성방 자동 설정 완료!')
          .setDescription('서버에 필요한 카테고리와 생성 채널이 자동으로 만들어졌습니다.')
          .addFields(
            { name: '📁 생성된 카테고리', value: `${category.name}`, inline: true },
            { name: '🔊 생성 채널', value: `${voiceChannel} (\`${voiceChannel.name}\`)`, inline: true },
            {
              name: '📌 사용 방법',
              value:
                '1. 멤버가 **`➕ 클릭하여 통화방 생성`** 채널에 접속하면\n' +
                '2. 즉시 해당 멤버 전용 통화방이 자동 생성되고 유저가 이동됩니다.\n' +
                '3. 방장은 `/음성방` 명령어로 방 이름, 인원수, 잠금 등을 제어할 수 있습니다.\n' +
                '4. 모든 인원이 퇴장하면 채널이 자동으로 삭제됩니다.',
            }
          )
          .setTimestamp();

        return interaction.editReply({ embeds: [embed] });
      } catch (error) {
        console.error('[AutoVoice] 채널 생성 오류:', error);
        return interaction.editReply({
          content: '❌ 채널을 자동으로 생성하는 중 오류가 발생했습니다. 봇의 "채널 관리(Manage Channels)" 권한을 확인해 주세요.',
        });
      }
    }

    // 2. 이름 서식 변경
    if (subcommand === '이름서식') {
      const template = interaction.options.getString('서식');
      settingsManager.updateGuildSettings(guildId, { voiceNameTemplate: template });

      const preview = buildTempVoiceName(template, interaction.member, guild);

      const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle('✅ 음성방 이름 서식 변경 완료')
        .addFields(
          { name: '📝 설정된 서식', value: `\`${template}\`` },
          { name: '👀 생성 예시', value: `\`${preview}\`` }
        )
        .setFooter({ text: '지원 변수: {userName}(닉네임), {server}(서버이름)' })
        .setTimestamp();
      return interaction.reply({ embeds: [embed] });
    }

    // 3. 현재 설정 확인
    if (subcommand === '확인') {
      const currentChannelId = settingsManager.resolveId(settings, 'joinToCreateChannelId');
      const channelMention = currentChannelId ? `<#${currentChannelId}>` : '미연결 (비활성화)';
      const template = settings.voiceNameTemplate || DEFAULT_VOICE_NAME_TEMPLATE;

      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('⚙️ 임시 음성방 설정 상태')
        .addFields(
          { name: '🔊 생성 채널', value: channelMention, inline: true },
          { name: '📝 방 이름 서식', value: `\`${template}\``, inline: true },
          {
            name: '🛠️ 관련 명령어',
            value:
              '• `/음성방설정 자동설정` : 카테고리 및 생성 채널 원클릭 자동 생성\n' +
              '• `/채널연결 음성생성 <채널>` : 기존 음성 채널을 생성 채널로 연결\n' +
              '• `/음성방설정 이름서식 <서식>` : 기본 방 이름 서식 변경\n' +
              '• `/채널연결 해제 음성생성` : 기능 비활성화',
          }
        )
        .setTimestamp();
      return interaction.reply({ embeds: [embed] });
    }
  },
};
