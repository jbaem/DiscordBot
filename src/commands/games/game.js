import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { CommandTier } from '../../core/permissions.js';
import { settingsManager } from '../../stores/settingsManager.js';
import { pointsManager, POINT_RULES } from '../../stores/pointsManager.js';
import { toDayKey } from '../../stores/activityManager.js';
import { playSolo, playDuel } from '../../services/games/rockPaperScissors.js';
import { playSoloGame } from '../../services/games/soloSession.js';
import { ODD_EVEN, DICE, SLOT } from '../../services/games/miniGames.js';
import { isPlaying } from '../../services/games/sessions.js';
import { getShopItems, purchase, durationText } from '../../services/shop.js';
import { lotteryManager, LOTTERY_RULES } from '../../stores/lotteryManager.js';
import { buyTickets, groupNumbers } from '../../services/games/lottery.js';

/** 베팅 범위 */
export const MIN_BET = 1;
export const MAX_BET = 100_000;
/** 한 번에 선물할 수 있는 최대 포인트 */
const MAX_GIFT = 1_000_000_000;
/** 순위에 보여 줄 인원 */
const RANKING_SIZE = 10;

const p = n => `${n.toLocaleString()}P`;

/** 봇 상대 1인용 미니게임: 서브커맨드 이름 → 게임 정의 */
const MINI_GAMES = { 홀짝: ODD_EVEN, 주사위: DICE, 슬롯: SLOT };

/** 베팅 옵션 (모든 게임 공통) */
const betOption = opt =>
  opt
    .setName('베팅')
    .setDescription(`걸 포인트 (${MIN_BET}~${MAX_BET.toLocaleString()}P)`)
    .setRequired(true)
    .setMinValue(MIN_BET)
    .setMaxValue(MAX_BET);

/** 게임 시작 전 공통 확인 (등록·잔액) — 문제가 있으면 안내 문구 */
function checkBet(guildId, userId, bet) {
  if (!pointsManager.isRegistered(guildId, userId)) return '🎮 먼저 `/게임 등록` 으로 게임랜드에 등록해 주세요.';
  const balance = pointsManager.get(guildId, userId).balance;
  if (balance < bet) return `💸 포인트가 부족합니다. (잔액 ${p(balance)}, 베팅 ${p(bet)})`;
  return null;
}
const record = r => `${r.wins}승 ${r.losses}패 ${r.draws}무`;

/** 게임은 /연결 채널 게임랜드 로 연결한 채널에서만 */
function checkGameChannel(interaction) {
  const channelId = settingsManager.resolveId(settingsManager.getGuildSettings(interaction.guild.id), 'gameChannelId');
  if (!channelId) return '🎮 아직 게임랜드 채널이 없습니다. 관리자가 `/연결 채널 게임랜드` 로 채널을 연결해야 합니다.';
  if (interaction.channelId !== channelId) return `🎮 게임은 <#${channelId}> 채널에서만 할 수 있습니다.`;
  return null;
}

