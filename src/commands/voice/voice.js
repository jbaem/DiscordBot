import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { CommandTier, ADMIN_DEFAULT_PERMISSION } from '../../core/permissions.js';
import { tempVoiceManager } from '../../stores/tempVoiceManager.js';

export default {
  tier: CommandTier.ADMIN,
  data: new SlashCommandBuilder()
    .setName('음성방')
    .setDescription('내가 만든 임시 음성 채널을 제어합니다.')
    .setDefaultMemberPermissions(ADMIN_DEFAULT_PERMISSION)
    .addSubcommand(sub =>
      sub
        .setName('이름')
        .setDescription('음성 채널의 이름을 변경합니다.')
        .addStringOption(opt =>
          opt
            .setName('이름')
            .setDescription('새로운 음성 채널 이름')
            .setRequired(true)
            .setMaxLength(50)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('인원')
        .setDescription('음성 채널의 최대 접속 인원수를 변경합니다.')
        .addIntegerOption(opt =>
          opt
            .setName('인원수')
            .setDescription('최대 인원수 (0: 무제한, 1~99)')
            .setRequired(true)
            .setMinValue(0)
            .setMaxValue(99)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('잠금')
        .setDescription('음성 채널을 잠가 다른 사용자의 접속을 막습니다.')
    )
    .addSubcommand(sub =>
      sub
        .setName('잠금해제')
        .setDescription('음성 채널의 잠금을 해제합니다.')
    ),

  async execute(interaction) {
    const member = interaction.member;
    const voiceChannel = member.voice.channel;

    if (!voiceChannel) {
      return interaction.reply({
        content: '❌ 먼저 제어하려는 음성 채널에 접속해 있어야 합니다.',
        ephemeral: true,
      });
    }

    // 임시 채널인지 확인
    if (!tempVoiceManager.isTempChannel(voiceChannel.id)) {
      return interaction.reply({
        content: '❌ 봇을 통해 생성된 개인 임시 음성 채널에서만 이 명령어를 사용할 수 있습니다.',
        ephemeral: true,
      });
    }

    // 소유자이거나 관리자 권한이 있는지 확인
    const isOwner = tempVoiceManager.isOwner(voiceChannel.id, member.id);
    const hasAdmin = member.permissions.has(PermissionFlagsBits.ManageChannels);

    if (!isOwner && !hasAdmin) {
      return interaction.reply({
        content: '❌ 이 음성 채널을 생성한 방장만 설정을 변경할 수 있습니다.',
        ephemeral: true,
      });
    }

    const subcommand = interaction.options.getSubcommand();

    try {
      if (subcommand === '이름') {
        const newName = interaction.options.getString('이름');
        await voiceChannel.setName(newName);

        const embed = new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle('✏️ 음성 채널 이름 변경')
          .setDescription(`채널 이름이 **${newName}**(으)로 변경되었습니다.`)
          .setTimestamp();

        return interaction.reply({ embeds: [embed], ephemeral: true });
      }

      if (subcommand === '인원') {
        const limit = interaction.options.getInteger('인원수');
        await voiceChannel.setUserLimit(limit);

        const embed = new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle('👥 음성 채널 인원 제한 변경')
          .setDescription(
            limit === 0
              ? '접속 인원 제한이 **무제한**으로 설정되었습니다.'
              : `최대 접속 인원이 **${limit}명**으로 설정되었습니다.`
          )
          .setTimestamp();

        return interaction.reply({ embeds: [embed], ephemeral: true });
      }

      if (subcommand === '잠금') {
        await voiceChannel.permissionOverwrites.edit(
          interaction.guild.roles.everyone,
          { Connect: false }
        );

        const embed = new EmbedBuilder()
          .setColor(0xED4245)
          .setTitle('🔒 음성 채널 잠금')
          .setDescription('다른 사용자가 이 채널에 접속할 수 없도록 잠갔습니다.')
          .setTimestamp();

        return interaction.reply({ embeds: [embed], ephemeral: true });
      }

      if (subcommand === '잠금해제') {
        await voiceChannel.permissionOverwrites.edit(
          interaction.guild.roles.everyone,
          { Connect: null }
        );

        const embed = new EmbedBuilder()
          .setColor(0x57F287)
          .setTitle('🔓 음성 채널 잠금 해제')
          .setDescription('이제 다른 사용자도 채널에 자유롭게 접속할 수 있습니다.')
          .setTimestamp();

        return interaction.reply({ embeds: [embed], ephemeral: true });
      }
    } catch (error) {
      console.error('음성 채널 제어 중 오류:', error);
      return interaction.reply({
        content: '❌ 채널 설정을 변경하는 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
        ephemeral: true,
      });
    }
  },
};
