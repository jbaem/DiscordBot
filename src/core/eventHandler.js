import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * events/ 아래의 .js 파일 목록 (하위 폴더 포함)
 * - 폴더: 이벤트 분류 (client, guildMember, interaction, message, voice)
 * - 파일: 이벤트 이름. 한 이벤트를 여러 기능이 처리하면 `<이벤트>.<기능>.js` (예: voice/voiceStateUpdate.tempVoice.js)
 */
function collectEventFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return collectEventFiles(fullPath);
    return entry.name.endsWith('.js') ? [fullPath] : [];
  });
}

export async function loadEvents(client) {
  const eventsPath = path.join(__dirname, '..', 'events');

  for (const filePath of collectEventFiles(eventsPath)) {
    const file = path.relative(eventsPath, filePath).replace(/\\/g, '/');
    const eventModule = await import(pathToFileURL(filePath).href);
    const event = eventModule.default;

    if (event && event.name) {
      // 개별 이벤트 처리 실패가 다른 핸들러나 봇 전체에 영향을 주지 않도록 감싼다
      const listener = async (...args) => {
        try {
          await event.execute(...args);
        } catch (error) {
          console.error(`[Event] ${event.name} 처리 중 오류 (${file}):`, error);
        }
      };

      if (event.once) {
        client.once(event.name, listener);
      } else {
        client.on(event.name, listener);
      }
      console.log(`[Loader] 이벤트 로드 완료: ${event.name} (${file})`);
    } else {
      console.warn(`[Loader] 경고: ${file} 파일에 필수 'name' 속성이 누락되었습니다.`);
    }
  }
}
