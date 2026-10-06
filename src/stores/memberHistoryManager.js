import { JsonStore } from './jsonStore.js';

const store = new JsonStore('memberHistory.json', 'MemberHistory');

/** 유저별로 보관할 최대 닉네임 변경 이력 수 */
export const MAX_NICKNAME_HISTORY = 10;

/** 닉네임 변경 이력 배열에서 형식이 올바른 항목만 정리 (최신순 정렬, 개수 제한) */
function sanitizeNicknameHistory(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter(e => e && typeof e === 'object' && Number.isFinite(e.at) && e.at > 0)
    .map(e => ({
      at: e.at,
      from: typeof e.from === 'string' ? e.from.slice(0, 32) : null,
      to: typeof e.to === 'string' ? e.to.slice(0, 32) : null,
    }))
    .sort((a, b) => b.at - a.at)
    .slice(0, MAX_NICKNAME_HISTORY);
}

/** 두 이력 배열을 합쳐 중복(같은 시각) 제거 후 정리 */
function mergeNicknameHistory(a, b) {
  const seen = new Set();
  const merged = [];
  for (const entry of sanitizeNicknameHistory([...(a || []), ...(b || [])])) {
    if (seen.has(entry.at)) continue;
    seen.add(entry.at);
    merged.push(entry);
  }
  return merged.slice(0, MAX_NICKNAME_HISTORY);
}

/** 두 타임스탬프 중 유효한 값 기준으로 더 이른(작은) 값을 반환 */
function earlierTimestamp(a, b) {
  const list = [a, b].filter(v => Number.isFinite(v) && v > 0);
  return list.length ? Math.min(...list) : null;
}

/** 두 타임스탬프 중 유효한 값 기준으로 더 늦은(큰) 값을 반환 */
function laterTimestamp(a, b) {
  const list = [a, b].filter(v => Number.isFinite(v) && v > 0);
  return list.length ? Math.max(...list) : null;
}

class MemberHistoryManager {
  constructor() {
    this.cache = this.loadFromFile();
  }

  loadFromFile() {
    return store.load();
  }

  saveToFile() {
    store.save(this.cache);
  }

  /**
   * 유저 입장 시 카운트 증가 및 기록
   * @returns {number} 총 입장 횟수
   */
  recordJoin(guildId, userId) {
    if (!this.cache[guildId]) {
      this.cache[guildId] = {};
    }

    if (!this.cache[guildId][userId]) {
      this.cache[guildId][userId] = {
        joinCount: 1,
        firstJoinedAt: Date.now(),
        lastJoinedAt: Date.now(),
        lastLeftAt: null,
      };
    } else {
      this.cache[guildId][userId].joinCount = (this.cache[guildId][userId].joinCount || 1) + 1;
      this.cache[guildId][userId].lastJoinedAt = Date.now();
    }

    this.saveToFile();
    return this.cache[guildId][userId].joinCount;
  }

  /**
   * 유저 퇴장 시 시간 기록
   */
  recordLeave(guildId, userId) {
    if (this.cache[guildId] && this.cache[guildId][userId]) {
      this.cache[guildId][userId].lastLeftAt = Date.now();
      this.saveToFile();
    }
  }

  /**
   * 특정 유저의 입장 횟수 조회
   */
  getJoinCount(guildId, userId) {
    return this.cache[guildId]?.[userId]?.joinCount || 1;
  }

  /**
   * 닉네임 변경 이력 기록 (최신순, 최대 MAX_NICKNAME_HISTORY 개 유지)
   * @param {{ at: number, from: string|null, to: string|null }} change
   */
  recordNicknameChange(guildId, userId, change) {
    if (!this.cache[guildId]) this.cache[guildId] = {};
    if (!this.cache[guildId][userId]) {
      // 입장 기록이 없는(봇 도입 이전) 멤버도 이력은 남김
      this.cache[guildId][userId] = { joinCount: 1, firstJoinedAt: null, lastJoinedAt: null, lastLeftAt: null };
    }
    const record = this.cache[guildId][userId];
    record.nicknameHistory = sanitizeNicknameHistory([change, ...(record.nicknameHistory || [])]);
    this.saveToFile();
    return record.nicknameHistory;
  }

  /**
   * 특정 유저의 닉네임 변경 이력 조회 (최신순)
   */
  getNicknameHistory(guildId, userId) {
    return [...(this.cache[guildId]?.[userId]?.nicknameHistory || [])];
  }

  /**
   * 특정 서버의 전체 멤버 이력 조회 (백업용 복사본 반환)
   */
  getGuildHistory(guildId) {
    return structuredClone(this.cache[guildId] || {});
  }

  /**
   * 백업 파일의 멤버 이력을 서버에 반영
   * @param {string} guildId 대상 서버 ID
   * @param {Record<string, object>} records 백업의 memberHistory 객체 (userId -> 기록)
   * @param {'merge'|'replace'} mode merge: 기존 기록과 병합(입장 횟수는 큰 값 유지), replace: 백업 내용으로 교체
   * @returns {{ imported: number, total: number }} 반영된 레코드 수와 반영 후 총 레코드 수
   */
  importGuildHistory(guildId, records, mode = 'merge') {
    const incoming = records && typeof records === 'object' ? records : {};

    if (mode === 'replace' || !this.cache[guildId]) {
      this.cache[guildId] = {};
    }
    const target = this.cache[guildId];

    let imported = 0;
    for (const [userId, record] of Object.entries(incoming)) {
      if (!/^\d{15,22}$/.test(userId)) continue; // 디스코드 스노우플레이크 형식만 허용
      if (!record || typeof record !== 'object') continue;

      const joinCount = Math.max(1, Math.floor(Number(record.joinCount)) || 1);
      const existing = target[userId];

      if (!existing) {
        target[userId] = {
          joinCount,
          firstJoinedAt: earlierTimestamp(record.firstJoinedAt, null),
          lastJoinedAt: laterTimestamp(record.lastJoinedAt, null),
          lastLeftAt: laterTimestamp(record.lastLeftAt, null),
          nicknameHistory: sanitizeNicknameHistory(record.nicknameHistory),
        };
      } else {
        target[userId] = {
          joinCount: Math.max(existing.joinCount || 1, joinCount),
          firstJoinedAt: earlierTimestamp(existing.firstJoinedAt, record.firstJoinedAt),
          lastJoinedAt: laterTimestamp(existing.lastJoinedAt, record.lastJoinedAt),
          lastLeftAt: laterTimestamp(existing.lastLeftAt, record.lastLeftAt),
          nicknameHistory: mergeNicknameHistory(existing.nicknameHistory, record.nicknameHistory),
        };
      }
      imported++;
    }

    this.saveToFile();
    return { imported, total: Object.keys(target).length };
  }
}

export const memberHistoryManager = new MemberHistoryManager();
