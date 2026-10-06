import { Events } from 'discord.js';
import { activityManager } from '../../stores/activityManager.js';

/**
 * 음성 채널 체류 시간 추적 (voiceStateUpdate.js 의 임시 음성 채널 로직과 분리)
 * - 채널 입장 시 세션 시작, 퇴장/이동 시 정산
 * - 서버 AFK 채널에 머문 시간은 집계하지 않음
 */
export default {
  name: Events.VoiceStateUpdate,
  /**
   * @param {import('discord.js').VoiceState} oldState
   * @param {import('discord.js').VoiceState} newState
   */
  async execute(oldState, newState) {
    const member = newState.member || oldState.member;
    if (!member || member.user?.bot) return;

    const guild = newState.guild || oldState.guild;
    const oldChannelId = oldState.channelId;
    const newChannelId = newState.channelId;

    // 같은 채널 안에서의 상태 변화(뮤트, 화면 공유 등)는 무시
    if (oldChannelId === newChannelId) return;

    const now = Date.now();
    const afkChannelId = guild.afkChannelId;

    try {
      // 기존 채널에서 나감 (또는 다른 채널로 이동) → 세션 정산
      if (oldChannelId && activityManager.hasVoiceSession(guild.id, member.id)) {
        activityManager.endVoiceSession(guild.id, member.id, now);
      }

      // 새 채널에 들어감 (AFK 채널 제외) → 세션 시작
      if (newChannelId && newChannelId !== afkChannelId) {
        activityManager.startVoiceSession(guild.id, member.id, now);
      }
    } catch (error) {
      console.error('[Activity] 음성 활동 기록 오류:', error);
    }
  },
};
