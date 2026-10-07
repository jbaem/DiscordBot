import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { AttachmentBuilder, ChannelType, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { config } from '../config.js';
import { createBackup, parseBackup, applyBackup, BackupError, MAX_BACKUP_FILE_BYTES } from './backupManager.js';
import { buildBackupFileName, parseBackupFileName } from '../stores/backupStore.js';
import { DATA_DIR } from '../stores/jsonStore.js';
import { settingsManager, DISABLED } from '../stores/settingsManager.js';
import { memberHistoryManager } from '../stores/memberHistoryManager.js';
import { activityManager } from '../stores/activityManager.js';

/**
 * 디스코드 채널 자동 백업
 * - 호스팅 서버의 디스크(data/, backups/)가 재배포·재시작 때 지워져도 데이터가 남도록 백업 파일을 채널에 보관한다.
 * - 채널에는 백업 메시지 1개만 두고, 백업할 때마다 그 메시지를 수정해 파일을 붙인다 (새 메시지·알림 없음).
 *   메시지 하나에 최근 MAX_KEPT_BACKUPS 개 파일을 보관한다.
 * - 시작 시: 채널의 가장 최근 백업이 디스크의 데이터보다 최신이면(또는 디스크가 비어 있으면) 그대로 불러온다.
 * - 시작 시 / 주기적으로 / 종료 시: 내용이 바뀌었을 때만 백업한다.
 * - 채널: `/연결 채널 백업` 으로 지정 (설정한 적 없으면 BACKUP_CHANNEL_ID 환경 변수 중 이 서버 채널)
 * - 설정까지 지워진 채로 시작하면 봇이 볼 수 있는 텍스트 채널에서 봇이 올린 가장 최근 백업을 찾아 복원한다.
 */

/** 주기 백업 간격 (내용이 바뀌었을 때만 백업) */
export const AUTO_BACKUP_INTERVAL_MS = 60 * 60 * 1000;
/** 백업 메시지 하나에 보관할 최근 백업 파일 수 (디스코드 메시지 첨부 최대 10개) */
export const MAX_KEPT_BACKUPS = 10;
/** 자동 백업 파일 이름 태그 (backup-<서버ID>-<시각>-auto.json) */
const AUTO_TAG = 'auto';
/** 백업 채널을 찾을 때 채널마다 확인할 최근 메시지 수 */
const DISCOVERY_FETCH_LIMIT = 20;

const REQUIRED_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.ReadMessageHistory,
];

/** 백업 대상 데이터 파일 (data/ 안) */
const DATA_FILES = ['guildSettings.json', 'memberHistory.json', 'activity.json'];

/**
 * 프로세스 시작 시점(로그인 전)의 디스크 데이터 상태
 * - 이 모듈은 로그인 전에 불러와지므로 아직 어떤 이벤트도 데이터를 만들지 않은 상태
 * - guildIds: 데이터가 있던 서버 (없으면 디스크가 지워졌거나 처음 쓰는 서버)
 * - savedAt: 데이터 파일이 마지막으로 저장된 시각 (채널 백업과 어느 쪽이 최신인지 비교)
 */
const bootState = {
  guildIds: new Set(
    [settingsManager.cache, memberHistoryManager.cache, activityManager.cache].flatMap(cache => Object.keys(cache || {}))
  ),
  savedAt: Math.max(
    0,
    ...DATA_FILES.map(name => {
      try {
        return fs.statSync(path.join(DATA_DIR, name)).mtimeMs;
      } catch {
        return 0;
      }
    })
  ),
};

/** 서버 ID → { lastHash, queue } */
const states = new Map();
let botClient = null;
let intervalTimer = null;

function stateOf(guildId) {
  if (!states.has(guildId)) states.set(guildId, { lastHash: null, queue: Promise.resolve() });
  return states.get(guildId);
}

/** 백업 내용 비교용 해시 (내보낸 시각·서버 이름 제외) */
function contentHash(backup) {
  const { settings, memberHistory, activity } = backup;
  return createHash('sha256').update(JSON.stringify({ settings, memberHistory, activity })).digest('hex');
}

/** 백업 요약 문구 */
function summarize(backup) {
  return `멤버 이력 ${Object.keys(backup.memberHistory).length}명 · 활동 기록 ${Object.keys(backup.activity).length}명`;
}

/**
 * 이 서버의 자동 백업 채널
 * - `/연결 채널 백업` 설정 → 해제했으면 없음 → 설정한 적 없으면 BACKUP_CHANNEL_ID 중 이 서버의 채널
 * - 설정을 읽기만 하도록 cache 를 직접 조회 (getGuildSettings 는 없는 서버의 설정을 새로 만듦)
 */
export function resolveBackupChannel(guild) {
  const value = settingsManager.cache[guild.id]?.backupChannelId;
  if (value === DISABLED) return null;
  const channelId =
    typeof value === 'string' && value ? value : config.backupChannelIds.find(id => guild.channels.cache.has(id));
  const channel = channelId ? guild.channels.cache.get(channelId) : null;
  return channel?.isTextBased() ? channel : null;
}

