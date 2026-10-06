import { Events } from 'discord.js';
import { handleReactionRole } from '../../services/roleManager.js';

/**
 * 패널 메시지에 이모지 반응 추가 → 연결된 역할 부여
 */
export default {
  name: Events.MessageReactionAdd,
  /**
   * @param {import('discord.js').MessageReaction | import('discord.js').PartialMessageReaction} reaction
   * @param {import('discord.js').User | import('discord.js').PartialUser} user
   */
  async execute(reaction, user) {
    try {
      await handleReactionRole(reaction, user, 'add');
    } catch (error) {
      console.error('[ReactionRole] 반응 추가 처리 오류:', error);
    }
  },
};
