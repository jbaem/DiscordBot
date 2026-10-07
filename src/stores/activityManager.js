import { JsonStore } from './jsonStore.js';

const store = new JsonStore('activity.json', 'Activity');

// ─────────────────────────────────────────────────────────────
// 활동 집계 규칙 (필요 시 이 값만 조정)
// ─────────────────────────────────────────────────────────────
/** 활동일 계산 기준 시간대 */
export const ACTIVITY_TIMEZONE = 'Asia/Seoul';
/** 파일 저장 디바운스 (ms) — 메시지마다 파일을 쓰지 않고 잠시 모아서 저장 */
const SAVE_DEBOUNCE_MS = 5 * 1000;

const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: ACTIVITY_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** 타임스탬프를 'YYYY-MM-DD' (ACTIVITY_TIMEZONE 기준) 문자열로 변환 */
export function toDayKey(timestamp = Date.now()) {
  return dayFormatter.format(new Date(timestamp));
}

function createEmptyRecord() {
  return {
    messages: 0,
    voiceSeconds: 0,
    activeDays: 0,
    lastActiveDay: null,
    firstActiveAt: null,
    lastActiveAt: null,
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
 * 유저 활동(메시지 수, 음성 시간, 활동일, 마지막 활동) 추적 및 영속화 관리자
 */
class ActivityManager {
  constructor() {
    this.cache = this.loadFromFile();
    /** 진행 중인 음성 세션: `${guildId}:${userId}` -> 시작 타임스탬프 */
    this.voiceSessions = new Map();
    this.saveTimer = null;
    this.dirty = false;

    // 프로세스 종료 시 진행 중인 음성 세션을 정산하고 즉시 저장
    // (SIGINT/SIGTERM 은 index.js 에서 종료 시 백업 후 process.exit 으로 종료 → 이 'exit' 처리가 실행됨)
    process.on('exit', () => {
      this.finalizeAllVoiceSessions();
      if (this.dirty) this.saveToFile();
    });
  }

  loadFromFile() {
    const data = store.load();
    // 포인트(레벨) 기능 제거 이전 기록에 남아 있는 points 값 정리 (다음 저장 때 파일에도 반영)
    for (const records of Object.values(data)) {
      for (const record of Object.values(records || {})) {
        if (record && typeof record === 'object') delete record.points;
      }
    }
    return data;
  }

  saveToFile() {
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
    // 타이머가 프로세스 종료를 막지 않도록 함
    if (typeof this.saveTimer.unref === 'function') this.saveTimer.unref();
  }

  /** 유저 레코드를 반환 (없으면 생성) */
  getOrCreateRecord(guildId, userId) {
    if (!this.cache[guildId]) this.cache[guildId] = {};
    if (!this.cache[guildId][userId]) this.cache[guildId][userId] = createEmptyRecord();
    return this.cache[guildId][userId];
  }

  /**
   * 유저 활동 조회 (없으면 빈 레코드 복사본 반환, 캐시에 생성하지 않음)
   */
  getUserActivity(guildId, userId) {
    const record = this.cache[guildId]?.[userId];
    return record ? { ...record } : createEmptyRecord();
  }

  /** 특정 서버의 전체 활동 기록 조회 (백업용 복사본) */
  getGuildActivity(guildId) {
    return structuredClone(this.cache[guildId] || {});
  }

  /**
   * 활동 발생 시각을 반영 (활동일 / 최초·마지막 활동 갱신)
   */
  touchActivity(record, timestamp = Date.now()) {
    const dayKey = toDayKey(timestamp);
    if (record.lastActiveDay !== dayKey) {
      record.activeDays = (record.activeDays || 0) + 1;
      record.lastActiveDay = dayKey;
    }
    if (!record.firstActiveAt) record.firstActiveAt = timestamp;
    record.lastActiveAt = timestamp;
  }

  /**
   * 메시지 작성 기록 (메시지 수, 활동일, 마지막 활동 갱신)
   */
  recordMessage(guildId, userId, timestamp = Date.now()) {
    const record = this.getOrCreateRecord(guildId, userId);
    record.messages = (record.messages || 0) + 1;
    this.touchActivity(record, timestamp);
    this.scheduleSave();
  }

  /** 음성 채널 접속 시작 (이미 세션이 있으면 무시) */
  startVoiceSession(guildId, userId, timestamp = Date.now()) {
    const key = `${guildId}:${userId}`;
    if (!this.voiceSessions.has(key)) {
      this.voiceSessions.set(key, timestamp);
    }
  }

  /**
   * 음성 채널 접속 종료 — 머문 시간을 정산해 기록
   * @returns {{ seconds: number }}
   */
  endVoiceSession(guildId, userId, timestamp = Date.now()) {
    const key = `${guildId}:${userId}`;
    const startedAt = this.voiceSessions.get(key);
    if (!startedAt) return { seconds: 0 };
    this.voiceSessions.delete(key);

    const seconds = Math.max(0, Math.floor((timestamp - startedAt) / 1000));
    if (seconds === 0) return { seconds: 0 };

    const record = this.getOrCreateRecord(guildId, userId);
    record.voiceSeconds = (record.voiceSeconds || 0) + seconds;
    this.touchActivity(record, timestamp);

    this.scheduleSave();
    return { seconds };
  }

  /** 진행 중인 세션이 있는지 확인 */
  hasVoiceSession(guildId, userId) {
    return this.voiceSessions.has(`${guildId}:${userId}`);
  }

  /** 모든 진행 중 음성 세션 정산 (종료 시 사용) */
  finalizeAllVoiceSessions(timestamp = Date.now()) {
    for (const key of Array.from(this.voiceSessions.keys())) {
      const [guildId, userId] = key.split(':');
      this.endVoiceSession(guildId, userId, timestamp);
    }
  }

  /**
   * 봇 시작 시 이미 음성 채널에 있는 멤버들의 세션을 시작
   * @param {import('discord.js').Client} client
   * @returns {number} 시작된 세션 수
   */
  bootstrapVoiceSessions(client) {
    let started = 0;
    for (const guild of client.guilds.cache.values()) {
      for (const voiceState of guild.voiceStates.cache.values()) {
        if (!voiceState.channelId) continue;
        if (voiceState.channelId === guild.afkChannelId) continue;
        if (voiceState.member?.user?.bot) continue;
        this.startVoiceSession(guild.id, voiceState.id);
        started++;
      }
    }
    return started;
  }

  /**
   * 백업 파일의 활동 기록을 서버에 반영
   * @param {'merge'|'replace'} mode merge: 항목별 큰 값 유지, replace: 백업 내용으로 교체
   * @returns {{ imported: number, total: number }}
   */
  importGuildActivity(guildId, records, mode = 'merge') {
    const incoming = records && typeof records === 'object' ? records : {};

    if (mode === 'replace' || !this.cache[guildId]) {
      this.cache[guildId] = {};
    }
    const target = this.cache[guildId];

    let imported = 0;
    for (const [userId, record] of Object.entries(incoming)) {
      if (!/^\d{15,22}$/.test(userId)) continue;
      if (!record || typeof record !== 'object') continue;

      // 예전 백업의 points 값은 가져오지 않음 (포인트 기능 제거)
      const clean = {
        messages: toNonNegativeInt(record.messages),
        voiceSeconds: toNonNegativeInt(record.voiceSeconds),
        activeDays: toNonNegativeInt(record.activeDays),
        lastActiveDay: typeof record.lastActiveDay === 'string' ? record.lastActiveDay : null,
        firstActiveAt: toTimestampOrNull(record.firstActiveAt),
        lastActiveAt: toTimestampOrNull(record.lastActiveAt),
      };

      const existing = target[userId];
      if (!existing) {
        target[userId] = clean;
      } else {
        const laterIsIncoming = (clean.lastActiveAt || 0) >= (existing.lastActiveAt || 0);
        target[userId] = {
          messages: Math.max(existing.messages || 0, clean.messages),
          voiceSeconds: Math.max(existing.voiceSeconds || 0, clean.voiceSeconds),
          activeDays: Math.max(existing.activeDays || 0, clean.activeDays),
          lastActiveDay: laterIsIncoming ? clean.lastActiveDay || existing.lastActiveDay : existing.lastActiveDay || clean.lastActiveDay,
          firstActiveAt: [existing.firstActiveAt, clean.firstActiveAt].filter(Boolean).length
            ? Math.min(...[existing.firstActiveAt, clean.firstActiveAt].filter(Boolean))
            : null,
          lastActiveAt: Math.max(existing.lastActiveAt || 0, clean.lastActiveAt || 0) || null,
        };
      }
      imported++;
    }

    this.saveToFile();
    return { imported, total: Object.keys(target).length };
  }
}

export const activityManager = new ActivityManager();
