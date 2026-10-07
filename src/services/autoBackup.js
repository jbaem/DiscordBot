import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { AttachmentBuilder, PermissionFlagsBits } from 'discord.js';
import { config } from '../config.js';
import { createBackup, parseBackup, applyBackup, BackupError, MAX_BACKUP_FILE_BYTES } from './backupManager.js';
import { buildBackupFileName, parseBackupFileName } from '../stores/backupStore.js';
import { DATA_DIR } from '../stores/jsonStore.js';
import { settingsManager } from '../stores/settingsManager.js';
import { memberHistoryManager } from '../stores/memberHistoryManager.js';
import { activityManager } from '../stores/activityManager.js';

/**
 * 디스코드 채널 자동 백업
 * - 호스팅 서버의 디스크(data/, backups/)가 재배포·재시작 때 지워져도 데이터가 남도록 백업 파일을 채널에 올린다.
 * - 시작 시: 채널의 가장 최근 백업이 디스크의 데이터보다 최신이면(또는 디스크가 비어 있으면) 그대로 불러온다.
 * - 시작 시 / 주기적으로 / 종료 시: 내용이 바뀌었을 때만 새 백업을 올린다.
 * - 채널은 BACKUP_CHANNEL_ID 환경 변수로 지정 (서버 설정은 data/ 와 함께 지워질 수 있으므로 환경 변수 사용)
 */

/** 주기 백업 간격 (내용이 바뀌었을 때만 올림) */
export const AUTO_BACKUP_INTERVAL_MS = 60 * 60 * 1000;
/** 채널에 남겨 둘 서버별 자동 백업 수 (넘으면 오래된 것부터 삭제) */
export const MAX_CHANNEL_BACKUPS_PER_GUILD = 20;
/** 자동 백업 파일 이름 태그 (backup-<서버ID>-<시각>-auto.json) */
const AUTO_TAG = 'auto';

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

/** 서버 ID → { channel, lastHash, queue } */
const targets = new Map();
let intervalTimer = null;

/** 백업 내용 비교용 해시 (내보낸 시각·서버 이름 제외) */
function contentHash(backup) {
  const { settings, memberHistory, activity } = backup;
  return createHash('sha256').update(JSON.stringify({ settings, memberHistory, activity })).digest('hex');
}

/** 백업 요약 문구 */
function summarize(backup) {
  return `멤버 이력 ${Object.keys(backup.memberHistory).length}명 · 활동 기록 ${Object.keys(backup.activity).length}명`;
}

/** BACKUP_CHANNEL_ID 의 채널을 확인해 서버별 백업 채널로 등록 */
async function resolveTargets(client) {
  for (const channelId of config.backupChannelIds) {
    const channel = /^\d{15,22}$/.test(channelId) ? await client.channels.fetch(channelId).catch(() => null) : null;
    if (!channel?.guild || !channel.isTextBased()) {
      console.warn(`[AutoBackup] ⚠️ 백업 채널 ${channelId} 을(를) 찾을 수 없거나 텍스트 채널이 아닙니다.`);
      continue;
    }
    const missing = channel.permissionsFor(channel.guild.members.me)?.missing(REQUIRED_PERMISSIONS) ?? ['ViewChannel'];
    if (missing.length > 0) {
      console.warn(`[AutoBackup] ⚠️ #${channel.name}(${channel.guild.name}) 에 봇 권한이 부족합니다: ${missing.join(', ')}`);
      continue;
    }
    if (targets.has(channel.guild.id)) {
      console.warn(`[AutoBackup] ⚠️ ${channel.guild.name} 에 백업 채널이 여러 개 지정되어 첫 번째만 사용합니다. (무시: ${channelId})`);
      continue;
    }
    targets.set(channel.guild.id, { channel, lastHash: null, queue: Promise.resolve() });
  }
}

