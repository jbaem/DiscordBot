import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.join(__dirname, '..', '..', 'data');
const settingsFilePath = path.join(dataDir, 'guildSettings.json');

// data 디렉토리 및 설정 파일 초기화
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

if (!fs.existsSync(settingsFilePath)) {
  fs.writeFileSync(settingsFilePath, JSON.stringify({}, null, 2), 'utf-8');
}

class SettingsManager {
  constructor() {
    this.cache = this.loadFromFile();
  }

  loadFromFile() {
    try {
      const data = fs.readFileSync(settingsFilePath, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      console.error('[Settings] 설정 파일 로드 오류:', error);
      return {};
    }
  }

  saveToFile() {
    try {
      fs.writeFileSync(settingsFilePath, JSON.stringify(this.cache, null, 2), 'utf-8');
    } catch (error) {
      console.error('[Settings] 설정 파일 저장 오류:', error);
    }
  }

  getGuildSettings(guildId) {
    if (!this.cache[guildId]) {
      this.cache[guildId] = {
        joinToCreateChannelId: config.joinToCreateChannelId || null,
        voiceNameTemplate: '🔊 {userName}님의 통화방',
        welcomeChannelId: config.welcomeChannelId || null,
        welcomeMessage: '환영합니다, {user} 님! **{server}**에 오신 것을 환영해요. (현재 멤버 수: {count}명)',
        leaveChannelId: config.leaveChannelId || null,
        leaveMessage: '**{userName}** 님이 서버를 떠났습니다. (남은 멤버 수: {count}명)',
      };
      this.saveToFile();
    }
    return this.cache[guildId];
  }

  updateGuildSettings(guildId, updates) {
    const current = this.getGuildSettings(guildId);
    this.cache[guildId] = { ...current, ...updates };
    this.saveToFile();
    return this.cache[guildId];
  }

  /**
   * 템플릿 메시지의 변수를 실제 값으로 치환
   */
  formatMessage(template, { member, guild }) {
    if (!template) return '';
    return template
      .replace(/{user}/g, `<@${member.id}>`)
      .replace(/{userName}/g, member.user?.username || member.displayName || '알 수 없음')
      .replace(/{server}/g, guild.name)
      .replace(/{count}/g, guild.memberCount?.toString() || '0');
  }
}

export const settingsManager = new SettingsManager();
