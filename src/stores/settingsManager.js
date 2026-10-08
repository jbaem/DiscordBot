import { config } from '../config.js';
import { JsonStore } from './jsonStore.js';
import { fillTemplate } from '../utils/template.js';
import { memberHistoryManager } from './memberHistoryManager.js';

const store = new JsonStore('guildSettings.json', 'Settings');

/** 기본 입장/퇴장 문구 (멤버 수 대신 임베드 필드로 입장/퇴장 시각을 표시) */
export const DEFAULT_WELCOME_MESSAGE = '환영합니다, {user} 님! **{server}**에 오신 것을 환영해요.';
export const DEFAULT_LEAVE_MESSAGE = '**{userName}** 님이 서버를 떠났습니다.';
/** 기본 임시 음성방 이름 서식 */
export const DEFAULT_VOICE_NAME_TEMPLATE = '🔊 {userName}님의 통화방';

/** 예전 버전의 기본 문구 — 서버가 직접 바꾼 적 없이 그대로 쓰고 있으면 새 기본 문구로 자동 교체 */
const LEGACY_DEFAULTS = {
  welcomeMessage: ['환영합니다, {user} 님! **{server}**에 오신 것을 환영해요. (현재 멤버 수: {count}명)'],
  leaveMessage: ['**{userName}** 님이 서버를 떠났습니다. (남은 멤버 수: {count}명)'],
};

/**
 * 서버 설정 레코드 구조 버전
 * - v1(필드 없음): 채널/역할 ID 의 null 이 "비활성화"와 "미설정"을 구분하지 못함
 * - v2: null = 미설정(.env 폴백), false = 명시적 비활성화(DISABLED)
 */
export const SETTINGS_VERSION = 2;

/** 명시적으로 해제(비활성화)된 채널/역할 ID 값 */
export const DISABLED = false;

/**
 * 채널/역할 ID 설정 키 → .env 폴백 값
 * 슬래시 명령어로 설정한 적 없는(null) 서버는 이 값을 사용한다.
 */
const ENV_FALLBACKS = {
  welcomeChannelId: () => config.welcomeChannelId,
  leaveChannelId: () => config.leaveChannelId,
  joinToCreateChannelId: () => config.joinToCreateChannelId,
  autoRoleId: () => config.autoRoleId,
  nicknameLogChannelId: () => '',
  rolePanelChannelId: () => '',
  backupChannelId: () => '', // .env 폴백은 BACKUP_CHANNEL_ID(여러 서버 목록)로 autoBackup 에서 따로 처리
  gameChannelId: () => '',
};

/** DISABLED 로 해제할 수 있는 ID 설정 키 목록 */
export const ID_SETTING_KEYS = Object.keys(ENV_FALLBACKS);

class SettingsManager {
  constructor() {
    this.cache = store.load();
    this.migrate();
  }

  /** 예전 형식의 설정을 현재 형식으로 변환 */
  migrate() {
    let changed = false;
    for (const settings of Object.values(this.cache)) {
      if (!settings || typeof settings !== 'object') continue;

      // 예전 기본 문구를 그대로 쓰는 서버의 설정을 새 기본 문구로 교체
      if (LEGACY_DEFAULTS.welcomeMessage.includes(settings.welcomeMessage)) {
        settings.welcomeMessage = DEFAULT_WELCOME_MESSAGE;
        changed = true;
      }
      if (LEGACY_DEFAULTS.leaveMessage.includes(settings.leaveMessage)) {
        settings.leaveMessage = DEFAULT_LEAVE_MESSAGE;
        changed = true;
      }

      // v1 → v2: v1 에서 autoRoleId 의 null 은 "비활성화"였으므로 DISABLED 로 옮겨 기존 동작을 유지
      // (채널 ID 의 null 은 v1 에서도 .env 폴백이었으므로 그대로 둔다)
      if (!settings.settingsVersion) {
        if (settings.autoRoleId === null) settings.autoRoleId = DISABLED;
        settings.settingsVersion = SETTINGS_VERSION;
        changed = true;
      }
    }
    if (changed) {
      this.saveToFile();
      console.log('[Settings] 예전 형식의 서버 설정을 현재 형식으로 변환했습니다.');
    }
  }

  saveToFile() {
    store.save(this.cache);
  }

  getGuildSettings(guildId) {
    if (!this.cache[guildId]) {
      this.cache[guildId] = {
        settingsVersion: SETTINGS_VERSION,
        // 채널/역할 ID: null = 미설정(.env 폴백), DISABLED(false) = 비활성화
        joinToCreateChannelId: null,
        voiceNameTemplate: DEFAULT_VOICE_NAME_TEMPLATE,
        welcomeChannelId: null,
        welcomeMessage: DEFAULT_WELCOME_MESSAGE,
        leaveChannelId: null,
        leaveMessage: DEFAULT_LEAVE_MESSAGE,
        autoRoleId: null, // 신규 멤버 자동 역할
        nicknameLogChannelId: null, // 닉네임 변경 로그 채널
        rolePanelChannelId: null, // 이모지 역할 패널을 게시할 채널 (서버당 패널 1개만 유지)
        reactionRoles: [], // 이모지 반응 역할 매핑 [{ roleId, emojiKey, emojiId, emojiName, animated, description }]
        reactionRolePanels: [], // 게시된 패널 메시지 [{ messageId, channelId, title, description }]
        backupChannelId: null, // 자동 백업 파일을 올릴 채널
        gameChannelId: null, // 게임랜드 채널 (/게임 등록·게임은 이 채널에서만)
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
   * 실제로 적용되는 채널/역할 ID 를 반환
   * - 문자열: 슬래시 명령어로 설정한 값
   * - DISABLED: 해제됨 → null
   * - null/미설정: .env 폴백 값 (없으면 null)
   * @param {object} settings getGuildSettings 결과
   * @param {string} key ID_SETTING_KEYS 중 하나
   */
  resolveId(settings, key) {
    const value = settings?.[key];
    if (value === DISABLED) return null;
    if (typeof value === 'string' && value) return value;
    return ENV_FALLBACKS[key]?.() || null;
  }

  /**
   * 적용 중인 ID 의 출처
   * @returns {'slash'|'env'|'disabled'|'none'}
   */
  resolveIdSource(settings, key) {
    const value = settings?.[key];
    if (value === DISABLED) return 'disabled';
    if (typeof value === 'string' && value) return 'slash';
    return ENV_FALLBACKS[key]?.() ? 'env' : 'none';
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

    return fillTemplate(template, {
      user: `<@${member.id}>`,
      userName: member.displayName || user.username || '알 수 없음',
      userTag: user.tag || user.username || '알 수 없음',
      userId: member.id || '',
      server: guild.name || '',
      count: (guild.memberCount || 0).toLocaleString(),
      joinedAt: `<t:${joinedSec}:f>`,
      joinedAtRelative: `<t:${joinedSec}:R>`,
      createdAt: `<t:${createdSec}:D>`,
      accountAge: `${accountAgeDays}일`,
      joinCount: joinCountNum.toString(),
      isRejoin: isRejoinText,
    });
  }
}

export const settingsManager = new SettingsManager();
