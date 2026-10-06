import { JsonStore } from './jsonStore.js';

const store = new JsonStore('tempVoiceChannels.json', 'TempVoice');

/**
 * 생성된 임시 음성 채널들을 관리하는 저장소
 * - 봇이 재시작되어도 방장/삭제 대상 정보를 잃지 않도록 data/tempVoiceChannels.json 에 저장
 */
class TempVoiceManager {
  constructor() {
    // Map<channelId, { ownerId: string, guildId: string, createdAt: number }>
    this.channels = new Map();
    for (const [channelId, info] of Object.entries(store.load())) {
      if (info && typeof info === 'object' && info.ownerId && info.guildId) {
        this.channels.set(channelId, info);
      }
    }
  }

  saveToFile() {
    store.save(Object.fromEntries(this.channels));
  }

  addChannel(channelId, ownerId, guildId) {
    this.channels.set(channelId, {
      ownerId,
      guildId,
      createdAt: Date.now(),
    });
    this.saveToFile();
  }

  removeChannel(channelId) {
    const removed = this.channels.delete(channelId);
    if (removed) this.saveToFile();
    return removed;
  }

  getChannelInfo(channelId) {
    return this.channels.get(channelId);
  }

  isTempChannel(channelId) {
    return this.channels.has(channelId);
  }

  isOwner(channelId, userId) {
    const info = this.channels.get(channelId);
    return info && info.ownerId === userId;
  }

  /** 저장된 모든 임시 채널 [channelId, info] 목록 (복사본) */
  entries() {
    return Array.from(this.channels);
  }
}

export const tempVoiceManager = new TempVoiceManager();
