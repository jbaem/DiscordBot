import { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder } from 'discord.js';
import { CommandTier, ADMIN_DEFAULT_PERMISSION } from '../../utils/permissions.js';
import { settingsManager } from '../../utils/settingsManager.js';
import {
  MAX_REACTION_ROLES,
  checkBotCanManageRole,
  getDangerousPermissions,
  parseEmojiInput,
  getReactionRoles,
  getReactionRolePanels,
  buildReactionRolePanelEmbed,
  ensurePanelReactions,
  mappingDisplay,
} from '../../utils/roleManager.js';

export default {
  tier: CommandTier.ADMIN,
  data: new SlashCommandBuilder()
    .setName('이모지역할')
    .setDescription('이모지 반응으로 스스로 받고 해제하는 역할(예: 겜블러)을 설정합니다.')
    .setDefaultMemberPermissions(ADMIN_DEFAULT_PERMISSION)
    .addSubcommand(sub =>
      sub
        .setName('추가')
        .setDescription('이모지와 역할을 연결합니다.')
        .addRoleOption(opt => opt.setName('역할').setDescription('반응 시 부여할 역할').setRequired(true))
        .addStringOption(opt =>
          opt.setName('이모지').setDescription('사용할 이모지 (예: 🎲 또는 서버 커스텀 이모지)').setRequired(true).setMaxLength(64)
        )
        .addStringOption(opt =>
          opt.setName('설명').setDescription('패널에 표시할 짧은 설명 (예: 게임 함께 할 사람)').setMaxLength(100)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('제거')
        .setDescription('역할 연결을 해제합니다. (멤버가 이미 가진 역할은 유지)')
        .addRoleOption(opt => opt.setName('역할').setDescription('연결을 해제할 역할').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('목록').setDescription('등록된 이모지-역할 목록과 패널 메시지를 확인합니다.')
    )
    .addSubcommand(sub =>
      sub
        .setName('패널')
        .setDescription('이모지를 눌러 역할을 받는 패널 메시지를 채널에 게시합니다.')
        .addChannelOption(opt =>
          opt
            .setName('채널')
            .setDescription('패널을 게시할 텍스트 채널 (기본: 현재 채널)')
            .addChannelTypes(ChannelType.GuildText)
        )
        .addStringOption(opt => opt.setName('제목').setDescription('패널 제목 (기본: 🎭 역할 선택)').setMaxLength(256))
        .addStringOption(opt => opt.setName('설명').setDescription('패널 상단 안내 문구').setMaxLength(1000))
    )
    .addSubcommand(sub =>
      sub
        .setName('갱신')
        .setDescription('게시된 모든 패널을 현재 목록으로 갱신하고 누락된 이모지 반응을 다시 추가합니다.')
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const guild = interaction.guild;
    if (!guild) {
      return interaction.reply({ content: '❌ 서버 안에서만 사용할 수 있습니다.', ephemeral: true });
    }
    const guildId = guild.id;

    // 1. 이모지 ↔ 역할 등록
    if (subcommand === '추가') {
      const role = interaction.options.getRole('역할');
      const emojiInput = interaction.options.getString('이모지');
      const description = interaction.options.getString('설명')?.trim() || null;

      const check = checkBotCanManageRole(guild, role);
      if (!check.ok) return interaction.reply({ content: `❌ ${check.reason}`, ephemeral: true });

      const dangerous = getDangerousPermissions(role);
      if (dangerous.length) {
        return interaction.reply({
          content: `❌ ${role} 역할에는 **${dangerous.join(', ')}** 권한이 있어 누구나 스스로 받을 수 있게 열 수 없습니다.`,
          ephemeral: true,
        });
      }

      const emoji = parseEmojiInput(emojiInput);
      if (!emoji) {
        return interaction.reply({
          content: '❌ 이모지를 인식할 수 없습니다. 유니코드 이모지(🎲) 또는 이 서버의 커스텀 이모지를 입력해 주세요.',
          ephemeral: true,
        });
      }
      if (emoji.id && !interaction.client.emojis.cache.has(emoji.id)) {
        return interaction.reply({
          content: '❌ 봇이 접근할 수 없는 커스텀 이모지입니다. 봇이 참여 중인 서버의 이모지만 사용할 수 있습니다.',
          ephemeral: true,
        });
      }

      const current = getReactionRoles(guildId);
      const existingByRole = current.find(m => m.roleId === role.id);
      const existingByEmoji = current.find(m => m.emojiKey === emoji.key && m.roleId !== role.id);
      if (existingByEmoji) {
        return interaction.reply({
          content: `❌ ${emoji.display} 이모지는 이미 <@&${existingByEmoji.roleId}> 역할에 연결되어 있습니다. 다른 이모지를 선택해 주세요.`,
          ephemeral: true,
        });
      }
      if (!existingByRole && current.length >= MAX_REACTION_ROLES) {
        return interaction.reply({
          content: `❌ 이모지 역할은 최대 ${MAX_REACTION_ROLES}개까지 등록할 수 있습니다.`,
          ephemeral: true,
        });
      }

      const mapping = {
        roleId: role.id,
        emojiKey: emoji.key,
        emojiId: emoji.id,
        emojiName: emoji.name,
        animated: emoji.animated,
        description,
      };
      const next = existingByRole
        ? current.map(m => (m.roleId === role.id ? mapping : m))
        : [...current, mapping];
      settingsManager.updateGuildSettings(guildId, { reactionRoles: next });

      const panels = getReactionRolePanels(guildId);
      const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle(existingByRole ? '✅ 이모지 역할 수정 완료' : '✅ 이모지 역할 등록 완료')
        .setDescription(`${emoji.display} 이모지를 누르면 ${role} 역할이 부여됩니다.${description ? `\n설명: ${description}` : ''}`)
        .addFields({
          name: '다음 단계',
          value: panels.length
            ? '`/이모지역할 갱신` 를 실행하면 게시된 패널에 새 이모지가 추가됩니다.'
            : '`/이모지역할 패널` 로 멤버들이 이모지를 누를 패널 메시지를 게시하세요.',
        })
        .setTimestamp();
      return interaction.reply({ embeds: [embed] });
    }

    // 2. 등록 해제
    if (subcommand === '제거') {
      const role = interaction.options.getRole('역할');
      const current = getReactionRoles(guildId);
      const target = current.find(m => m.roleId === role.id);
      if (!target) {
        return interaction.reply({ content: `❌ ${role} 역할은 이모지 역할로 등록되어 있지 않습니다.`, ephemeral: true });
      }
      settingsManager.updateGuildSettings(guildId, { reactionRoles: current.filter(m => m.roleId !== role.id) });

      const embed = new EmbedBuilder()
        .setColor(0xED4245)
        .setTitle('🗑️ 이모지 역할 해제')
        .setDescription(`${mappingDisplay(target)} ↔ ${role} 연결을 해제했습니다. 이미 역할을 가진 멤버는 그대로 유지됩니다.\n패널 메시지를 정리하려면 \`/이모지역할 갱신\` 를 실행하세요.`)
        .setTimestamp();
      return interaction.reply({ embeds: [embed] });
    }

    // 3. 목록
    if (subcommand === '목록') {
      const mappings = getReactionRoles(guildId);
      const panels = getReactionRolePanels(guildId);

      const mappingText = mappings.length
        ? mappings
            .map(m => {
              const role = guild.roles.cache.get(m.roleId);
              return `${mappingDisplay(m)} → ${role ?? `⚠️ 삭제된 역할 (\`${m.roleId}\`)`}${m.description ? ` · ${m.description}` : ''}`;
            })
            .join('\n')
        : '등록된 이모지 역할이 없습니다. `/이모지역할 추가` 로 추가하세요.';

      const panelText = panels.length
        ? panels.map(p => `• https://discord.com/channels/${guildId}/${p.channelId}/${p.messageId}`).join('\n')
        : '게시된 패널이 없습니다. `/이모지역할 패널` 로 게시하세요.';

      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('🎭 이모지 역할 목록')
        .addFields(
          { name: `등록된 역할 (${mappings.length}/${MAX_REACTION_ROLES})`, value: mappingText.slice(0, 1024) },
          { name: `패널 메시지 (${panels.length})`, value: panelText.slice(0, 1024) }
        )
        .setTimestamp();
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // 4. 패널 게시
    if (subcommand === '패널') {
      const channel = interaction.options.getChannel('채널') || interaction.channel;
      const title = interaction.options.getString('제목')?.trim() || null;
      const description = interaction.options.getString('설명')?.trim() || null;

      const mappings = getReactionRoles(guildId).filter(m => guild.roles.cache.has(m.roleId));
      if (!mappings.length) {
        return interaction.reply({
          content: '❌ 먼저 `/이모지역할 추가` 로 이모지와 역할을 하나 이상 등록해 주세요.',
          ephemeral: true,
        });
      }

      const me = guild.members.me;
      const perms = channel.permissionsFor(me);
      if (!perms?.has([PermissionFlagsBits.SendMessages, PermissionFlagsBits.AddReactions, PermissionFlagsBits.ReadMessageHistory])) {
        return interaction.reply({
          content: `❌ 봇에 ${channel} 채널의 **메시지 보내기 / 반응 추가 / 메시지 기록 보기** 권한이 필요합니다.`,
          ephemeral: true,
        });
      }

      await interaction.deferReply({ ephemeral: true });
      try {
        const embed = buildReactionRolePanelEmbed(guild, { title, description });
        const message = await channel.send({ embeds: [embed] });
        const reactResult = await ensurePanelReactions(message);

        const panels = getReactionRolePanels(guildId);
        settingsManager.updateGuildSettings(guildId, {
          reactionRolePanels: [...panels, { messageId: message.id, channelId: channel.id, title, description }],
        });

        let content = `✅ ${channel} 채널에 역할 패널을 게시했습니다. (이모지 ${reactResult.reacted}개 추가)\n${message.url}`;
        if (reactResult.failed.length) {
          content += `\n⚠️ 추가하지 못한 이모지: ${reactResult.failed.join(' ')} — 이모지를 확인하고 \`/이모지역할 갱신\` 를 실행해 주세요.`;
        }
        return interaction.editReply({ content });
      } catch (error) {
        console.error('[ReactionRole] 패널 게시 오류:', error);
        return interaction.editReply({ content: '❌ 패널을 게시하는 중 오류가 발생했습니다.' });
      }
    }

    // 5. 패널 갱신
    if (subcommand === '갱신') {
      const panels = getReactionRolePanels(guildId);
      if (!panels.length) {
        return interaction.reply({ content: '❌ 게시된 패널이 없습니다. `/이모지역할 패널` 로 먼저 게시하세요.', ephemeral: true });
      }

      await interaction.deferReply({ ephemeral: true });
      const kept = [];
      let updated = 0;
      let reacted = 0;
      const failedEmojis = new Set();

      for (const panel of panels) {
        try {
          const channel = await guild.channels.fetch(panel.channelId).catch(() => null);
          if (!channel?.isTextBased()) continue; // 채널 삭제됨 → 패널 목록에서 제외
          const message = await channel.messages.fetch(panel.messageId).catch(() => null);
          if (!message) continue; // 메시지 삭제됨 → 제외

          await message.edit({ embeds: [buildReactionRolePanelEmbed(guild, { title: panel.title, description: panel.description })] });
          const reactResult = await ensurePanelReactions(message);
          reacted += reactResult.reacted;
          reactResult.failed.forEach(e => failedEmojis.add(e));
          kept.push(panel);
          updated++;
        } catch (error) {
          console.error(`[ReactionRole] 패널 갱신 실패 (${panel.messageId}):`, error.message);
          kept.push(panel);
        }
      }

      settingsManager.updateGuildSettings(guildId, { reactionRolePanels: kept });

      let content = `✅ 패널 ${updated}개 갱신 완료 (이모지 ${reacted}개 추가, 삭제된 패널 ${panels.length - kept.length}개 정리)`;
      if (failedEmojis.size) content += `\n⚠️ 추가하지 못한 이모지: ${[...failedEmojis].join(' ')}`;
      return interaction.editReply({ content });
    }
  },
};
