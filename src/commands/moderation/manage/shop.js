import { EmbedBuilder } from 'discord.js';
import { checkMemberCanManageRole } from '../../../services/roleManager.js';
import { getShopItems, upsertShopItem, removeShopItem, checkSellableRole, durationText } from '../../../services/shop.js';

/** 상품 가격 범위 */
const MAX_PRICE = 100_000_000;
/** 상품 최대 개수 (입력창 자동완성 목록은 25개까지) */
const MAX_ITEMS = 25;

/**
 * /관리 상점 — 포인트 상점 상품(역할) 추가 / 제거
 * (/관리 명령어의 서브커맨드 그룹, ../manage.js 에서 조립)
 */
export default {
  name: '상점',
  /** @param {import('discord.js').SlashCommandSubcommandGroupBuilder} builder */
  build(builder) {
    return builder
      .setName('상점')
      .setDescription('포인트 상점에서 팔 역할을 관리합니다.')
      .addSubcommand(sub =>
        sub
          .setName('추가')
          .setDescription('역할을 상점 상품으로 등록합니다. (이미 있으면 가격·기간·설명 변경)')
          .addRoleOption(opt => opt.setName('역할').setDescription('팔 역할 (색상·칭호 역할 등)').setRequired(true))
          .addIntegerOption(opt =>
            opt.setName('가격').setDescription('가격 (포인트)').setRequired(true).setMinValue(1).setMaxValue(MAX_PRICE)
          )
          .addIntegerOption(opt =>
            opt.setName('기간').setDescription('사용 기간(일). 비우거나 0이면 영구').setMinValue(0).setMaxValue(3650)
          )
          .addStringOption(opt => opt.setName('설명').setDescription('상점에 표시할 짧은 설명').setMaxLength(100))
      )
      .addSubcommand(sub =>
        sub
          .setName('제거')
          .setDescription('상점에서 상품을 내립니다. (이미 산 사람의 역할은 기간까지 유지)')
          .addRoleOption(opt => opt.setName('역할').setDescription('내릴 상품 역할').setRequired(true))
      );
  },

  /** @param {import('discord.js').ChatInputCommandInteraction} interaction */
  async execute(interaction) {
    const guild = interaction.guild;
    if (!guild) {
      return interaction.reply({ content: '❌ 서버 안에서만 사용할 수 있습니다.', ephemeral: true });
    }
    const subcommand = interaction.options.getSubcommand();
    const role = interaction.options.getRole('역할');

    if (subcommand === '추가') {
      const price = interaction.options.getInteger('가격');
      const days = interaction.options.getInteger('기간') ?? 0;
      const description = interaction.options.getString('설명')?.trim() || null;

      const unsellable = checkSellableRole(guild, role);
      if (unsellable) return interaction.reply({ content: `❌ ${unsellable}`, ephemeral: true });
      // 관리자가 자기보다 높은 역할을 상품으로 풀어 권한을 넘기지 못하게 (디스코드 역할 관리 규칙과 동일)
      const memberCheck = checkMemberCanManageRole(interaction, role);
      if (!memberCheck.ok) return interaction.reply({ content: `❌ ${memberCheck.reason}`, ephemeral: true });

      const items = getShopItems(guild.id);
      if (items.length >= MAX_ITEMS && !items.some(x => x.roleId === role.id)) {
        return interaction.reply({ content: `❌ 상품은 최대 ${MAX_ITEMS}개까지 등록할 수 있습니다.`, ephemeral: true });
      }
      const updated = items.some(x => x.roleId === role.id);
      upsertShopItem(guild.id, { roleId: role.id, price, days, description });
      console.log(`[Shop] ${guild.name}: 상품 ${updated ? '변경' : '추가'} ${role.name} ${price}P ${durationText(days)} by ${interaction.user.tag}`);

      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x57F287)
            .setTitle(`🛒 상점 상품 ${updated ? '변경' : '추가'}`)
            .setDescription(
              `${role} · **${price.toLocaleString()}P** · ${durationText(days)}${description ? `\n${description}` : ''}\n\n` +
                '멤버는 `/게임 상점` 으로 목록을 보고 `/게임 구매` 로 살 수 있습니다.' +
                (days > 0 ? `\n기간이 끝나면 봇이 역할을 자동으로 회수합니다. (다시 사면 남은 기간에 ${days}일 연장)` : '')
            ),
        ],
        ephemeral: true,
      });
    }

    if (subcommand === '제거') {
      if (!removeShopItem(guild.id, role.id)) {
        return interaction.reply({ content: `❌ ${role} 역할은 상점에 없습니다.`, ephemeral: true });
      }
      console.log(`[Shop] ${guild.name}: 상품 제거 ${role.name} by ${interaction.user.tag}`);
      return interaction.reply({
        content: `🛒 ${role} 을(를) 상점에서 내렸습니다. 이미 산 멤버의 역할은 기간이 끝날 때까지 유지됩니다.`,
        ephemeral: true,
      });
    }
  },
};
