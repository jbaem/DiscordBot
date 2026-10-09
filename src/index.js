import { Client, Collection, GatewayIntentBits, Partials } from 'discord.js';
import { config, describeToken } from './config.js';
import { loadCommands } from './core/commandHandler.js';
import { loadEvents } from './core/eventHandler.js';
import { activityManager } from './stores/activityManager.js';
import { pointsManager } from './stores/pointsManager.js';
// 로그인 전에 불러와야 디스크에 원래 있던 데이터를 기준으로 시작 시 복원 여부를 판단할 수 있음
import { stopAutoBackup } from './services/autoBackup.js';

// 클라이언트 생성 및 필요한 권한(Intents) 설정
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions, // 이모지 반응 역할
  ],
  // 봇 재시작 이전에 게시된 패널 메시지(캐시에 없는 메시지)의 반응도 수신하기 위한 Partials
  partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User, Partials.GuildMember],
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

  // 토큰 진단 (토큰 값은 출력하지 않음) — 로그인 실패 시 어떤 값이 들어왔는지 구분하기 위함
  const info = describeToken();
  const SOURCE_LABEL = { 'host-env': '호스팅 패널 환경 변수', dotenv: '.env 파일', none: '없음' };
  const idCheck = info.botId
    ? `${info.botId}${config.clientId ? (info.botId === config.clientId ? ' (CLIENT_ID 와 일치)' : ' (⚠️ CLIENT_ID 와 다름)') : ''}`
    : '알 수 없음 (봇 토큰 형식 아님)';
  const tokenSummary =
    `[Token] 출처: ${SOURCE_LABEL[info.source]} · 길이 ${info.length} · 조각 ${info.parts}개 · 토큰 속 봇 ID: ${idCheck}` +
    ` · 가운데 조각: ${info.issued ?? '-'} · 지문: ${info.fingerprint ?? '-'}` +
    (info.cleaned ? ' · 앞뒤 공백/따옴표/"DISCORD_TOKEN=" 을 정리함' : '') +
    (info.hasInnerWhitespace ? ' · ⚠️ 토큰 중간에 공백/줄바꿈 있음' : '');
  console.log(tokenSummary);

  try {
    await client.login(config.token);
  } catch (error) {
    console.error('❌ [오류] 봇 로그인에 실패했습니다:', error);
    if (error.code === 'TokenInvalid') {
      // 진단 줄을 오류 바로 아래에도 다시 출력 (콘솔에서 위쪽 줄을 찾지 않아도 되게)
      console.error(tokenSummary);
      console.error('👉 디스코드가 토큰을 거부했습니다. 위 [Token] 줄을 확인하세요.');
      console.error('   - 조각이 3개가 아니거나 봇 ID 를 알 수 없음: 봇 토큰이 아닌 값(Client Secret 등)이 들어감');
      console.error('   - 봇 ID 가 CLIENT_ID 와 다름: 다른 봇의 토큰');
      console.error('   - 형식은 맞음: 토큰이 재발급(Reset Token)되어 무효 → 새 토큰으로 교체');
      console.error('   - 출처가 "호스팅 패널 환경 변수": .env 가 아니라 패널에 입력한 값이 사용 중');
    }
    // 실행 중으로 남아 있지 않도록 종료 (호스팅 패널에서 중지 상태로 보이게)
    // 연결을 먼저 정리한 뒤 자연 종료, 남은 작업이 있으면 1초 뒤 강제 종료
    await client.destroy().catch(() => {});
    process.exitCode = 1;
    setTimeout(() => process.exit(1), 1000).unref();
  }
}

/** 종료 신호를 받은 뒤 백업을 기다리는 최대 시간 (넘으면 강제 종료) */
const SHUTDOWN_TIMEOUT_MS = 10_000;
let shuttingDown = false;

/** 종료 신호(SIGINT/SIGTERM): 채널에 마지막 백업을 올린 뒤 종료 */
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`🛑 ${signal} 수신: 종료 전 자동 백업 후 종료합니다...`);
  setTimeout(() => {
    console.warn(`[Shutdown] ${SHUTDOWN_TIMEOUT_MS / 1000}초 안에 끝나지 않아 강제 종료합니다.`);
    process.exit(0);
  }, SHUTDOWN_TIMEOUT_MS).unref();

  try {
    // 진행 중인 음성 시간을 정산(게임 포인트 적립 포함)해 마지막 백업에 포함
    for (const { guildId, userId, seconds } of activityManager.finalizeAllVoiceSessions()) {
      pointsManager.awardVoice(guildId, userId, seconds);
    }
    await stopAutoBackup();
  } catch (error) {
    console.error('[Shutdown] 종료 시 백업 오류:', error);
  }
  await client.destroy().catch(() => {});
  process.exit(0);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => shutdown(signal));
}

// 예외 처리
process.on('unhandledRejection', error => {
  console.error('[Unhandled Rejection]', error);
});

process.on('uncaughtException', error => {
  console.error('[Uncaught Exception]', error);
});

startBot();
