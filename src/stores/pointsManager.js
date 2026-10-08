import { JsonStore } from './jsonStore.js';
import { toDayKey } from './activityManager.js';

const store = new JsonStore('points.json', 'Points');

// ─────────────────────────────────────────────────────────────
// 게임 포인트 규칙 (필요 시 이 값만 조정)
// ─────────────────────────────────────────────────────────────
export const POINT_RULES = Object.freeze({
  /** /게임 등록 시 한 번 지급 */
  START_POINTS: 1000,
  /** 메시지 활동 적립 (쿨다운마다 1번) */
  MESSAGE_POINTS: 5,
  MESSAGE_COOLDOWN_MS: 60 * 1000,
  /** 음성 채널 1분당 적립 */
  VOICE_POINTS_PER_MINUTE: 1,
  /** 활동으로 하루(한국 시간)에 받을 수 있는 최대 포인트 */
  DAILY_ACTIVITY_CAP: 300,
});

/** 파일 저장 디바운스 (ms) — 메시지 적립마다 파일을 쓰지 않고 잠시 모아서 저장 */
const SAVE_DEBOUNCE_MS = 5 * 1000;

function createRecord() {
  return {
    balance: 0,
    registeredAt: null, // /게임 등록 시각 (null 이면 미등록 — 관리자 지급만 받은 상태)
    updatedAt: null,
    wins: 0,
    losses: 0,
    draws: 0,
    lastMessagePointAt: null,
    activityDay: null, // 활동 적립 일일 한도 계산용 (YYYY-MM-DD)
    activityToday: 0,
  };
}

