import fs from 'node:fs';
import path from 'node:path';
import { JsonStore, BACKUP_DIR } from './jsonStore.js';

/** 서버별로 보관할 최대 로컬 백업 수 (넘으면 오래된 것부터 삭제) */
export const MAX_LOCAL_BACKUPS_PER_GUILD = 20;
/** 파일 이름에 쓰는 시각의 기준 시간대 */
const BACKUP_TIMEZONE = 'Asia/Seoul';

/**
 * 백업 파일 이름 형식: backup-<서버ID>-<YYYYMMDD>-<HHmmss>[-<태그>].json
 * (예전 형식 backup-<서버ID>-<YYYYMMDD>-<HHmm>.json 도 인식)
 */
const FILE_NAME_PATTERN = /^backup-(\d{15,22})-(\d{8})-(\d{4}|\d{6})(?:-([a-z-]+))?\.json$/;

/** 백업 종류 태그 → 표시 이름 */
export const BACKUP_TAG_LABEL = Object.freeze({
  'before-restore': '복원 직전 자동 백업',
});

const stampFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: BACKUP_TIMEZONE,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

/** 백업 파일 이름 생성 (예: backup-123456789012345678-20261006-153012.json) */
export function buildBackupFileName(guildId, date = new Date(), tag = '') {
  const p = Object.fromEntries(stampFormatter.formatToParts(date).map(x => [x.type, x.value]));
  const stamp = `${p.year}${p.month}${p.day}-${p.hour}${p.minute}${p.second}`;
  return `backup-${guildId}-${stamp}${tag ? `-${tag}` : ''}.json`;
}

/**
 * 백업 파일 이름 해석 (형식이 다르면 null)
 * @returns {{ fileName: string, guildId: string, label: string, tag: string|null }|null}
 */
export function parseBackupFileName(fileName) {
  const m = FILE_NAME_PATTERN.exec(fileName);
  if (!m) return null;
  const [, guildId, date, time, tag = null] = m;
  const label =
    `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)} ` +
    `${time.slice(0, 2)}:${time.slice(2, 4)}${time.length === 6 ? `:${time.slice(4, 6)}` : ''}`;
  return { fileName, guildId, label, tag };
}

/**
 * backups/ 폴더의 백업 파일 저장 및 조회
 * (data/ 와 같은 서버 디스크에 있으므로, 서버 자체가 사라지는 경우에 대비해 첨부 파일도 함께 받아 두는 것을 권장)
 */
class BackupStore {
  /**
   * 백업 객체를 backups/ 에 저장하고 오래된 백업을 정리
   * @returns {string|null} 저장된 파일 이름 (실패 시 null)
   */
  save(guildId, backup, tag = '') {
    const fileName = buildBackupFileName(guildId, new Date(), tag);
    const ok = new JsonStore(fileName, 'Backup', BACKUP_DIR).save(backup);
    if (!ok) return null;
    this.prune(guildId);
    return fileName;
  }

  /**
   * 서버의 로컬 백업 목록 (최신순)
   * @returns {Array<{ fileName: string, guildId: string, label: string, tag: string|null, size: number, mtimeMs: number }>}
   */
  list(guildId) {
    if (!fs.existsSync(BACKUP_DIR)) return [];
    return fs
      .readdirSync(BACKUP_DIR)
      .map(parseBackupFileName)
      .filter(info => info && info.guildId === guildId)
      .map(info => {
        const stat = fs.statSync(path.join(BACKUP_DIR, info.fileName));
        return { ...info, size: stat.size, mtimeMs: stat.mtimeMs };
      })
      .sort((a, b) => b.fileName.localeCompare(a.fileName) || b.mtimeMs - a.mtimeMs);
  }

  /** 서버의 가장 최근 로컬 백업 (없으면 null) */
  latest(guildId) {
    return this.list(guildId)[0] ?? null;
  }

  /**
   * 백업 파일 내용 읽기
   * - 파일 이름 형식이 맞는 backups/ 바로 아래 파일만 허용 (경로 조작 방지)
   * @returns {string|null} 파일 내용 (없으면 null)
   */
  read(fileName) {
    if (!parseBackupFileName(fileName)) return null;
    const filePath = path.join(BACKUP_DIR, fileName);
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, 'utf-8');
  }

  /** 서버별 최근 MAX_LOCAL_BACKUPS_PER_GUILD 개만 남기고 삭제 */
  prune(guildId) {
    for (const old of this.list(guildId).slice(MAX_LOCAL_BACKUPS_PER_GUILD)) {
      try {
        fs.rmSync(path.join(BACKUP_DIR, old.fileName), { force: true });
      } catch (error) {
        console.error(`[Backup] 오래된 백업 삭제 실패 (${old.fileName}):`, error.message);
      }
    }
  }
}

export const backupStore = new BackupStore();
