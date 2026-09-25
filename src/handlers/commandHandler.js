import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function loadCommands(client) {
  const commandsPath = path.join(__dirname, '..', 'commands');
  const commandFolders = fs.readdirSync(commandsPath);

  for (const folder of commandFolders) {
    const folderPath = path.join(commandsPath, folder);
    const stat = fs.statSync(folderPath);

    if (stat.isDirectory()) {
      const commandFiles = fs.readdirSync(folderPath).filter(file => file.endsWith('.js'));
      for (const file of commandFiles) {
        const filePath = path.join(folderPath, file);
        const commandModule = await import(pathToFileURL(filePath).href);
        const command = commandModule.default;

        if (command && 'data' in command && 'execute' in command) {
          client.commands.set(command.data.name, command);
          console.log(`[Loader] 명령어 로드 완료: /${command.data.name} (${folder}/${file})`);
        } else {
          console.warn(`[Loader] 경고: ${filePath} 파일에 필수 'data' 또는 'execute' 속성이 누락되었습니다.`);
        }
      }
    }
  }
}
