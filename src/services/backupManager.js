import { settingsManager, DISABLED, ID_SETTING_KEYS } from '../stores/settingsManager.js';
import { memberHistoryManager } from '../stores/memberHistoryManager.js';
import { activityManager } from '../stores/activityManager.js';

/**
 * 백업 파일 포맷 버전 (구조가 바뀌면 올리고 parseBackup에서 하위 호환 처리)
 * - v1: settings + memberHistory
 * - v2: activity(활동일/메시지/음성 시간) 추가 (예전 백업의 points 값은 포인트 기능 제거로 무시)
 * - v3: 채널/역할 ID 의 false = 명시적 비활성화, null = 미설정(.env 폴백) 으로 구분
 */
export const BACKUP_VERSION = 3;

/** 백업/복원 대상이 되는 서버 설정 키 (화이트리스트) */
export const BACKUP_SETTING_KEYS = [
  'joinToCreateChannelId',
  'voiceNameTemplate',
  'welcomeChannelId',
  'welcomeMessage',
  'leaveChannelId',
  'leaveMessage',
  'autoRoleId',
  'nicknameLogChannelId',
  'rolePanelChannelId',
  'reactionRoles',
  'reactionRolePanels',
];

const SNOWFLAKE_PATTERN = /^\d{15,22}$/;

/** 백업의 이모지 역할 매핑 배열에서 형식이 올바른 항목만 정리 */
function sanitizeReactionRoles(list) {
  return list
    .filter(
      m =>
        m &&
        typeof m === 'object' &&
        SNOWFLAKE_PATTERN.test(m.roleId) &&
        typeof m.emojiName === 'string' &&
        m.emojiName.length > 0 &&
        (m.emojiId == null || SNOWFLAKE_PATTERN.test(m.emojiId))
    )
    .map(m => ({
      roleId: m.roleId,
      emojiId: m.emojiId || null,
      emojiName: m.emojiName,
      emojiKey: m.emojiId || m.emojiName,
      animated: Boolean(m.animated),
      description: typeof m.description === 'string' ? m.description.slice(0, 100) : null,
    }));
}

/** 백업의 패널 메시지 배열에서 형식이 올바른 항목만 정리 */
function sanitizeReactionRolePanels(list) {
  return list
    .filter(p => p && typeof p === 'object' && SNOWFLAKE_PATTERN.test(p.messageId) && SNOWFLAKE_PATTERN.test(p.channelId))
    .map(p => ({
      messageId: p.messageId,
      channelId: p.channelId,
      title: typeof p.title === 'string' ? p.title.slice(0, 256) : null,
      description: typeof p.description === 'string' ? p.description.slice(0, 1000) : null,
    }));
}

/** 복원 시 허용하는 최대 파일 크기 (5MB) */
export const MAX_BACKUP_FILE_BYTES = 5 * 1024 * 1024;

/** 사용자에게 그대로 보여줄 수 있는 백업 관련 오류 */
export class BackupError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BackupError';
  }
}

/**
 * 현재 서버의 설정과 멤버 입장/퇴장 이력을 백업 객체로 생성
 * @param {import('discord.js').Guild} guild
 */
export function createBackup(guild) {
  const settings = settingsManager.getGuildSettings(guild.id);
  const pickedSettings = {};
  for (const key of BACKUP_SETTING_KEYS) {
    pickedSettings[key] = settings[key] ?? null;
  }

  return {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    guildId: guild.id,
    guildName: guild.name,
    settings: pickedSettings,
    memberHistory: memberHistoryManager.getGuildHistory(guild.id),
    activity: activityManager.getGuildActivity(guild.id),
  };
}

/**
 * 백업 파일 텍스트를 파싱하고 구조를 검증
 * @param {string} rawText
 * @returns {object} 검증된 백업 객체
 * @throws {BackupError} 형식이 올바르지 않을 때
 */
