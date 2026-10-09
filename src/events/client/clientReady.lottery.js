import { Events } from 'discord.js';
import { runDueDraws, LOTTERY_CHECK_INTERVAL_MS } from '../../services/games/lottery.js';

/**
 * 복권 추첨 — 봇 시작 시(꺼져 있던 동안 지난 추첨 포함) 한 번, 이후 1분마다 추첨 시각 확인
 */
export default {
  name: Events.ClientReady,
  once: true,
  /** @param {import('discord.js').Client<true>} client */
  async execute(client) {
    const run = () => runDueDraws(client).catch(error => console.error('[Lottery] 추첨 오류:', error));
    await run();
    setInterval(run, LOTTERY_CHECK_INTERVAL_MS).unref();
  },
};
