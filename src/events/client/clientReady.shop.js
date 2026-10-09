import { Events } from 'discord.js';
import { expireRentals, RENTAL_CHECK_INTERVAL_MS } from '../../services/shop.js';

/**
 * 상점 기간제 역할 만료 회수 — 봇 시작 시 한 번, 이후 주기적으로
 * (봇이 꺼져 있는 동안 만료된 역할도 시작하자마자 회수)
 */
export default {
  name: Events.ClientReady,
  once: true,
  /** @param {import('discord.js').Client<true>} client */
  async execute(client) {
    const run = () => expireRentals(client).catch(error => console.error('[Shop] 만료 역할 회수 오류:', error));
    await run();
    setInterval(run, RENTAL_CHECK_INTERVAL_MS).unref();
  },
};
