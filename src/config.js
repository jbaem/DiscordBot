import dotenv from 'dotenv';

// dotenv 는 이미 있는 환경 변수를 덮어쓰지 않으므로, 호스팅 패널에서 넣은 값이 .env 보다 우선한다.
// 토큰이 어디서 왔는지 진단할 수 있도록 .env 를 읽기 전에 기록해 둔다.
const tokenFromHostEnv = Boolean(process.env.DISCORD_TOKEN);
dotenv.config();

/**
 * 토큰 입력 실수 정리
 * - 앞뒤 공백·줄바꿈, 값을 감싼 따옴표, 값 안에 잘못 붙여 넣은 `DISCORD_TOKEN=` 제거
 * (`Bot ` 접두어는 discord.js 가 알아서 제거)
 */
function cleanToken(raw) {
  return (raw || '')
    .trim()
    .replace(/^DISCORD_TOKEN\s*=\s*/i, '')
    .replace(/^(['"])(.*)\1$/, '$2')
    .trim();
}

const rawToken = process.env.DISCORD_TOKEN || '';

export const config = {
  token: cleanToken(rawToken),
  clientId: (process.env.CLIENT_ID || '').trim(),
  guildId: process.env.GUILD_ID || '',
  joinToCreateChannelId: process.env.JOIN_TO_CREATE_CHANNEL_ID || '',
  welcomeChannelId: process.env.WELCOME_CHANNEL_ID || '',
  leaveChannelId: process.env.LEAVE_CHANNEL_ID || '',
  autoRoleId: process.env.AUTO_ROLE_ID || '',
  botStatus: process.env.BOT_STATUS || '/도움말', // 봇 프로필 말풍선(커스텀 상태) 문구
};

/**
 * 토큰 진단 정보 (토큰 값 자체는 포함하지 않음)
 * - source: 'host-env' (호스팅 패널 환경 변수) | 'dotenv' (.env 파일) | 'none'
 * - botId: 토큰 첫 조각에 들어 있는 봇 ID (공개 정보, CLIENT_ID 와 비교용)
 */
export function describeToken() {
  const token = config.token;
  const parts = token.split('.');
  let botId = null;
  try {
    const decoded = Buffer.from(parts[0], 'base64').toString('utf8');
    if (/^\d{15,22}$/.test(decoded)) botId = decoded;
  } catch {
    // 형식이 다르면 봇 ID 를 알 수 없음
  }
  return {
    source: !rawToken ? 'none' : tokenFromHostEnv ? 'host-env' : 'dotenv',
    length: token.length,
    parts: parts.length,
    botId,
    cleaned: rawToken !== token,
    hasInnerWhitespace: /\s/.test(token),
  };
}
