import { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder } from 'discord.js';
import { settingsManager } from '../../utils/settingsManager.js';
import { config } from '../../config.js';

export default {
  data: new SlashCommandBuilder()
    .setName('autovoice')
    .setDescription('임시 음성 채널(Join-to-Create) 자동 생성 기능을 설정합니다.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addSubcommand(sub =>
      sub
        .setName('setup')
        .setDescription('봇이 전용 카테고리와 "➕ 방 만들기" 채널을 자동으로 생성하고 연결합니다. (원클릭 설정)')
    )
    .addSubcommand(sub =>
      sub
        .setName('channel')
        .setDescription('이미 만들어진 기존 음성 채널을 방 생성 트리거 채널로 지정합니다.')
        .addChannelOption(opt =>
          opt
            .setName('target')
            .setDescription('유저 접속 시 개인 방을 생성할 음성 채널')
            .addChannelTypes(ChannelType.GuildVoice)
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('name')
        .setDescription('새로 생성될 임시 음성 채널의 기본 이름 템플릿을 설정합니다.')
        .addStringOption(opt =>
          opt
            .setName('template')
            .setDescription('이름 서식 ({userName}: 유저 닉네임, {server}: 서버명)')
            .setRequired(true)
            .setMaxLength(50)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('view')
        .setDescription('현재 설정된 임시 음성 채널 설정 상태를 확인합니다.')
    )
    .addSubcommand(sub =>
      sub
        .setName('disable')
        .setDescription('임시 음성 채널 자동 생성 기능을 비활성화합니다.')
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const guild = interaction.guild;
    const guildId = guild.id;
    const settings = settingsManager.getGuildSettings(guildId);

    // 1. 원클릭 자동 생성 및 셋업
    if (subcommand === 'setup') {
      await interaction.deferReply();

      try {
        // 전용 카테고리 생성
        const category = await guild.channels.create({
          name: '🔊 개인 통화방',
          type: ChannelType.GuildCategory,
        });

        // 카테고리 내에 트리거 음성 채널 생성
        const voiceChannel = await guild.channels.create({
          name: '➕ 클릭하여 통화방 생성',
          type: ChannelType.GuildVoice,
          parent: category.id,
          userLimit: 1, // 방 생성용이므로 1명 입장 즉시 이동되도록 설정
        });

        // 설정 저장
        settingsManager.updateGuildSettings(guildId, {
          joinToCreateChannelId: voiceChannel.id,
        });

        const embed = new EmbedBuilder()
          .setColor(0x57F287)
          .setTitle('🎉 임시 음성 채널 자동 설정 완료!')
          .setDescription('서버에 필요한 카테고리와 생성 채널이 자동으로 만들어졌습니다.')
          .addFields(
            { name: '📁 생성된 카테고리', value: `${category.name}`, inline: true },
            { name: '🔊 생성 채널', value: `${voiceChannel} (\`${voiceChannel.name}\`)`, inline: true },
            {
              name: '📌 사용 방법',
              value:
                '1. 멤버가 **`➕ 클릭하여 통화방 생성`** 채널에 접속하면\n' +
                '2. 즉시 해당 멤버 전용 통화방이 자동 생성되고 유저가 이동됩니다.\n' +
                '3. 방장은 `/voice` 명령어로 방 이름, 인원수, 잠금 등을 제어할 수 있습니다.\n' +
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

    // 2. 기존 채널 지정
    if (subcommand === 'channel') {
      const channel = interaction.options.getChannel('target');
      settingsManager.updateGuildSettings(guildId, {
        joinToCreateChannelId: channel.id,
      });

      const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle('✅ 자동 음성 채널 설정 완료')
        .setDescription(`이제 멤버가 ${channel} 채널에 접속하면 전용 통화방이 자동 생성됩니다.`)
        .addFields({
          name: '💡 팁',
          value: '생성용 채널의 인원 제한을 1명으로 설정해 두시면 더욱 자연스럽게 동작합니다.',
        })
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    }

    // 3. 채널 이름 템플릿 변경
    if (subcommand === 'name') {
      const template = interaction.options.getString('template');
      settingsManager.updateGuildSettings(guildId, {
        voiceNameTemplate: template,
      });

      const preview = template
        .replace(/{userName}/g, interaction.member.displayName)
        .replace(/{server}/g, guild.name);

      const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle('✅ 음성 채널 이름 템플릿 변경 완료')
        .addFields(
          { name: '📝 설정된 템플릿', value: `\`${template}\`` },
          { name: '👀 생성 예시', value: `\`${preview}\`` }
        )
        .setFooter({ text: '지원 변수: {userName}(닉네임), {server}(서버이름)' })
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    }

    // 4. 현재 설정 확인
    if (subcommand === 'view') {
      const currentChannelId = settings.joinToCreateChannelId || config.joinToCreateChannelId;
      const channelMention = currentChannelId ? `<#${currentChannelId}>` : '미설정 (비활성화)';
      const template = settings.voiceNameTemplate || '🔊 {userName}님의 통화방';

      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('⚙️ 임시 음성 채널 설정 상태')
        .addFields(
          { name: '🔊 생성 트리거 채널', value: channelMention, inline: true },
          { name: '📝 방 이름 템플릿', value: `\`${template}\``, inline: true },
          {
            name: '🛠️ 빠른 설정 명령어',
            value:
              '• `/autovoice setup` : 카테고리 및 생성 채널 원클릭 자동 생성\n' +
              '• `/autovoice channel <채널>` : 기존 음성 채널 지정\n' +
              '• `/autovoice name <서식>` : 기본 방 이름 서식 변경\n' +
              '• `/autovoice disable` : 기능 비활성화',
          }
        )
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    }

    // 5. 비활성화
    if (subcommand === 'disable') {
      settingsManager.updateGuildSettings(guildId, {
        joinToCreateChannelId: null,
      });

      const embed = new EmbedBuilder()
        .setColor(0xED4245)
        .setTitle('🚫 임시 음성 채널 비활성화')
        .setDescription('자동 음성 채널 생성 기능이 비활성화되었습니다.')
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    }
  },
};
