/**
 * 생성된 임시 음성 채널들을 관리하는 인메모리 저장소
 */
class TempVoiceManager {
  constructor() {
    // Map<channelId, { ownerId: string, guildId: string, createdAt: Date }>
    this.channels = new Map();
  }

  addChannel(channelId, ownerId, guildId) {
    this.channels.set(channelId, {
      ownerId,
      guildId,
      createdAt: new Date(),
    });
  }

  removeChannel(channelId) {
    return this.channels.delete(channelId);
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
}

export const tempVoiceManager = new TempVoiceManager();