function toNonNegativeInt(value) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function toTimestampOrNull(value) {
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * 게임 포인트 저장소 (서버별 · 유저별 잔액, 전적, 활동 적립 기록)
 */
class PointsManager {
  constructor() {
    this.cache = store.load();
    this.saveTimer = null;
    this.dirty = false;
    process.on('exit', () => {
      if (this.dirty) this.saveToFile();
    });
  }

  saveToFile() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (store.save(this.cache)) this.dirty = false;
  }

  /** 잠시 후 한 번만 저장되도록 예약 (디바운스) */
  scheduleSave() {
    this.dirty = true;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveToFile();
    }, SAVE_DEBOUNCE_MS);
    if (typeof this.saveTimer.unref === 'function') this.saveTimer.unref();
  }

  getOrCreate(guildId, userId) {
    if (!this.cache[guildId]) this.cache[guildId] = {};
    if (!this.cache[guildId][userId]) this.cache[guildId][userId] = createRecord();
    return this.cache[guildId][userId];
  }

  /** 유저 포인트 기록 (없으면 빈 기록 복사본, 캐시에 만들지 않음) */
  get(guildId, userId) {
    const record = this.cache[guildId]?.[userId];
    return record ? { ...record } : createRecord();
  }

  isRegistered(guildId, userId) {
    return Boolean(this.cache[guildId]?.[userId]?.registeredAt);
  }

  /**
   * 게임 등록 — 처음 한 번만 시작 포인트 지급
   * @returns {{ registered: boolean, balance: number }} registered: 이번에 새로 등록했는지
   */
  register(guildId, userId, timestamp = Date.now()) {
    const record = this.getOrCreate(guildId, userId);
    if (record.registeredAt) return { registered: false, balance: record.balance };
    record.registeredAt = timestamp;
    record.balance += POINT_RULES.START_POINTS;
    record.updatedAt = timestamp;
    this.saveToFile();
    return { registered: true, balance: record.balance };
  }

  /**
   * 활동 적립 (등록한 멤버만, 하루 한도 안에서)
   * @returns {number} 실제 적립한 포인트
   */
  addActivityPoints(guildId, userId, amount, timestamp = Date.now()) {
    if (amount <= 0 || !this.isRegistered(guildId, userId)) return 0;
    const record = this.cache[guildId][userId];
    const day = toDayKey(timestamp);
    if (record.activityDay !== day) {
      record.activityDay = day;
      record.activityToday = 0;
    }
    const given = Math.min(amount, POINT_RULES.DAILY_ACTIVITY_CAP - record.activityToday);
    if (given <= 0) return 0;
    record.activityToday += given;
    record.balance += given;
    record.updatedAt = timestamp;
    this.scheduleSave();
    return given;
  }

  /** 메시지 활동 적립 (쿨다운 안의 메시지는 적립하지 않음) */
  awardMessage(guildId, userId, timestamp = Date.now()) {
    if (!this.isRegistered(guildId, userId)) return 0;
    const record = this.cache[guildId][userId];
    if (record.lastMessagePointAt && timestamp - record.lastMessagePointAt < POINT_RULES.MESSAGE_COOLDOWN_MS) return 0;
    const given = this.addActivityPoints(guildId, userId, POINT_RULES.MESSAGE_POINTS, timestamp);
    if (given > 0) record.lastMessagePointAt = timestamp;
    return given;
  }

  /** 음성 채널 활동 적립 (머문 시간 1분당) */
  awardVoice(guildId, userId, seconds, timestamp = Date.now()) {
    const minutes = Math.floor((seconds || 0) / 60);
    return this.addActivityPoints(guildId, userId, minutes * POINT_RULES.VOICE_POINTS_PER_MINUTE, timestamp);
  }

  /**
   * 관리자 지급(+) / 회수(-) — 등록하지 않은 멤버도 가능, 잔액은 0 아래로 내려가지 않음
   * @returns {{ before: number, after: number, applied: number }}
   */
  adjust(guildId, userId, delta, timestamp = Date.now()) {
    const record = this.getOrCreate(guildId, userId);
    const before = record.balance;
    record.balance = Math.max(0, before + Math.trunc(delta));
    record.updatedAt = timestamp;
    this.saveToFile();
    return { before, after: record.balance, applied: record.balance - before };
  }

  /**
   * 게임 결과 반영
   * @param {Array<{ userId: string, delta: number, outcome: 'win'|'lose'|'draw' }>} entries
   *   delta 는 잔액 변화 (잃는 쪽은 잔액보다 많이 잃지 않음)
   * @returns {Array<{ userId: string, applied: number, balance: number }>}
   */
  applyGameResult(guildId, entries, timestamp = Date.now()) {
    const results = entries.map(({ userId, delta, outcome }) => {
      const record = this.getOrCreate(guildId, userId);
      const before = record.balance;
      record.balance = Math.max(0, before + Math.trunc(delta));
      if (outcome === 'win') record.wins += 1;
      else if (outcome === 'lose') record.losses += 1;
      else record.draws += 1;
      record.updatedAt = timestamp;
      return { userId, applied: record.balance - before, balance: record.balance };
    });
    this.saveToFile();
    return results;
  }

  /** 등록한 멤버 순위 (잔액 높은 순) */
  ranking(guildId) {
    return Object.entries(this.cache[guildId] || {})
      .filter(([, record]) => record.registeredAt)
      .map(([userId, record]) => ({ userId, ...record }))
      .sort((a, b) => b.balance - a.balance || (a.registeredAt || 0) - (b.registeredAt || 0));
  }

  /** 특정 서버의 전체 포인트 기록 (백업용 복사본) */
  getGuildPoints(guildId) {
    return structuredClone(this.cache[guildId] || {});
  }

  /**
   * 백업 파일의 포인트 기록을 서버에 반영
   * @param {'merge'|'replace'} mode merge: 유저별로 더 최근에 바뀐 기록 유지, replace: 백업 내용으로 교체
   * @returns {{ imported: number, total: number }}
   */
  importGuildPoints(guildId, records, mode = 'merge') {
    const incoming = records && typeof records === 'object' ? records : {};
    if (mode === 'replace' || !this.cache[guildId]) this.cache[guildId] = {};
    const target = this.cache[guildId];

    let imported = 0;
    for (const [userId, record] of Object.entries(incoming)) {
      if (!/^\d{15,22}$/.test(userId)) continue;
      if (!record || typeof record !== 'object') continue;
      const clean = {
        balance: toNonNegativeInt(record.balance),
        registeredAt: toTimestampOrNull(record.registeredAt),
        updatedAt: toTimestampOrNull(record.updatedAt),
        wins: toNonNegativeInt(record.wins),
        losses: toNonNegativeInt(record.losses),
        draws: toNonNegativeInt(record.draws),
        lastMessagePointAt: toTimestampOrNull(record.lastMessagePointAt),
        activityDay: typeof record.activityDay === 'string' ? record.activityDay : null,
        activityToday: toNonNegativeInt(record.activityToday),
      };
      // 잔액은 게임으로 줄어들 수도 있어 "큰 값"이 아니라 더 최근에 바뀐 기록을 유지
      const existing = target[userId];
      if (!existing || (clean.updatedAt || 0) >= (existing.updatedAt || 0)) target[userId] = clean;
      imported++;
    }

    this.saveToFile();
    return { imported, total: Object.keys(target).length };
  }
}

export const pointsManager = new PointsManager();
