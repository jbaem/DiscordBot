import { Events } from 'discord.js';
import { activityManager } from '../../stores/activityManager.js';

/**
 * 메시지 작성 활동 기록 (메시지 수, 포인트, 활동일)
 * - MessageContent 인텐트 없이도 동작 (내용은 사용하지 않음)
 */
export default {
  name: Events.MessageCreate,
  async execute(message) {
    if (!message.guild) return; // DM 제외
    if (message.author?.bot || message.webhookId) return; // 봇/웹훅 제외
    if (message.system) return; // 시스템 메시지 제외

    try {
      activityManager.recordMessage(message.guild.id, message.author.id, message.createdTimestamp);
    } catch (error) {
      console.error('[Activity] 메시지 활동 기록 오류:', error);
    }
  },
};