/** 채널에서 봇이 올린 이 서버의 백업 메시지 (최신순, 최근 100개 메시지 안에서) */
async function fetchBackupMessages(channel, guildId) {
  const messages = await channel.messages.fetch({ limit: 100 });
  return [...messages.values()]
    .filter(message => message.author.id === channel.client.user.id)
    .map(message => {
      const attachment = message.attachments.find(a => parseBackupFileName(a.name)?.guildId === guildId);
      return attachment ? { message, attachment, tag: parseBackupFileName(attachment.name).tag } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.message.createdTimestamp - a.message.createdTimestamp);
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
 */
async function restoreOnStartup(guild, target) {
  const [latest] = await fetchBackupMessages(target.channel, guild.id);
  if (!latest) {
    console.log(`[AutoBackup] ${guild.name}: 채널에 백업이 없어 복원할 내용이 없습니다.`);
    return;
  }

  const backup = await downloadBackup(latest.attachment);
  if (backup.guildId !== guild.id) throw new BackupError('다른 서버의 백업 파일입니다.');

  const backupAt = Date.parse(backup.exportedAt) || latest.message.createdTimestamp;
  if (bootState.guildIds.has(guild.id) && bootState.savedAt > backupAt) {
    target.lastHash = contentHash(backup);
    console.log(`[AutoBackup] ${guild.name}: 저장된 데이터가 채널 백업(${latest.attachment.name})보다 최신이라 그대로 유지합니다.`);
    return;
  }

  const result = applyBackup(guild, backup, 'replace');
  target.lastHash = contentHash(createBackup(guild));
  const summary = `설정 ${result.appliedSettings.length}개 · 멤버 이력 ${result.history.total}명 · 활동 기록 ${result.activity.total}명`;
  console.log(`[AutoBackup] ♻️ ${guild.name}: 가장 최근 채널 백업 ${latest.attachment.name} 을(를) 불러왔습니다. (${summary})`);
  await target.channel
    .send({ content: `♻️ 시작 시 자동 복원: \`${latest.attachment.name}\` · ${summary}`, allowedMentions: { parse: [] } })
    .catch(error => console.warn('[AutoBackup] 복원 안내 메시지 전송 실패:', error.message));
}

/** 서버별 자동 백업을 최근 MAX_CHANNEL_BACKUPS_PER_GUILD 개만 남기고 삭제 (봇이 올린 자동 백업만) */
async function pruneChannel(channel, guildId) {
  const autoBackups = (await fetchBackupMessages(channel, guildId)).filter(b => b.tag === AUTO_TAG);
  for (const old of autoBackups.slice(MAX_CHANNEL_BACKUPS_PER_GUILD)) {
    await old.message.delete().catch(error => console.warn('[AutoBackup] 오래된 백업 메시지 삭제 실패:', error.message));
  }
}

/**
 * 서버 하나를 채널에 백업 (마지막으로 올린 내용과 같으면 건너뜀)
 * - 같은 서버의 백업은 순서대로 하나씩 실행
 * @returns {Promise<'uploaded'|'unchanged'|'failed'|'disabled'>}
 */
export function backupGuild(guild, reason) {
  const target = targets.get(guild.id);
  if (!target) return Promise.resolve('disabled');

  target.queue = target.queue.then(async () => {
    try {
      const backup = createBackup(guild);
      const hash = contentHash(backup);
      if (hash === target.lastHash) return 'unchanged';

      const fileName = buildBackupFileName(guild.id, new Date(), AUTO_TAG);
      const file = new AttachmentBuilder(Buffer.from(JSON.stringify(backup, null, 2), 'utf-8'), { name: fileName });
      await target.channel.send({
        content: `🗄️ 자동 백업 (${reason}) · ${summarize(backup)}`,
        files: [file],
        allowedMentions: { parse: [] },
      });
      target.lastHash = hash;
      console.log(`[AutoBackup] ${guild.name}: ${reason} 백업 → #${target.channel.name} ${fileName}`);

      await pruneChannel(target.channel, guild.id).catch(error =>
        console.warn('[AutoBackup] 오래된 백업 정리 실패:', error.message)
      );
      return 'uploaded';
    } catch (error) {
      console.error(`[AutoBackup] ❌ ${guild.name}: ${reason} 백업 실패:`, error);
      return 'failed';
    }
  });
  return target.queue;
}

/** 등록된 모든 서버를 백업 */
export function backupAll(reason) {
  return Promise.all([...targets.values()].map(target => backupGuild(target.channel.guild, reason)));
}

/**
 * 봇 시작 시 실행 (ClientReady)
 * 백업 채널 확인 → 필요하면 복원 → 시작 시 백업 → 주기 백업 예약
 */
export async function startAutoBackup(client) {
  if (config.backupChannelIds.length === 0) {
    console.log('[AutoBackup] BACKUP_CHANNEL_ID 가 없어 채널 자동 백업을 사용하지 않습니다.');
    return;
  }

  await resolveTargets(client);
  for (const target of targets.values()) {
    const guild = target.channel.guild;
    try {
      await restoreOnStartup(guild, target);
    } catch (error) {
      console.error(`[AutoBackup] ❌ ${guild.name}: 시작 시 복원 실패:`, error);
    }
    await backupGuild(guild, '시작 시');
  }

  if (targets.size > 0) {
    intervalTimer = setInterval(() => backupAll('주기'), AUTO_BACKUP_INTERVAL_MS);
    intervalTimer.unref();
    console.log(`[AutoBackup] ✅ ${targets.size}개 서버 자동 백업 사용 중 (${AUTO_BACKUP_INTERVAL_MS / 60000}분마다, 종료 시)`);
  }
}

/** 종료 시 실행: 주기 백업을 멈추고 마지막 백업을 올림 */
export async function stopAutoBackup() {
  if (intervalTimer) clearInterval(intervalTimer);
  intervalTimer = null;
  return backupAll('종료 시');
}
