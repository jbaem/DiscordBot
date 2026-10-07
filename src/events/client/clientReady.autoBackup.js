import { Events } from 'discord.js';
import { startAutoBackup } from '../../services/autoBackup.js';

/**
 * 봇 시작 시 채널 자동 백업 시작
 * (저장된 데이터가 없으면 백업 채널의 가장 최근 백업을 불러온 뒤 주기 백업 예약)
 */
export default {
  name: Events.ClientReady,
  once: true,
  /** @param {import('discord.js').Client<true>} client */
  async execute(client) {
    try {
      await startAutoBackup(client);
    } catch (error) {
      console.error('[AutoBackup] 자동 백업 시작 오류:', error);
    }
  },
};
