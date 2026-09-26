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
          console.log(`[SlashCommands] ✅ 전역(Global) 슬래시 명령어 등록 완료! (새 서버에는 반영까지 몇 분 걸릴 수 있습니다)`);

          // 예전에 GUILD_ID 로 개발 서버에 등록해 둔 서버 단위 명령어가 남아 있으면
          // 전역 명령어와 중복 표시되므로, 참여 중인 모든 서버의 서버 단위 명령어를 비운다.
          let cleared = 0;
          for (const guild of client.guilds.cache.values()) {
            try {
              const existing = await rest.get(Routes.applicationGuildCommands(config.clientId, guild.id));
              if (Array.isArray(existing) && existing.length > 0) {
                await rest.put(Routes.applicationGuildCommands(config.clientId, guild.id), { body: [] });
                cleared++;
                console.log(`[SlashCommands] 🧹 ${guild.name}(${guild.id}) 의 서버 단위 명령어 ${existing.length}개 정리 (전역 명령어와 중복 방지)`);
              }
            } catch (error) {
              console.warn(`[SlashCommands] ⚠️ ${guild.name}(${guild.id}) 서버 단위 명령어 정리 실패:`, error.message);
            }
          }
          if (cleared === 0) {
            console.log('[SlashCommands] 서버 단위 명령어 잔재 없음');
          }
        }
      } catch (error) {
        console.error('[SlashCommands] ❌ 슬래시 명령어 등록 중 오류 발생:', error);
      }
    } else {
      console.warn('[SlashCommands] ⚠️ TOKEN 또는 CLIENT_ID가 설정되지 않아 슬래시 명령어를 등록하지 못했습니다.');
    }
  },
};
