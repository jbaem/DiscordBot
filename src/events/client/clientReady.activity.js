import { Events } from 'discord.js';
import { activityManager } from '../../stores/activityManager.js';

/**
 * 봇 시작 시 이미 음성 채널에 접속해 있는 멤버들의 음성 세션을 시작
 * (ready.js 의 로그인/명령어 등록 로직과 분리)
 */
export default {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    try {
      const started = activityManager.bootstrapVoiceSessions(client);
      if (started > 0) {
        console.log(`[Activity] 접속 중인 음성 세션 ${started}개 추적 시작`);
      }
    } catch (error) {
      console.error('[Activity] 음성 세션 초기화 오류:', error);
    }
  },
};
