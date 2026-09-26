import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { memberHistoryManager } from './memberHistoryManager.js';

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
        autoRoleId: config.autoRoleId || null, // 신규 멤버 자동 역할 (null: 비활성화)
        nicknameLogChannelId: null, // 닉네임 변경 로그 채널 (null: 비활성화)
        reactionRoles: [], // 이모지 반응 역할 매핑 [{ roleId, emojiKey, emojiId, emojiName, animated, description }]
        reactionRolePanels: [], // 게시된 패널 메시지 [{ messageId, channelId, title, description }]
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
   * @param {string} template 치환할 템플릿 문자열
   * @param {object} context
   * @param {import('discord.js').GuildMember} context.member 대상 멤버
   * @param {import('discord.js').Guild} context.guild 대상 서버
   * @param {number} [context.joinCount] 입장 횟수 (미지정 시 memberHistoryManager에서 조회)
   */
  formatMessage(template, { member, guild, joinCount }) {
    if (!template) return '';

    const user = member.user || {};
    const joinedTimestamp = member.joinedTimestamp || Date.now();
    const createdTimestamp = user.createdTimestamp || Date.now();
    const now = Date.now();

    // 계정 생성 후 지난 일수 계산
    const accountAgeDays = Math.max(0, Math.floor((now - createdTimestamp) / (1000 * 60 * 60 * 24)));

    // 디스코드 유닉스 타임스탬프 (초 단위)
    const joinedSec = Math.floor(joinedTimestamp / 1000);
    const createdSec = Math.floor(createdTimestamp / 1000);

    // 입장 횟수 (들낙 카운트)
    const joinCountNum = joinCount || memberHistoryManager.getJoinCount(guild.id, member.id);
    const isRejoinText = joinCountNum > 1 ? `재입장 (${joinCountNum}회차)` : '최초 입장';

    return template
      .replace(/{user}/g, `<@${member.id}>`)
      .replace(/{userName}/g, member.displayName || user.username || '알 수 없음')
      .replace(/{userTag}/g, user.tag || user.username || '알 수 없음')
      .replace(/{userId}/g, member.id || '')
      .replace(/{server}/g, guild.name || '')
      .replace(/{count}/g, (guild.memberCount || 0).toLocaleString())
      .replace(/{joinedAt}/g, `<t:${joinedSec}:f>`)
      .replace(/{joinedAtRelative}/g, `<t:${joinedSec}:R>`)
      .replace(/{createdAt}/g, `<t:${createdSec}:D>`)
      .replace(/{accountAge}/g, `${accountAgeDays}일`)
      .replace(/{joinCount}/g, joinCountNum.toString())
      .replace(/{isRejoin}/g, isRejoinText);
  }
}

export const settingsManager = new SettingsManager();
