import { Events } from 'discord.js';
import { handleReactionRole } from '../utils/roleManager.js';

/**
 * 패널 메시지에 이모지 반응 추가 → 연결된 역할 부여
 */
export default {
  name: Events.MessageReactionAdd,
  async execute(reaction, user) {
    try {
      await handleReactionRole(reaction, user, 'add');
    } catch (error) {
      console.error('[ReactionRole] 반응 추가 처리 오류:', error);
    }
  },
};