/** 백업 채널에 부족한 봇 권한 이름 목록 */
function missingPermissions(channel) {
  return channel.permissionsFor(channel.guild.members.me)?.missing(REQUIRED_PERMISSIONS) ?? ['ViewChannel'];
}

/** 첨부 파일 ID(스노우플레이크) 내림차순 = 최신순 */
function newestFirst(a, b) {
  const x = BigInt(a.id);
  const y = BigInt(b.id);
  return x === y ? 0 : x > y ? -1 : 1;
}

/**
 * 채널에서 봇이 올린 이 서버의 백업 파일 (최신순, 최근 limit 개 메시지 안에서)
 * @returns {Promise<Array<{ message, attachment, tag: string|null }>>}
 */
async function fetchBackupFiles(channel, guildId, limit = 100) {
  const messages = await channel.messages.fetch({ limit });
  return [...messages.values()]
    .filter(message => message.author.id === channel.client.user.id)
    .flatMap(message =>
      [...message.attachments.values()]
        .filter(attachment => parseBackupFileName(attachment.name)?.guildId === guildId)
        .map(attachment => ({ message, attachment, tag: parseBackupFileName(attachment.name).tag }))
    )
    .sort((a, b) => newestFirst(a.attachment, b.attachment));
}

/**
 * 설정까지 지워진 경우: 봇이 볼 수 있는 텍스트 채널에서 봇이 올린 가장 최근 백업이 있는 채널을 찾음
 * (채널마다 최근 DISCOVERY_FETCH_LIMIT 개 메시지만 확인)
 */
async function discoverBackupChannel(guild) {
  let found = null;
  for (const channel of guild.channels.cache.values()) {
    if (channel.type !== ChannelType.GuildText) continue;
    const perms = channel.permissionsFor(guild.members.me);
    if (!perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory])) continue;
    const [latest] = await fetchBackupFiles(channel, guild.id, DISCOVERY_FETCH_LIMIT).catch(() => []);
    if (latest && (!found || newestFirst(latest.attachment, found.attachment) < 0)) {
      found = { channel, attachment: latest.attachment };
    }
  }
  return found?.channel ?? null;
}

/** 첨부 파일을 내려받아 백업 객체로 검증 */
async function downloadBackup(attachment) {
  if (attachment.size > MAX_BACKUP_FILE_BYTES) {
    throw new BackupError(`백업 파일이 너무 큽니다. (${(attachment.size / 1024 / 1024).toFixed(1)}MB)`);
  }
  const response = await fetch(attachment.url);
  if (!response.ok) throw new Error(`백업 파일 내려받기 실패 (HTTP ${response.status})`);
  return parseBackup(await response.text());
}

/**
 * 시작 시: 채널의 가장 최근 백업이 디스크 데이터보다 최신이면 그대로(전체 교체) 불러옴
 * - 디스크 데이터가 더 최신이면(종료 시 백업 없이 강제 종료된 경우 등) 디스크 데이터를 유지
 * - 채널에 메시지를 남기지 않고 로그로만 기록
 */
async function restoreOnStartup(guild, channel, state) {
  const [latest] = await fetchBackupFiles(channel, guild.id);
  if (!latest) {
    console.log(`[AutoBackup] ${guild.name}: #${channel.name} 에 백업이 없어 복원할 내용이 없습니다.`);
    return;
  }

  const backup = await downloadBackup(latest.attachment);
  if (backup.guildId !== guild.id) throw new BackupError('다른 서버의 백업 파일입니다.');

  const backupAt = Date.parse(backup.exportedAt) || latest.message.createdTimestamp;
  if (bootState.guildIds.has(guild.id) && bootState.savedAt > backupAt) {
    state.lastHash = contentHash(backup);
    console.log(`[AutoBackup] ${guild.name}: 저장된 데이터가 채널 백업(${latest.attachment.name})보다 최신이라 그대로 유지합니다.`);
    return;
  }

  const result = applyBackup(guild, backup, 'replace');
  // 백업 채널 설정이 없는 예전 백업이었으면, 찾은 채널을 백업 채널로 기억
  if (!resolveBackupChannel(guild) && settingsManager.cache[guild.id]?.backupChannelId !== DISABLED) {
    settingsManager.updateGuildSettings(guild.id, { backupChannelId: channel.id });
  }
  state.lastHash = contentHash(createBackup(guild));
  console.log(
    `[AutoBackup] ♻️ ${guild.name}: 가장 최근 채널 백업 ${latest.attachment.name} 을(를) 불러왔습니다. ` +
      `(설정 ${result.appliedSettings.length}개 · 멤버 이력 ${result.history.total}명 · 활동 기록 ${result.activity.total}명)`
  );
}

