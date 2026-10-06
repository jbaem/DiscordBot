import { EmbedBuilder } from 'discord.js';
import { checkBotCanManageRole, checkMemberCanManageRole } from '../../../services/roleManager.js';

/** 대상 유저 옵션 (디스코드는 여러 명을 받는 옵션이 없어 칸을 나눔, 첫 칸만 필수) */
const USER_OPTIONS = ['유저', '유저2', '유저3', '유저4', '유저5'];

/** 서브커맨드별 동작 */
const ACTIONS = {
  부여: {
    verb: '부여',
    description: '지정한 유저에게 역할을 부여합니다. (최대 5명)',
    shouldSkip: hasRole => hasRole,
    skipText: '이미 보유',
    apply: (member, role, executor) => member.roles.add(role, `/관리 역할 부여 by ${executor}`),
  },
  회수: {
    verb: '회수',
    description: '지정한 유저에게서 역할을 회수합니다. (최대 5명)',
    shouldSkip: hasRole => !hasRole,
    skipText: '보유하지 않음',
    apply: (member, role, executor) => member.roles.remove(role, `/관리 역할 회수 by ${executor}`),
  },
};

/**
 * /관리 역할 — 특정 유저에게 역할 부여 / 회수
 * (/관리 명령어의 서브커맨드 그룹, ../manage.js 에서 조립)
 */
export default {
  name: '역할',
  /** @param {import('discord.js').SlashCommandSubcommandGroupBuilder} builder */
  build(builder) {
    builder.setName('역할').setDescription('특정 유저에게 역할을 부여하거나 회수합니다.');
    for (const [name, action] of Object.entries(ACTIONS)) {
      builder.addSubcommand(sub => {
        sub
          .setName(name)
          .setDescription(action.description)
          .addRoleOption(opt => opt.setName('역할').setDescription(`${action.verb}할 역할`).setRequired(true));
        USER_OPTIONS.forEach((option, i) =>
          sub.addUserOption(opt =>
            opt
              .setName(option)
              .setDescription(i === 0 ? '대상 유저' : '추가 대상 유저 (선택)')
              .setRequired(i === 0)
          )
        );
        return sub;
      });
    }
    return builder;
  },

  /** @param {import('discord.js').ChatInputCommandInteraction} interaction */
  async execute(interaction) {
    const guild = interaction.guild;
    if (!guild) {
      return interaction.reply({ content: '❌ 서버 안에서만 사용할 수 있습니다.', ephemeral: true });
    }

    const action = ACTIONS[interaction.options.getSubcommand()];
    const role = interaction.options.getRole('역할');

    // 봇과 실행자 모두 이 역할을 다룰 수 있어야 함
    for (const check of [checkBotCanManageRole(guild, role), checkMemberCanManageRole(interaction, role)]) {
      if (!check.ok) return interaction.reply({ content: `❌ ${check.reason}`, ephemeral: true });
    }

    // 같은 유저를 여러 칸에 넣은 경우 한 번만 처리
    const users = [...new Map(
      USER_OPTIONS.map(option => interaction.options.getUser(option)).filter(Boolean).map(user => [user.id, user])
    ).values()];

    // 여러 명을 처리하면 3초를 넘길 수 있으므로 지연 응답
    await interaction.deferReply({ ephemeral: true });

    const lines = [];
    let done = 0;
    for (const user of users) {
      const member = await guild.members.fetch(user.id).catch(() => null);
      if (!member) {
        lines.push(`❌ ${user} · 서버 멤버가 아님`);
        continue;
      }
      if (action.shouldSkip(member.roles.cache.has(role.id))) {
        lines.push(`⏭️ ${member} · ${action.skipText}`);
        continue;
      }
      try {
        await action.apply(member, role, interaction.user.tag);
        lines.push(`✅ ${member} · ${action.verb} 완료`);
        done++;
      } catch (error) {
        console.error(`[ManageRole] ${member.user.tag} 역할 ${action.verb} 실패:`, error.message);
        lines.push(`❌ ${member} · ${action.verb} 실패`);
      }
    }

    console.log(`[ManageRole] ${role.name} 역할 ${action.verb}: ${done}/${users.length}명 by ${interaction.user.tag}`);

    const embed = new EmbedBuilder()
      .setColor(done === users.length ? 0x57F287 : done > 0 ? 0xFEE75C : 0xED4245)
      .setTitle(`🎭 ${role.name} 역할 ${action.verb} (${done}/${users.length}명)`)
      .setDescription(lines.join('\n'))
      .setFooter({ text: `관리자: ${interaction.user.tag}` })
      .setTimestamp();
    return interaction.editReply({ embeds: [embed] });
  },
};
