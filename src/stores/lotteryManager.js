import { JsonStore } from './jsonStore.js';

const store = new JsonStore('lottery.json', 'Lottery');

// ─────────────────────────────────────────────────────────────
// 복권 규칙 (필요 시 이 값만 조정)
// ─────────────────────────────────────────────────────────────
export const LOTTERY_RULES = Object.freeze({
  /** 티켓 1장 가격 */
  TICKET_PRICE: 1000,
  /** 번호 범위 1 ~ NUMBERS */
  NUMBERS: 30,
  /** 한 회차에 1인이 살 수 있는 최대 장수 */
  MAX_TICKETS_PER_USER: 100,
  /** 판매액 중 당첨금으로 쌓이는 비율 (나머지는 사라짐 — 포인트가 너무 불어나지 않게) */
  POT_RATE: 0.8,
  /** 추첨 요일(0 = 일요일)과 시각 (한국 시간) */
  DRAW_WEEKDAY: 0,
  DRAW_HOUR: 22,
});

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 다음 추첨 시각 (from 이후 가장 가까운 추첨 요일·시각, 한국 시간 기준) */
export function nextDrawAt(from = Date.now()) {
  const kst = new Date(from + KST_OFFSET_MS); // UTC 필드를 한국 시간으로 읽기 위한 이동
  const days = (LOTTERY_RULES.DRAW_WEEKDAY - kst.getUTCDay() + 7) % 7;
  let draw = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() + days, LOTTERY_RULES.DRAW_HOUR) - KST_OFFSET_MS;
  if (draw <= from) draw += 7 * DAY_MS;
  return draw;
}

const isUserId = v => typeof v === 'string' && /^\d{15,22}$/.test(v);
const isNumber = n => Number.isInteger(n) && n >= 1 && n <= LOTTERY_RULES.NUMBERS;
const nonNegInt = v => (Number.isInteger(v) && v > 0 ? v : 0);

/**
 * 복권 저장소 (서버별 현재 회차와 지난 회차 결과)
 * { round, drawAt, carry(이월 당첨금), sold(이번 회차 판매액), tickets: [{ userId, number }], last: 지난 결과 }
 */
class LotteryManager {
  constructor() {
    this.cache = store.load();
  }

  saveToFile() {
    store.save(this.cache);
  }

  /** 서버의 현재 회차 (없으면 1회차를 만듦) */
  getRound(guildId, now = Date.now()) {
    if (!this.cache[guildId]) {
      this.cache[guildId] = { round: 1, drawAt: nextDrawAt(now), carry: 0, sold: 0, tickets: [], last: null };
      this.saveToFile();
    }
    return this.cache[guildId];
  }

  /** 현재 당첨금 (이월 + 이번 회차 판매액의 POT_RATE) */
  pot(guildId) {
    const r = this.getRound(guildId);
    return r.carry + Math.floor(r.sold * LOTTERY_RULES.POT_RATE);
  }

  /** 이번 회차에 이 유저가 산 번호 목록 */
  ticketsOf(guildId, userId) {
    return this.getRound(guildId).tickets.filter(t => t.userId === userId).map(t => t.number);
  }

  /** 티켓 추가 (포인트 차감은 호출하는 쪽에서) */
  addTickets(guildId, userId, numbers) {
    const r = this.getRound(guildId);
    for (const number of numbers) r.tickets.push({ userId, number });
    r.sold += numbers.length * LOTTERY_RULES.TICKET_PRICE;
    this.saveToFile();
  }

  /**
   * 회차 마감 기록 후 다음 회차 시작
   * @param {object} result 지난 회차 결과 (round, number, pot, winners, drawnAt …)
   * @param {number} carry 다음 회차로 넘길 당첨금
   */
  closeRound(guildId, result, carry, now = Date.now()) {
    const r = this.getRound(guildId);
    this.cache[guildId] = { round: r.round + 1, drawAt: nextDrawAt(now), carry, sold: 0, tickets: [], last: result };
    this.saveToFile();
  }

  /** 백업용 복사본 (회차가 없으면 null) */
  getGuildLottery(guildId) {
    return this.cache[guildId] ? structuredClone(this.cache[guildId]) : null;
  }

  /** 백업의 복권 상태로 교체 (형식이 올바른 값만) */
  importGuildLottery(guildId, data) {
    if (!data || typeof data !== 'object') return false;
    this.cache[guildId] = {
      round: Math.max(1, nonNegInt(data.round)),
      drawAt: Number.isFinite(data.drawAt) && data.drawAt > 0 ? data.drawAt : nextDrawAt(),
      carry: nonNegInt(data.carry),
      sold: nonNegInt(data.sold),
      tickets: (Array.isArray(data.tickets) ? data.tickets : []).filter(t => t && isUserId(t.userId) && isNumber(t.number)),
      last: data.last && typeof data.last === 'object' ? data.last : null,
    };
    this.saveToFile();
    return true;
  }
}

export const lotteryManager = new LotteryManager();
