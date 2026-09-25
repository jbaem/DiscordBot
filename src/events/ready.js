import { REST, Routes, ActivityType, Events } from 'discord.js';
import { config } from '../config.js';

export default {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    console.log(`========================================`);
    console.log(`🤖 봇 로그인 성공: ${client.user.tag}`);
    console.log(`🌐 참여 중인 서버 수: ${client.guilds.cache.size}개`);
    console.log(`========================================`);

    // 봇 상태 메시지 설정
    client.user.setActivity('서버 및 채널 방 관리 | /help', {
      type: ActivityType.Custom,
    });

    // 슬래시 명령어 자동 등록
    if (config.token && config.clientId) {
      try {
        const rest = new REST().setToken(config.token);
        const commandsData = Array.from(client.commands.values()).map(cmd => cmd.data.toJSON());

        console.log(`[SlashCommands] ${commandsData.length}개의 슬래시 명령어 등록을 시작합니다...`);

        if (config.guildId) {
          // 특정 길드(개발용: 즉시 반영)
          await rest.put(
            Routes.applicationGuildCommands(config.clientId, config.guildId),
            { body: commandsData }
          );
          console.log(`[SlashCommands] ✅ 개발 서버(${config.guildId})에 슬래시 명령어 등록 완료!`);
        } else {
          // 전역(Global: 모든 서버에 적용)
          await rest.put(
            Routes.applicationCommands(config.clientId),
            { body: commandsData }
          );
          console.log(`[SlashCommands] ✅ 전역(Global) 슬래시 명령어 등록 완료!`);
        }
      } catch (error) {
        console.error('[SlashCommands] ❌ 슬래시 명령어 등록 중 오류 발생:', error);
      }
    } else {
      console.warn('[SlashCommands] ⚠️ TOKEN 또는 CLIENT_ID가 설정되지 않아 슬래시 명령어를 등록하지 못했습니다.');
    }
  },
};
