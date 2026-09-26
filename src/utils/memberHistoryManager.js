import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.join(__dirname, '..', '..', 'data');
const historyFilePath = path.join(dataDir, 'memberHistory.json');

// data 디렉토리 및 파일 초기화
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

if (!fs.existsSync(historyFilePath)) {
  fs.writeFileSync(historyFilePath, JSON.stringify({}, null, 2), 'utf-8');
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
    try {
      const data = fs.readFileSync(historyFilePath, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      console.error('[MemberHistory] 파일 로드 오류:', error);
      return {};
    }
  }

  saveToFile() {
    try {
      fs.writeFileSync(historyFilePath, JSON.stringify(this.cache, null, 2), 'utf-8');
    } catch (error) {
      console.error('[MemberHistory] 파일 저장 오류:', error);
    }
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
        };
      } else {
        target[userId] = {
          joinCount: Math.max(existing.joinCount || 1, joinCount),
          firstJoinedAt: earlierTimestamp(existing.firstJoinedAt, record.firstJoinedAt),
          lastJoinedAt: laterTimestamp(existing.lastJoinedAt, record.lastJoinedAt),
          lastLeftAt: laterTimestamp(existing.lastLeftAt, record.lastLeftAt),
        };
      }
      imported++;
    }

    this.saveToFile();
    return { imported, total: Object.keys(target).length };
  }
}

export const memberHistoryManager = new MemberHistoryManager();