export default {
  tier: CommandTier.EVERYONE,
  data: new SlashCommandBuilder()
    .setName('게임')
    .setDescription('게임랜드: 포인트를 걸고 게임을 합니다.')
    .addSubcommand(sub =>
      sub.setName('등록').setDescription(`게임랜드에 등록하고 시작 포인트 ${POINT_RULES.START_POINTS.toLocaleString()}P를 받습니다. (1번만)`)
    )
    .addSubcommand(sub =>
      sub
        .setName('가위바위보')
        .setDescription('가위바위보를 합니다. 상대를 비우면 봇과 1인용, 지정하면 그 멤버와 대결합니다.')
        .addIntegerOption(betOption)
        .addUserOption(opt => opt.setName('상대').setDescription('대결할 멤버 (비우면 봇과 대결)'))
    )
    .addSubcommand(sub => sub.setName('홀짝').setDescription('1~100 중 뽑힌 수가 홀일지 짝일지 맞힙니다. (봇 상대)').addIntegerOption(betOption))
    .addSubcommand(sub => sub.setName('주사위').setDescription('봇과 주사위 2개씩 굴려 합이 큰 쪽이 이깁니다.').addIntegerOption(betOption))
    .addSubcommand(sub => sub.setName('슬롯').setDescription('슬롯머신을 돌립니다. 7️⃣7️⃣7️⃣ 은 베팅의 20배!').addIntegerOption(betOption))
    .addSubcommand(sub =>
      sub
        .setName('선물')
        .setDescription('다른 멤버에게 내 포인트를 보냅니다.')
        .addUserOption(opt => opt.setName('유저').setDescription('받을 멤버').setRequired(true))
        .addIntegerOption(opt =>
          opt.setName('금액').setDescription('보낼 포인트').setRequired(true).setMinValue(1).setMaxValue(MAX_GIFT)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('포인트')
        .setDescription('포인트와 전적을 확인합니다. (본인에게만 표시)')
        .addUserOption(opt => opt.setName('유저').setDescription('확인할 멤버 (비우면 나)'))
    )
    .addSubcommand(sub => sub.setName('순위').setDescription(`포인트 순위 상위 ${RANKING_SIZE}명을 확인합니다.`))
    .addSubcommand(sub =>
      sub
        .setName('복권')
        .setDescription(`매주 일요일 밤 ${LOTTERY_RULES.DRAW_HOUR}시 추첨! 장수를 넣으면 구매, 비우면 이번 회차 정보 (본인에게만 표시)`)
        .addIntegerOption(opt =>
          opt
            .setName('장수')
            .setDescription(`살 장수 (장당 ${LOTTERY_RULES.TICKET_PRICE.toLocaleString()}P)`)
            .setMinValue(1)
            .setMaxValue(LOTTERY_RULES.MAX_TICKETS_PER_USER)
        )
        .addIntegerOption(opt =>
          opt.setName('번호').setDescription(`고를 번호 1~${LOTTERY_RULES.NUMBERS} (비우면 장마다 무작위)`).setMinValue(1).setMaxValue(LOTTERY_RULES.NUMBERS)
        )
    )
    .addSubcommand(sub => sub.setName('상점').setDescription('포인트로 살 수 있는 역할 목록을 봅니다. (본인에게만 표시)'))
    .addSubcommand(sub =>
      sub
        .setName('구매')
        .setDescription('상점에서 역할을 삽니다.')
        .addStringOption(opt => opt.setName('상품').setDescription('살 상품 (입력창 목록에서 선택)').setRequired(true).setAutocomplete(true))
    ),

  /** /게임 구매 상품 자동완성: 상점 목록 */
  async autocomplete(interaction) {
    const typed = interaction.options.getFocused().toLowerCase();
    const choices = getShopItems(interaction.guildId)
      .map(item => {
        const role = interaction.guild?.roles.cache.get(item.roleId);
        return role ? { name: `${role.name} · ${p(item.price)} · ${durationText(item.days)}`.slice(0, 100), value: item.roleId } : null;
      })
      .filter(c => c && (!typed || c.name.toLowerCase().includes(typed)))
      .slice(0, 25);
    await interaction.respond(choices);
  },

  /** @param {import('discord.js').ChatInputCommandInteraction} interaction */
  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const { guild, user } = interaction;
    if (!guild) {
      return interaction.reply({ content: '❌ 서버 안에서만 사용할 수 있습니다.', ephemeral: true });
    }

    // 포인트 확인 (어디서나, 본인에게만)
    if (subcommand === '포인트') {
      const target = interaction.options.getUser('유저') ?? user;
      const r = pointsManager.get(guild.id, target.id);
      if (!r.registeredAt && r.balance === 0) {
        const who = target.id === user.id ? '아직 게임랜드에 등록하지 않았습니다. `/게임 등록` 으로 시작하세요!' : `${target} 님은 아직 게임랜드에 등록하지 않았습니다.`;
        return interaction.reply({ content: `🎮 ${who}`, ephemeral: true });
      }
      const rank = pointsManager.ranking(guild.id).findIndex(x => x.userId === target.id) + 1;
      const today = r.activityDay === toDayKey() ? r.activityToday : 0;
      const bonus = r.dailyMessageDay === toDayKey() ? '받음' : '아직 (오늘 첫 메시지를 보내면 지급)';
      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(`🎮 ${target.username} 님의 포인트`)
        .addFields(
          { name: '💰 잔액', value: `**${p(r.balance)}**${rank ? ` · ${rank}위` : ''}`, inline: true },
          { name: '⚔️ 전적', value: `${record(r)}\n🔥 봇 상대 ${r.soloStreak || 0}연승 중 (최고 ${r.bestSoloStreak || 0})`, inline: true },
          { name: '📈 오늘 활동 적립', value: p(today), inline: true },
          { name: '💬 오늘 첫 메시지 보너스', value: bonus, inline: false }
        );
      const rentals = Object.entries(r.rentals || {});
      if (rentals.length) {
        embed.addFields({
          name: '🛍️ 상점 아이템',
          value: rentals.map(([roleId, expiresAt]) => `<@&${roleId}> · ${expiresAt ? `<t:${Math.floor(expiresAt / 1000)}:R> 만료` : '영구'}`).join('\n'),
        });
      }
      if (!r.registeredAt) embed.setFooter({ text: '아직 /게임 등록 을 하지 않아 활동 적립과 게임은 등록 후부터 가능합니다.' });
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // 순위 (게임랜드 채널에서는 모두에게, 다른 채널에서는 본인에게만)
    if (subcommand === '순위') {
      const ranking = pointsManager.ranking(guild.id);
      if (!ranking.length) return interaction.reply({ content: '🎮 아직 등록한 멤버가 없습니다.', ephemeral: true });
      const medal = i => ['🥇', '🥈', '🥉'][i] ?? `${i + 1}.`;
      const lines = ranking.slice(0, RANKING_SIZE).map((r, i) => `${medal(i)} <@${r.userId}> **${p(r.balance)}** · ${record(r)}`);
      const myRank = ranking.findIndex(r => r.userId === user.id);
      if (myRank >= RANKING_SIZE) lines.push(`…\n${myRank + 1}. <@${user.id}> **${p(ranking[myRank].balance)}** (나)`);
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(0xFEE75C).setTitle(`🏆 포인트 순위 (등록 ${ranking.length}명)`).setDescription(lines.join('\n'))],
        allowedMentions: { parse: [] },
        ephemeral: Boolean(checkGameChannel(interaction)),
      });
    }

    // 복권 (어디서나, 본인에게만)
    if (subcommand === '복권') {
      const count = interaction.options.getInteger('장수');
      const number = interaction.options.getInteger('번호');
      if (count) {
        if (!pointsManager.isRegistered(guild.id, user.id)) {
          return interaction.reply({ content: '🎮 먼저 `/게임 등록` 으로 게임랜드에 등록해 주세요.', ephemeral: true });
        }
        const result = buyTickets(guild.id, user.id, count, number);
        if (!result.ok) return interaction.reply({ content: `❌ ${result.reason}`, ephemeral: true });
        console.log(`[Lottery] ${guild.name}: ${user.tag} 제${result.round}회 ${count}장 구매`);
        return interaction.reply({
          content:
            `🎟️ 제${result.round}회 복권 ${count}장을 샀습니다! (${groupNumbers(result.numbers)}) ` +
            `-${p(count * LOTTERY_RULES.TICKET_PRICE)} → 잔액 **${p(result.balance)}** · 현재 당첨금 **${p(result.pot)}**`,
          ephemeral: true,
        });
      }
      const round = lotteryManager.getRound(guild.id);
      const mine = lotteryManager.ticketsOf(guild.id, user.id);
      const last = round.last;
      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(`🎟️ 제${round.round}회 복권`)
        .setDescription(
          `추첨: <t:${Math.floor(round.drawAt / 1000)}:F> (<t:${Math.floor(round.drawAt / 1000)}:R>)\n` +
            `당첨금 **${p(lotteryManager.pot(guild.id))}**${round.carry ? ` (이월 ${p(round.carry)} 포함)` : ''} · 판매 ${round.tickets.length.toLocaleString()}장\n\n` +
            `장당 ${p(LOTTERY_RULES.TICKET_PRICE)} · 번호 1~${LOTTERY_RULES.NUMBERS} · 1인 최대 ${LOTTERY_RULES.MAX_TICKETS_PER_USER}장\n` +
            `당첨 번호 티켓끼리 당첨금을 나누고, 당첨자가 없으면 다음 회차로 이월 (판매액의 ${Math.round(LOTTERY_RULES.POT_RATE * 100)}%가 당첨금)`
        )
        .addFields({ name: '🎫 내 티켓', value: mine.length ? `${mine.length}장 · ${groupNumbers(mine)}`.slice(0, 1024) : '없음 · `/게임 복권 장수:<n>` 으로 구매' });
      if (last) {
        const myPrize = last.winners?.find(w => w.userId === user.id);
        embed.addFields({
          name: `📜 지난 회차 (제${last.round}회)`,
          value:
            `당첨 번호 **${last.number}번** · ${last.winners?.length ? `당첨 ${last.winners.length}명` : '당첨자 없음 (이월)'}` +
            (myPrize ? ` · 🎉 내 당첨금 +${p(myPrize.prize)}` : ''),
        });
      }
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // 상점 목록 (어디서나, 본인에게만)
    if (subcommand === '상점') {
      const items = getShopItems(guild.id).filter(item => guild.roles.cache.has(item.roleId));
      if (!items.length) return interaction.reply({ content: '🛒 아직 상점에 상품이 없습니다.', ephemeral: true });
      const rentals = pointsManager.getRentals(guild.id, user.id);
      const lines = items.map(item => {
        const owned = item.roleId in rentals
          ? ` · ✅ ${rentals[item.roleId] ? `<t:${Math.floor(rentals[item.roleId] / 1000)}:R> 만료` : '보유 중'}`
          : '';
        return `<@&${item.roleId}> · **${p(item.price)}** · ${durationText(item.days)}${item.description ? ` · ${item.description}` : ''}${owned}`;
      });
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xEB459E)
            .setTitle('🛒 포인트 상점')
            .setDescription(lines.join('\n'))
            .setFooter({ text: `내 잔액 ${p(pointsManager.get(guild.id, user.id).balance)} · /게임 구매 로 사기 · 기간제는 다시 사면 연장` }),
        ],
        ephemeral: true,
      });
    }

    if (subcommand === '구매') {
      if (!pointsManager.isRegistered(guild.id, user.id)) {
        return interaction.reply({ content: '🎮 먼저 `/게임 등록` 으로 게임랜드에 등록해 주세요.', ephemeral: true });
      }
      const member = interaction.member ?? (await guild.members.fetch(user.id));
      const result = await purchase(guild, member, interaction.options.getString('상품'));
      if (!result.ok) return interaction.reply({ content: `❌ ${result.reason}`, ephemeral: true });
      const until = result.expiresAt ? `<t:${Math.floor(result.expiresAt / 1000)}:f> 까지${result.extended ? ' (기간 연장)' : ''}` : '영구';
      console.log(`[Shop] ${guild.name}: ${user.tag} 구매 ${result.role.name} ${result.item.price}P`);
      return interaction.reply({
        content: `🛍️ ${result.role} 을(를) 샀습니다! -${p(result.item.price)} → 잔액 **${p(result.balance)}** · ${until}`,
        ephemeral: true,
      });
    }

    // 이하 게임랜드 채널에서만
    const channelError = checkGameChannel(interaction);
    if (channelError) return interaction.reply({ content: channelError, ephemeral: true });

    if (subcommand === '등록') {
      const { registered, balance } = pointsManager.register(guild.id, user.id);
      if (!registered) {
        return interaction.reply({ content: `🎮 이미 등록했습니다. 현재 잔액 **${p(balance)}**`, ephemeral: true });
      }
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x57F287)
            .setTitle('🎮 게임랜드 등록 완료!')
            .setDescription(
              `${user} 님, 환영합니다! 시작 포인트 **${p(POINT_RULES.START_POINTS)}** 를 받았습니다. (잔액 ${p(balance)})\n\n` +
                `• 하루의 첫 메시지 ${p(POINT_RULES.DAILY_FIRST_MESSAGE_POINTS)}, 음성 채널 1시간당 ${p(POINT_RULES.VOICE_POINTS_PER_HOUR)} 자동 적립\n` +
                `• \`/게임 가위바위보 베팅:<포인트>\` 로 봇과, \`상대:@멤버\` 를 지정하면 멤버와 대결 (베팅 최대 ${p(MAX_BET)})\n` +
                '• `/게임 선물` 로 다른 멤버에게 포인트를 보낼 수 있습니다.'
            ),
        ],
      });
    }

    if (subcommand === '선물') {
      const target = interaction.options.getUser('유저');
      const amount = interaction.options.getInteger('금액');
      if (!pointsManager.isRegistered(guild.id, user.id)) {
        return interaction.reply({ content: '🎮 먼저 `/게임 등록` 으로 게임랜드에 등록해 주세요.', ephemeral: true });
      }
      if (target.id === user.id) return interaction.reply({ content: '🙅 자기 자신에게는 보낼 수 없습니다.', ephemeral: true });
      if (target.bot) return interaction.reply({ content: '🙅 봇에게는 보낼 수 없습니다.', ephemeral: true });
      if (!pointsManager.isRegistered(guild.id, target.id)) {
        return interaction.reply({ content: `🎮 ${target} 님은 아직 게임랜드에 등록하지 않았습니다.`, ephemeral: true });
      }
      if (isPlaying(guild.id, user.id)) {
        return interaction.reply({ content: '⏳ 게임 중에는 포인트를 보낼 수 없습니다. 게임이 끝난 뒤 다시 시도해 주세요.', ephemeral: true });
      }
      const result = pointsManager.transfer(guild.id, user.id, target.id, amount);
      if (!result.ok) {
        return interaction.reply({ content: `💸 포인트가 부족합니다. (잔액 ${p(result.balance)}, 보낼 금액 ${p(amount)})`, ephemeral: true });
      }
      console.log(`[Points] ${guild.name}: ${user.tag} → ${target.tag} 선물 ${amount}`);
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xEB459E)
            .setTitle('🎁 포인트 선물')
            .setDescription(`${user} 님이 ${target} 님에게 **${p(amount)}** 를 보냈습니다!\n${user} 잔액 ${p(result.from)} · ${target} 잔액 ${p(result.to)}`),
        ],
        allowedMentions: { users: [target.id] },
      });
    }

    if (MINI_GAMES[subcommand]) {
      const bet = interaction.options.getInteger('베팅');
      const betError = checkBet(guild.id, user.id, bet);
      if (betError) return interaction.reply({ content: betError, ephemeral: true });
      return playSoloGame(interaction, MINI_GAMES[subcommand], bet);
    }

    if (subcommand === '가위바위보') {
      const bet = interaction.options.getInteger('베팅');
      const opponent = interaction.options.getUser('상대');

      const betError = checkBet(guild.id, user.id, bet);
      if (betError) return interaction.reply({ content: betError, ephemeral: true });
      if (!opponent) return playSolo(interaction, bet);

      if (opponent.id === user.id) return interaction.reply({ content: '🙅 자기 자신과는 대결할 수 없습니다.', ephemeral: true });
      if (opponent.bot) return interaction.reply({ content: '🙅 봇과 하려면 `상대` 를 비워 주세요.', ephemeral: true });
      if (!pointsManager.isRegistered(guild.id, opponent.id)) {
        return interaction.reply({ content: `🎮 ${opponent} 님은 아직 게임랜드에 등록하지 않았습니다.`, ephemeral: true });
      }
      const opponentBalance = pointsManager.get(guild.id, opponent.id).balance;
      if (opponentBalance < bet) {
        return interaction.reply({ content: `💸 ${opponent} 님의 포인트가 베팅액보다 적습니다. (잔액 ${p(opponentBalance)})`, ephemeral: true });
      }
      return playDuel(interaction, opponent, bet);
    }
  },
};
