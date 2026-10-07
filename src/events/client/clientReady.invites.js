import { Events } from 'discord.js';
import { cacheGuildInvites } from '../../services/inviteTracker.js';

/**
 * 봇 시작 시 서버별 초대 링크 사용 횟수 기억 (입장 알림의 초대자 확인용)
 */
export default {
  name: Events.ClientReady,
  once: true,
  /** @param {import('discord.js').Client<true>} client */
  async execute(client) {
    let tracked = 0;
    for (const guild of client.guilds.cache.values()) {
      if (await cacheGuildInvites(guild)) tracked++;
    }
    console.log(`[Invite] 초대 링크 추적: ${tracked}/${client.guilds.cache.size}개 서버`);
  },
};
