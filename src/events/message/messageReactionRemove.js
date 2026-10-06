import { Events } from 'discord.js';
import { handleReactionRole } from '../../services/roleManager.js';

/**
 * 패널 메시지의 이모지 반응 해제 → 연결된 역할 제거
 */
export default {
  name: Events.MessageReactionRemove,
  /**
   * @param {import('discord.js').MessageReaction | import('discord.js').PartialMessageReaction} reaction
   * @param {import('discord.js').User | import('discord.js').PartialUser} user
   */
  async execute(reaction, user) {
    try {
      await handleReactionRole(reaction, user, 'remove');
    } catch (error) {
      console.error('[ReactionRole] 반응 해제 처리 오류:', error);
    }
  },
};