export function parseBackup(rawText) {
  let data;
  try {
    data = JSON.parse(rawText);
  } catch {
    throw new BackupError('JSON 형식이 올바르지 않습니다. 이 봇의 `/백업 내보내기`로 만든 파일인지 확인해 주세요.');
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new BackupError('백업 파일의 최상위 구조가 객체가 아닙니다.');
  }

  if (typeof data.version !== 'number' || data.version < 1) {
    throw new BackupError('백업 파일에 유효한 `version` 정보가 없습니다.');
  }
  if (data.version > BACKUP_VERSION) {
    throw new BackupError(
      `이 백업 파일(v${data.version})은 현재 봇(v${BACKUP_VERSION})보다 새로운 형식입니다. 봇을 업데이트한 뒤 다시 시도해 주세요.`
    );
  }

  if (typeof data.guildId !== 'string' || !/^\d{15,22}$/.test(data.guildId)) {
    throw new BackupError('백업 파일의 `guildId`가 올바르지 않습니다.');
  }

  if (!data.settings || typeof data.settings !== 'object' || Array.isArray(data.settings)) {
    throw new BackupError('백업 파일에 `settings` 항목이 없거나 형식이 올바르지 않습니다.');
  }

  if (data.memberHistory === undefined) {
    data.memberHistory = {};
  }
  if (!data.memberHistory || typeof data.memberHistory !== 'object' || Array.isArray(data.memberHistory)) {
    throw new BackupError('백업 파일의 `memberHistory` 형식이 올바르지 않습니다.');
  }

  // v1 백업에는 activity 가 없음 → 빈 객체로 취급
  if (data.activity === undefined) {
    data.activity = {};
  }
  if (!data.activity || typeof data.activity !== 'object' || Array.isArray(data.activity)) {
    throw new BackupError('백업 파일의 `activity` 형식이 올바르지 않습니다.');
  }

  return data;
}

/**
 * 검증된 백업 객체를 서버에 적용
 * @param {import('discord.js').Guild} guild 적용 대상 서버
 * @param {object} backup parseBackup을 통과한 백업 객체
 * @param {'merge'|'replace'} mode 이력 복원 방식
 * @returns {{ appliedSettings: string[], skippedSettings: string[], missingChannels: string[], history: { imported: number, total: number }, activity: { imported: number, total: number } }}
 */
export function applyBackup(guild, backup, mode = 'merge') {
  const updates = {};
  const skippedSettings = [];

  for (const key of BACKUP_SETTING_KEYS) {
    if (!(key in backup.settings)) continue;
    let value = backup.settings[key];
    // v2 이하 백업에서 autoRoleId 의 null 은 "비활성화"였으므로 같은 의미로 복원
    if (key === 'autoRoleId' && value === null && backup.version < 3) value = DISABLED;

    if (value === null || typeof value === 'string') {
      updates[key] = value;
    } else if (value === DISABLED && ID_SETTING_KEYS.includes(key)) {
      updates[key] = DISABLED;
    } else if (key === 'reactionRoles' && Array.isArray(value)) {
      updates[key] = sanitizeReactionRoles(value);
    } else if (key === 'reactionRolePanels' && Array.isArray(value)) {
      updates[key] = sanitizeReactionRolePanels(value);
    } else {
      skippedSettings.push(key);
    }
  }

  settingsManager.updateGuildSettings(guild.id, updates);

  // 백업에 기록된 채널이 현재 서버에 없으면 안내용으로 수집 (설정 자체는 그대로 복원)
  const missingChannels = [];
  for (const key of ['joinToCreateChannelId', 'welcomeChannelId', 'leaveChannelId', 'nicknameLogChannelId', 'rolePanelChannelId']) {
    const channelId = updates[key];
    if (channelId && !guild.channels.cache.has(channelId)) {
      missingChannels.push(`${key}: ${channelId}`);
    }
  }

  const history = memberHistoryManager.importGuildHistory(guild.id, backup.memberHistory, mode);
  const activity = activityManager.importGuildActivity(guild.id, backup.activity, mode);

  return {
    appliedSettings: Object.keys(updates),
    skippedSettings,
    missingChannels,
    history,
    activity,
  };
}
