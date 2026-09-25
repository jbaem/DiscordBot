import { Client, Collection, GatewayIntentBits } from 'discord.js';
import { config } from './config.js';
import { loadCommands } from './handlers/commandHandler.js';
import { loadEvents } from './handlers/eventHandler.js';

// 클라이언트 생성 및 필요한 권한(Intents) 설정
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
  ],
});

client.commands = new Collection();

async function startBot() {
  console.log('🚀 디스코드 방 관리 봇을 시작합니다...');

  // 1. 명령어 및 이벤트 핸들러 로드
  await loadCommands(client);
  await loadEvents(client);

  // 2. 토큰 확인 및 봇 로그인
  if (!config.token || config.token === 'your_bot_token_here') {
    console.error('\n❌ [오류] DISCORD_TOKEN 이 설정되지 않았습니다!');
    console.error('👉 프로젝트 루트의 .env 파일에 봇 토큰(DISCORD_TOKEN)을 입력해주세요.');
    console.error('👉 자세한 설정 방법은 README.md 파일을 참고하세요.\n');
    process.exit(1);
  }

  try {
    await client.login(config.token);
  } catch (error) {
    console.error('❌ [오류] 봇 로그인에 실패했습니다:', error);
  }
}

// 예외 처리
process.on('unhandledRejection', error => {
  console.error('[Unhandled Rejection]', error);
});

process.on('uncaughtException', error => {
  console.error('[Uncaught Exception]', error);
});

startBot();
