import { EmbedBuilder } from 'discord.js';
import { lotteryManager, LOTTERY_RULES } from '../../stores/lotteryManager.js';
import { pointsManager } from '../../stores/pointsManager.js';
import { settingsManager } from '../../stores/settingsManager.js';
import { lockPlayers, releasePlayers } from './sessions.js';

/** 추첨 시각이 지났는지 확인하는 간격 */
export const LOTTERY_CHECK_INTERVAL_MS = 60 * 1000;

const p = n => `${n.toLocaleString()}P`;
const ts = (ms, style) => `<t:${Math.floor(ms / 1000)}:${style}>`;

/** 번호 목록 → "7번 ×3, 17번" */
export function groupNumbers(numbers) {
  const counts = new Map();
  for (const n of [...numbers].sort((a, b) => a - b)) counts.set(n, (counts.get(n) || 0) + 1);
  return [...counts].map(([n, c]) => `${n}번${c > 1 ? ` ×${c}` : ''}`).join(', ');
}

/**
 * 티켓 구매 — 번호를 고르면 모두 그 번호, 비우면 장마다 무작위
 * - 구매하는 동안 게임·선물·상점과 같은 포인트를 두 번 쓰지 못하게 잠금
 * @returns {{ ok: true, numbers: number[], balance: number, pot: number } | { ok: false, reason: string }}
 */
export function buyTickets(guildId, userId, count, number = null, now = Date.now(), random = Math.random) {
  const round = lotteryManager.getRound(guildId, now);
  const owned = lotteryManager.ticketsOf(guildId, userId).length;
  const room = LOTTERY_RULES.MAX_TICKETS_PER_USER - owned;
  if (room <= 0) return { ok: false, reason: `이번 회차에는 최대 ${LOTTERY_RULES.MAX_TICKETS_PER_USER}장까지 살 수 있습니다.` };
  if (count > room) return { ok: false, reason: `이번 회차에 ${room}장 더 살 수 있습니다. (이미 ${owned}장)` };
  if (lockPlayers(guildId, [userId])) return { ok: false, reason: '게임 중에는 살 수 없습니다. 게임이 끝난 뒤 다시 시도해 주세요.' };
  try {
    const cost = count * LOTTERY_RULES.TICKET_PRICE;
    const spent = pointsManager.spend(guildId, userId, cost, now);
    if (!spent.ok) return { ok: false, reason: `포인트가 부족합니다. (잔액 ${p(spent.balance)}, ${count}장 ${p(cost)})` };
    const numbers = Array.from({ length: count }, () => number ?? 1 + Math.floor(random() * LOTTERY_RULES.NUMBERS));
    lotteryManager.addTickets(guildId, userId, numbers);
    return { ok: true, numbers, balance: spent.balance, pot: lotteryManager.pot(guildId), round: round.round };
  } finally {
    releasePlayers(guildId, [userId]);
  }
}

/**
 * 추첨 — 당첨 번호를 뽑아 그 번호 티켓끼리 당첨금을 나눔 (나머지·당첨자 없음은 다음 회차로 이월)
 * @returns {object} 결과 { round, number, pot, winners: [{ userId, tickets, prize }], carry, ticketCount, players }
 */
export function drawLottery(guildId, now = Date.now(), random = Math.random) {
  const round = lotteryManager.getRound(guildId, now);
  const pot = lotteryManager.pot(guildId);
  const number = 1 + Math.floor(random() * LOTTERY_RULES.NUMBERS);
  const winning = round.tickets.filter(t => t.number === number);

  const byUser = new Map();
  for (const t of winning) byUser.set(t.userId, (byUser.get(t.userId) || 0) + 1);
  const perTicket = winning.length ? Math.floor(pot / winning.length) : 0;
  const winners = [...byUser].map(([userId, tickets]) => ({ userId, tickets, prize: perTicket * tickets }));
  for (const w of winners) pointsManager.adjust(guildId, w.userId, w.prize, now);

  const paid = winners.reduce((n, w) => n + w.prize, 0);
  const result = {
    round: round.round,
    number,
    pot,
    winners,
    carry: pot - paid, // 당첨자가 없으면 전액, 있으면 나누고 남은 자투리
    ticketCount: round.tickets.length,
    players: new Set(round.tickets.map(t => t.userId)).size,
    drawnAt: now,
  };
  lotteryManager.closeRound(guildId, result, result.carry, now);
  return result;
}

/** 추첨 결과 발표 임베드 */
export function buildDrawEmbed(result, nextAt) {
  const lines = [`당첨 번호 **${result.number}번** · 판매 ${result.ticketCount.toLocaleString()}장 (${result.players}명) · 당첨금 ${p(result.pot)}`];
  if (result.winners.length) {
    lines.push('', '🎉 **당첨자**', ...result.winners.map(w => `<@${w.userId}> ${w.tickets}장 → **+${p(w.prize)}**`));
  } else {
    lines.push('', `당첨자가 없어 **${p(result.carry)}** 가 다음 회차로 이월됩니다!`);
  }
  lines.push('', `다음 추첨: ${ts(nextAt, 'F')} (${ts(nextAt, 'R')}) · \`/게임 복권\` 으로 참여`);
  return new EmbedBuilder()
    .setColor(result.winners.length ? 0xFEE75C : 0x5865F2)
    .setTitle(`🎟️ 제${result.round}회 복권 추첨 결과`)
    .setDescription(lines.join('\n'));
}

/**
 * 추첨 시각이 지난 서버를 추첨하고 게임랜드 채널에 발표 (봇이 꺼져 있던 동안 지난 추첨도 시작하면 바로)
 * - 티켓이 한 장도 없으면 발표 없이 다음 회차로 (이월금은 그대로)
 */
export async function runDueDraws(client, now = Date.now()) {
  for (const guild of client.guilds.cache.values()) {
    const round = lotteryManager.getRound(guild.id, now);
    if (now < round.drawAt) continue;
    if (!round.tickets.length) {
      lotteryManager.closeRound(guild.id, round.last, round.carry, now);
      continue;
    }
    const result = drawLottery(guild.id, now);
    const nextAt = lotteryManager.getRound(guild.id).drawAt;
    console.log(`[Lottery] ${guild.name}: 제${result.round}회 추첨 ${result.number}번 · 당첨 ${result.winners.length}명 · 이월 ${result.carry}P`);

    const channelId = settingsManager.resolveId(settingsManager.getGuildSettings(guild.id), 'gameChannelId');
    const channel = channelId ? guild.channels.cache.get(channelId) : null;
    if (!channel?.isTextBased()) continue;
    await channel
      .send({ embeds: [buildDrawEmbed(result, nextAt)], allowedMentions: { users: result.winners.map(w => w.userId) } })
      .catch(error => console.warn(`[Lottery] ${guild.name}: 추첨 결과 발표 실패:`, error.message));
  }
}