/**
 * 서버 하나를 백업 채널에 백업 (마지막 백업과 내용이 같으면 건너뜀)
 * - 봇이 올린 백업 메시지가 있으면 그 메시지를 수정해 새 파일을 붙이고 오래된 파일은 뗌 (새 메시지·알림 없음)
 * - 백업 메시지가 없으면(처음 연결, 메시지 삭제됨) 알림 없는 메시지로 새로 보냄
 * - 같은 서버의 백업은 순서대로 하나씩 실행, 채널은 실행할 때마다 설정에서 다시 확인
 * @param {{ force?: boolean }} [options] force: 내용이 같아도 백업 (채널을 새로 연결했을 때)
 * @returns {Promise<'uploaded'|'unchanged'|'failed'|'disabled'>}
 */
export function backupGuild(guild, reason, { force = false } = {}) {
  const state = stateOf(guild.id);
  state.queue = state.queue.then(async () => {
    const channel = resolveBackupChannel(guild);
    if (!channel) return 'disabled';
    try {
      const missing = missingPermissions(channel);
      if (missing.length > 0) throw new Error(`#${channel.name} 채널에 봇 권한 부족: ${missing.join(', ')}`);

      const backup = createBackup(guild);
      const hash = contentHash(backup);
      if (!force && hash === state.lastHash) return 'unchanged';

      const fileName = buildBackupFileName(guild.id, new Date(), AUTO_TAG);
      const file = new AttachmentBuilder(Buffer.from(JSON.stringify(backup, null, 2), 'utf-8'), { name: fileName });

      // 가장 최근 자동 백업이 붙어 있는 봇 메시지 = 수정할 백업 메시지
      const message = (await fetchBackupFiles(channel, guild.id)).find(f => f.tag === AUTO_TAG)?.message;
      const kept = message
        ? [...message.attachments.values()]
            .filter(a => parseBackupFileName(a.name)?.guildId === guild.id)
            .sort(newestFirst)
            .slice(0, MAX_KEPT_BACKUPS - 1)
        : [];
      const content =
        `🗄️ **자동 백업** · 마지막 백업 <t:${Math.floor(Date.now() / 1000)}:f> (${reason})\n` +
        `${summarize(backup)} · 최근 백업 ${kept.length + 1}개 보관 · 봇이 이 메시지를 계속 수정합니다.`;

      if (message) {
        await message.edit({ content, files: [file], attachments: kept, allowedMentions: { parse: [] } });
      } else {
        await channel.send({ content, files: [file], flags: MessageFlags.SuppressNotifications, allowedMentions: { parse: [] } });
      }
      state.lastHash = hash;
      console.log(`[AutoBackup] ${guild.name}: ${reason} 백업 → #${channel.name} ${fileName}`);
      return 'uploaded';
    } catch (error) {
      console.error(`[AutoBackup] ❌ ${guild.name}: ${reason} 백업 실패:`, error.message);
      return 'failed';
    }
  });
  return state.queue;
}

/** 봇이 참여한 모든 서버를 백업 (백업 채널이 없는 서버는 'disabled') */
export function backupAll(reason) {
  if (!botClient) return Promise.resolve([]);
  return Promise.all([...botClient.guilds.cache.values()].map(guild => backupGuild(guild, reason)));
}

/**
 * 봇 시작 시 실행 (ClientReady)
 * 서버마다 백업 채널 확인(없고 데이터도 없으면 채널 찾기) → 필요하면 복원 → 시작 시 백업 → 주기 백업 예약
 */
export async function startAutoBackup(client) {
  botClient = client;
  let active = 0;

  for (const guild of client.guilds.cache.values()) {
    let channel = resolveBackupChannel(guild);
    if (!channel && !bootState.guildIds.has(guild.id)) {
      // 설정까지 지워진 상태 → 봇이 올린 백업이 있는 채널을 찾아봄
      channel = await discoverBackupChannel(guild).catch(error => {
        console.warn(`[AutoBackup] ${guild.name}: 백업 채널 찾기 실패:`, error.message);
        return null;
      });
      if (channel) console.log(`[AutoBackup] ${guild.name}: 저장된 설정이 없어 #${channel.name} 에서 백업을 찾았습니다.`);
    }
    if (!channel) continue;
    active++;

    try {
      await restoreOnStartup(guild, channel, stateOf(guild.id));
    } catch (error) {
      console.error(`[AutoBackup] ❌ ${guild.name}: 시작 시 복원 실패:`, error);
    }
    await backupGuild(guild, '시작 시');
  }

  // 나중에 /연결 채널 백업 으로 연결하는 서버도 있으므로 주기 백업은 항상 예약
  intervalTimer = setInterval(() => backupAll('주기'), AUTO_BACKUP_INTERVAL_MS);
  intervalTimer.unref();
  console.log(
    active > 0
      ? `[AutoBackup] ✅ ${active}개 서버 자동 백업 사용 중 (${AUTO_BACKUP_INTERVAL_MS / 60000}분마다, 종료 시)`
      : '[AutoBackup] 백업 채널이 연결된 서버가 없습니다. `/연결 채널 백업` 으로 연결하면 자동 백업을 시작합니다.'
  );
}

/** 종료 시 실행: 주기 백업을 멈추고 마지막 백업을 올림 */
export async function stopAutoBackup() {
  if (intervalTimer) clearInterval(intervalTimer);
  intervalTimer = null;
  return backupAll('종료 시');
}
