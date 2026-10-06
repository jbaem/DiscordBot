import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** 런타임 JSON 데이터 디렉토리 (프로젝트 루트의 data/) */
export const DATA_DIR = path.join(__dirname, '..', '..', 'data');
/** 백업 파일 디렉토리 (프로젝트 루트의 backups/) */
export const BACKUP_DIR = path.join(__dirname, '..', '..', 'backups');

/**
 * data/ 폴더의 JSON 파일 하나를 읽고 쓰는 저장소
 * - 저장: 임시 파일에 먼저 쓴 뒤 rename 으로 교체 → 저장 도중 종료되어도 원본이 깨지지 않음
 * - 로드 실패(JSON 손상): 손상된 파일을 `.corrupt-<시각>` 으로 보관한 뒤 빈 데이터로 시작
 *   (빈 데이터로 원본을 덮어써 기존 기록을 잃는 일을 방지)
 */
export class JsonStore {
  /**
   * @param {string} fileName 폴더 안의 파일 이름 (예: 'guildSettings.json')
   * @param {string} logTag 로그 접두사 (예: 'Settings')
   * @param {string} [dir] 저장 폴더 (기본: data/)
   */
  constructor(fileName, logTag, dir = DATA_DIR) {
    this.dir = dir;
    this.filePath = path.join(dir, fileName);
    this.logTag = logTag;
  }

  /** 저장 폴더가 없으면 생성 */
  ensureDir() {
    if (!fs.existsSync(this.dir)) {
      fs.mkdirSync(this.dir, { recursive: true });
    }
  }

  /** 파일을 읽어 객체로 반환 (없으면 빈 객체) */
  load() {
    this.ensureDir();
    if (!fs.existsSync(this.filePath)) return {};

    let raw;
    try {
      raw = fs.readFileSync(this.filePath, 'utf-8');
    } catch (error) {
      console.error(`[${this.logTag}] 파일 읽기 오류:`, error);
      return {};
    }

    try {
      const data = JSON.parse(raw);
      if (data && typeof data === 'object' && !Array.isArray(data)) return data;
      throw new Error('최상위 구조가 객체가 아닙니다.');
    } catch (error) {
      const backupPath = `${this.filePath}.corrupt-${Date.now()}`;
      try {
        fs.renameSync(this.filePath, backupPath);
        console.error(
          `[${this.logTag}] ❌ 파일이 손상되어 빈 데이터로 시작합니다. 원본은 ${path.basename(backupPath)} 로 보관했습니다:`,
          error.message
        );
      } catch (renameError) {
        console.error(`[${this.logTag}] ❌ 손상된 파일 보관 실패:`, renameError);
      }
      return {};
    }
  }

  /** 객체를 파일에 원자적으로 저장 */
  save(data) {
    const json = JSON.stringify(data, null, 2);
    const tmpPath = `${this.filePath}.tmp`;
    try {
      this.ensureDir();
      fs.writeFileSync(tmpPath, json, 'utf-8');
      fs.renameSync(tmpPath, this.filePath);
      return true;
    } catch (error) {
      // Windows 에서 다른 프로세스(백신 등)가 파일을 잡고 있으면 rename 이 실패할 수 있어 직접 쓰기로 대체
      try {
        fs.writeFileSync(this.filePath, json, 'utf-8');
        fs.rmSync(tmpPath, { force: true });
        return true;
      } catch (fallbackError) {
        console.error(`[${this.logTag}] 파일 저장 오류:`, fallbackError);
        return false;
      }
    }
  }
}
