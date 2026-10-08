import { EmbedBuilder } from 'discord.js';
import { pointsManager } from '../../../stores/pointsManager.js';

/** 한 번에 지급·회수할 수 있는 최대 포인트 */
const MAX_AMOUNT = 1_000_000;

const p = n => `${n.toLocaleString()}P`;

/** 서브커맨드별 동작 */
const ACTIONS = {
  지급: { sign: 1, description: '멤버에게 게임 포인트를 지급합니다. (등록하지 않은 멤버도 가능)', color: 0x57F287 },
  회수: { sign: -1, description: '멤버의 게임 포인트를 회수합니다. (잔액보다 많이 회수하면 0P)', color: 0xED4245 },
};

/**
 * /관리 포인트 — 게임 포인트 지급 / 회수
 * (/관리 명령어의 서브커맨드 그룹, ../manage.js 에서 조립)
 */
export default {
  name: '포인트',
  /** @param {import('discord.js').SlashCommandSubcommandGroupBuilder} builder */
  build(builder) {
    builder.setName('포인트').setDescription('게임 포인트를 지급하거나 회수합니다.');
    for (const [name, action] of Object.entries(ACTIONS)) {
      builder.addSubcommand(sub =>
        sub
          .setName(name)
          .setDescription(action.description)
          .addUserOption(opt => opt.setName('유저').setDescription('대상 멤버').setRequired(true))
          .addIntegerOption(opt =>
            opt.setName('금액').setDescription(`${name}할 포인트`).setRequired(true).setMinValue(1).setMaxValue(MAX_AMOUNT)
          )
          .addStringOption(opt => opt.setName('사유').setDescription('기록용 사유 (선택)').setMaxLength(100))
      );
    }
    return builder;
  },

  /** @param {import('discord.js').ChatInputCommandInteraction} interaction */
  async execute(interaction) {
    const guild = interaction.guild;
    if (!guild) {
      return interaction.reply({ content: '❌ 서버 안에서만 사용할 수 있습니다.', ephemeral: true });
    }
    const name = interaction.options.getSubcommand();
    const action = ACTIONS[name];
    const target = interaction.options.getUser('유저');
    const amount = interaction.options.getInteger('금액');
    const reason = interaction.options.getString('사유');

    if (target.bot) return interaction.reply({ content: '🙅 봇에게는 포인트를 줄 수 없습니다.', ephemeral: true });

    const { before, after, applied } = pointsManager.adjust(guild.id, target.id, action.sign * amount);
    console.log(`[Points] ${guild.name}: ${target.tag} ${name} ${applied >= 0 ? '+' : ''}${applied} (${before} → ${after}) by ${interaction.user.tag}${reason ? ` · ${reason}` : ''}`);

    const embed = new EmbedBuilder()
      .setColor(action.color)
      .setTitle(`🎮 포인트 ${name}`)
      .setDescription(
        `${target} ${applied >= 0 ? '+' : ''}${p(applied)} → 잔액 **${p(after)}** (이전 ${p(before)})` +
          (reason ? `\n사유: ${reason}` : '') +
          (action.sign < 0 && -applied < amount ? `\n※ 잔액이 ${p(amount)}보다 적어 ${p(-applied)}만 회수했습니다.` : '') +
          (!pointsManager.isRegistered(guild.id, target.id) ? '\n※ 아직 `/게임 등록` 을 하지 않은 멤버입니다. 등록하면 시작 포인트가 더해집니다.' : '')
      );
    return interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
