import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { CommandTier, ADMIN_DEFAULT_PERMISSION } from '../../core/permissions.js';
import { settingsManager } from '../../stores/settingsManager.js';
import {
  MAX_REACTION_ROLES,
  checkBotCanManageRole,
  getDangerousPermissions,
  parseEmojiInput,
  getReactionRoles,
  getReactionRolePanels,
  syncReactionRolePanel,
  describePanelSync,
  mappingDisplay,
} from '../../services/roleManager.js';

/** 등록 목록이 바뀐 뒤 역할 패널 자동 갱신 (패널 채널이 없으면 안내만) */
async function syncPanelText(guild) {
  try {
    return describePanelSync(await syncReactionRolePanel(guild));
  } catch (error) {
    console.error('[ReactionRole] 패널 자동 갱신 오류:', error);
    return '⚠️ 패널을 갱신하지 못했습니다. 봇의 패널 채널 권한을 확인한 뒤 `/역할 갱신` 을 실행해 주세요.';
  }
}

export default {
  tier: CommandTier.ADMIN,
  data: new SlashCommandBuilder()
    .setName('역할')
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
        .setDescription('/연결 채널 역할패널 로 지정한 채널에 역할 패널을 게시하거나 갱신합니다. (항상 1개만 유지)')
        .addStringOption(opt => opt.setName('제목').setDescription('패널 제목 (비우면 기존 제목 유지, 기본: 🎭 역할 선택)').setMaxLength(256))
        .addStringOption(opt => opt.setName('설명').setDescription('패널 상단 안내 문구 (비우면 기존 문구 유지)').setMaxLength(1000))
    )
    .addSubcommand(sub =>
      sub
        .setName('갱신')
        .setDescription('역할 패널을 현재 목록으로 갱신하고, 빠진 이모지 반응은 다시 달고 해제된 이모지는 정리합니다.')
    ),

  /** @param {import('discord.js').ChatInputCommandInteraction} interaction */
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

      // 패널 갱신은 3초를 넘길 수 있으므로 지연 응답
      await interaction.deferReply();
      const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle(existingByRole ? '✅ 이모지 역할 수정 완료' : '✅ 이모지 역할 등록 완료')
        .setDescription(`${emoji.display} 이모지를 누르면 ${role} 역할이 부여됩니다.${description ? `\n설명: ${description}` : ''}`)
        .addFields({ name: '패널', value: await syncPanelText(guild) })
        .setTimestamp();
      return interaction.editReply({ embeds: [embed] });
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

      await interaction.deferReply();
      const embed = new EmbedBuilder()
        .setColor(0xED4245)
        .setTitle('🗑️ 이모지 역할 해제')
        .setDescription(`${mappingDisplay(target)} ↔ ${role} 연결을 해제했습니다. 이미 역할을 가진 멤버는 그대로 유지됩니다.`)
        .addFields({ name: '패널', value: await syncPanelText(guild) })
        .setTimestamp();
      return interaction.editReply({ embeds: [embed] });
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
        : '등록된 이모지 역할이 없습니다. `/역할 추가` 로 추가하세요.';

      const panelChannelId = settingsManager.resolveId(settingsManager.getGuildSettings(guildId), 'rolePanelChannelId');
      const panelText =
        (panelChannelId ? `패널 채널: <#${panelChannelId}>\n` : '패널 채널 미연결 · `/연결 채널 역할패널 <채널>` 로 지정하세요.\n') +
        (panels.length
          ? panels.map(p => `• https://discord.com/channels/${guildId}/${p.channelId}/${p.messageId}`).join('\n')
          : '게시된 패널이 없습니다.');

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

    // 4. 패널 게시/갱신 (지정 채널에 1개만 유지, 제목·설명을 넣으면 변경)
    // 5. 패널 갱신 (현재 목록 반영)
    if (subcommand === '패널' || subcommand === '갱신') {
      const overrides = {};
      if (subcommand === '패널') {
        const title = interaction.options.getString('제목')?.trim();
        const description = interaction.options.getString('설명')?.trim();
        if (title) overrides.title = title;
        if (description) overrides.description = description;
      }

      await interaction.deferReply({ ephemeral: true });
      try {
        const result = await syncReactionRolePanel(guild, overrides);
        const ok = result.status === 'created' || result.status === 'updated';
        return interaction.editReply({ content: `${ok ? '✅' : '❌'} ${describePanelSync(result)}` });
      } catch (error) {
        console.error('[ReactionRole] 패널 게시/갱신 오류:', error);
        return interaction.editReply({ content: '❌ 패널을 게시하는 중 오류가 발생했습니다. 봇의 패널 채널 권한을 확인해 주세요.' });
      }
    }
  },
};
