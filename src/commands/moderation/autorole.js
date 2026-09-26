import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { settingsManager } from '../../utils/settingsManager.js';
import { config } from '../../config.js';
import { checkBotCanManageRole, resolveAutoRoleId, applyRoleToAllMembers, getDangerousPermissions } from '../../utils/roleManager.js';

const DEFAULT_ROLE_NAME = '포켓몬';

export default {
  data: new SlashCommandBuilder()
    .setName('autorole')
    .setDescription('신규 멤버 입장 시 자동으로 부여할 구성원 역할을 설정합니다.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addSubcommand(sub =>
      sub
        .setName('setup')
        .setDescription('구성원 역할을 새로 만들어 자동 역할로 지정하고, 기존 멤버 전체에게도 부여합니다.')
        .addStringOption(opt =>
          opt
            .setName('name')
            .setDescription(`생성할 역할 이름 (기본: ${DEFAULT_ROLE_NAME})`)
            .setMaxLength(100)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('set')
        .setDescription('이미 있는 역할을 자동 역할로 지정합니다.')
        .addRoleOption(opt =>
          opt
            .setName('role')
            .setDescription('신규 멤버에게 자동으로 부여할 역할')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('apply')
        .setDescription('현재 서버의 모든 멤버(봇 제외)에게 자동 역할을 일괄 부여합니다.')
    )
    .addSubcommand(sub =>
      sub
        .setName('view')
        .setDescription('현재 자동 역할 설정을 확인합니다.')
    )
    .addSubcommand(sub =>
      sub
        .setName('disable')
        .setDescription('자동 역할 부여를 비활성화합니다.')
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const guild = interaction.guild;
    if (!guild) {
      return interaction.reply({ content: '❌ 서버 안에서만 사용할 수 있습니다.', ephemeral: true });
    }

    // 지정하려는 역할이 자동 역할로 적합한지 공통 검증
    const validateRole = role => {
      const check = checkBotCanManageRole(guild, role);
      if (!check.ok) return `❌ ${check.reason}`;
      const dangerous = getDangerousPermissions(role);
      if (dangerous.length) {
        return `❌ ${role} 역할에는 **${dangerous.join(', ')}** 권한이 있어 모든 신규 멤버에게 자동 부여할 수 없습니다. 일반 구성원용 역할을 사용해 주세요.`;
      }
      return null;
    };

    // 1. 역할 생성 + 지정 + 기존 멤버 일괄 부여
    if (subcommand === 'setup') {
      const name = interaction.options.getString('name')?.trim() || DEFAULT_ROLE_NAME;
      await interaction.deferReply();

      try {
        const me = guild.members.me;
        if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
          return interaction.editReply({ content: '❌ 봇에 **역할 관리(Manage Roles)** 권한이 없어 역할을 만들 수 없습니다.' });
        }

        // 같은 이름의 역할이 있으면 재사용
        let role = guild.roles.cache.find(r => r.name === name && r.id !== guild.id && !r.managed);
        let created = false;
        if (!role) {
          role = await guild.roles.create({
            name,
            mentionable: false,
            hoist: false,
            reason: '/autorole setup 으로 생성된 구성원 역할',
          });
          created = true;
        }

        const problem = validateRole(role);
        if (problem) return interaction.editReply({ content: problem });

        settingsManager.updateGuildSettings(guild.id, { autoRoleId: role.id });
        const result = await applyRoleToAllMembers(guild, role);

        const embed = new EmbedBuilder()
          .setColor(0x57F287)
          .setTitle('🎉 자동 역할 설정 완료!')
          .setDescription(`이제 새로 들어오는 멤버에게 ${role} 역할이 자동으로 부여됩니다.`)
          .addFields(
            { name: '🎭 역할', value: `${role} (${created ? '새로 생성' : '기존 역할 사용'})`, inline: true },
            { name: '👥 기존 멤버 적용', value: `부여 ${result.added}명 · 이미 보유 ${result.skipped}명 · 실패 ${result.failed}명`, inline: true }
          )
          .setFooter({ text: '역할 색상/권한은 서버 설정 > 역할에서 자유롭게 바꿀 수 있습니다.' })
          .setTimestamp();

        return interaction.editReply({ embeds: [embed] });
      } catch (error) {
        console.error('[AutoRole] setup 오류:', error);
        return interaction.editReply({ content: '❌ 역할을 생성하거나 설정하는 중 오류가 발생했습니다.' });
      }
    }

    // 2. 기존 역할 지정
    if (subcommand === 'set') {
      const role = interaction.options.getRole('role');
      const problem = validateRole(role);
      if (problem) return interaction.reply({ content: problem, ephemeral: true });

      settingsManager.updateGuildSettings(guild.id, { autoRoleId: role.id });

      const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle('✅ 자동 역할 설정 완료')
        .setDescription(`이제 새로 들어오는 멤버에게 ${role} 역할이 자동으로 부여됩니다.\n기존 멤버에게도 적용하려면 \`/autorole apply\` 를 실행하세요.`)
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    }

    // 3. 기존 멤버 일괄 적용
    if (subcommand === 'apply') {
      const roleId = resolveAutoRoleId(guild.id);
      const role = roleId ? guild.roles.cache.get(roleId) : null;
      if (!role) {
        return interaction.reply({
          content: '❌ 자동 역할이 설정되어 있지 않습니다. `/autorole setup` 또는 `/autorole set` 으로 먼저 지정해 주세요.',
          ephemeral: true,
        });
      }
      const problem = validateRole(role);
      if (problem) return interaction.reply({ content: problem, ephemeral: true });

      await interaction.deferReply();
      try {
        const result = await applyRoleToAllMembers(guild, role);
        const embed = new EmbedBuilder()
          .setColor(result.failed ? 0xFEE75C : 0x57F287)
          .setTitle('✅ 자동 역할 일괄 적용 완료')
          .setDescription(`${role} 역할을 서버 멤버 전체에 적용했습니다.`)
          .addFields(
            { name: '👥 대상 멤버', value: `${result.total}명`, inline: true },
            { name: '➕ 새로 부여', value: `${result.added}명`, inline: true },
            { name: '⏭️ 이미 보유', value: `${result.skipped}명`, inline: true },
            { name: '❌ 실패', value: `${result.failed}명`, inline: true }
          )
          .setTimestamp();
        return interaction.editReply({ embeds: [embed] });
      } catch (error) {
        console.error('[AutoRole] apply 오류:', error);
        return interaction.editReply({ content: '❌ 역할을 일괄 부여하는 중 오류가 발생했습니다.' });
      }
    }

    // 4. 설정 확인
    if (subcommand === 'view') {
      const settings = settingsManager.getGuildSettings(guild.id);
      const roleId = resolveAutoRoleId(guild.id);
      const role = roleId ? guild.roles.cache.get(roleId) : null;
      const source = settings.autoRoleId === undefined && config.autoRoleId ? '.env (AUTO_ROLE_ID)' : '슬래시 명령어 설정';

      let statusText;
      if (!roleId) statusText = '🚫 비활성화 (설정된 역할 없음)';
      else if (!role) statusText = `⚠️ 설정된 역할(\`${roleId}\`)이 서버에 없습니다. 다시 지정해 주세요.`;
      else {
        const check = checkBotCanManageRole(guild, role);
        statusText = check.ok ? `✅ ${role} 자동 부여 중` : `⚠️ ${role} 설정됨 · 부여 불가\n${check.reason}`;
      }

      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('⚙️ 자동 역할 설정')
        .addFields(
          { name: '상태', value: statusText },
          { name: '설정 출처', value: source, inline: true },
          { name: '봇 최상위 역할', value: `${guild.members.me?.roles.highest ?? '알 수 없음'}`, inline: true }
        )
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    }

    // 5. 비활성화
    if (subcommand === 'disable') {
      settingsManager.updateGuildSettings(guild.id, { autoRoleId: null });
      const embed = new EmbedBuilder()
        .setColor(0xED4245)
        .setTitle('🚫 자동 역할 비활성화')
        .setDescription('이제 신규 멤버에게 역할을 자동으로 부여하지 않습니다. 기존 멤버의 역할은 그대로 유지됩니다.')
        .setTimestamp();
      return interaction.reply({ embeds: [embed] });
    }
  },
};
