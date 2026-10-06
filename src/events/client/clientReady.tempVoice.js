import { Events } from 'discord.js';
import { reconcileTempChannels } from '../../services/tempVoiceChannels.js';

/**
 * 봇 시작 시 저장된 임시 음성 채널 정리
 * (봇이 꺼져 있는 동안 비어 버린 방 삭제, 이미 삭제된 방은 목록에서 제거)
 */
export default {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    try {
      const { kept, deleted, forgotten } = await reconcileTempChannels(client);
      if (kept || deleted || forgotten) {
        console.log(`[TempVoice] 저장된 임시 채널 정리: 유지 ${kept}개 · 빈 방 삭제 ${deleted}개 · 사라진 방 ${forgotten}개`);
      }
    } catch (error) {
      console.error('[TempVoice] 임시 채널 정리 오류:', error);
    }
  },
};
