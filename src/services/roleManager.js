import { PermissionFlagsBits, EmbedBuilder, parseEmoji } from 'discord.js';
import { settingsManager } from '../stores/settingsManager.js';

/** 한 패널 메시지에 등록할 수 있는 최대 이모지 역할 수 (디스코드 메시지당 고유 리액션 제한 20개) */
export const MAX_REACTION_ROLES = 20;

/** 셀프 지급을 허용하지 않는 위험 권한 목록 */
const DANGEROUS_PERMISSIONS = [
  [PermissionFlagsBits.Administrator, '관리자'],
  [PermissionFlagsBits.ManageGuild, '서버 관리'],
  [PermissionFlagsBits.ManageRoles, '역할 관리'],
  [PermissionFlagsBits.ManageChannels, '채널 관리'],
  [PermissionFlagsBits.ManageWebhooks, '웹훅 관리'],
  [PermissionFlagsBits.BanMembers, '멤버 차단'],
  [PermissionFlagsBits.KickMembers, '멤버 추방'],
  [PermissionFlagsBits.ModerateMembers, '멤버 타임아웃'],
  [PermissionFlagsBits.ManageMessages, '메시지 관리'],
  [PermissionFlagsBits.ManageNicknames, '닉네임 관리'],
  [PermissionFlagsBits.MentionEveryone, '@everyone 멘션'],
];

// ─────────────────────────────────────────────────────────────
// 공통: 역할 관리 가능 여부 검사
// ─────────────────────────────────────────────────────────────

/**
 * 봇이 해당 역할을 멤버에게 부여/해제할 수 있는지 검사
 * @returns {{ ok: boolean, reason?: string }}
 */
export function checkBotCanManageRole(guild, role) {
  const me = guild.members.me;
  if (!me) return { ok: false, reason: '봇 멤버 정보를 확인할 수 없습니다.' };
  if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return { ok: false, reason: '봇에 **역할 관리(Manage Roles)** 권한이 없습니다.' };
  }
  if (role.id === guild.id) return { ok: false, reason: '`@everyone` 역할은 사용할 수 없습니다.' };
  if (role.managed) return { ok: false, reason: '봇/연동(Integration) 전용 역할은 부여할 수 없습니다.' };
  if (me.roles.highest.comparePositionTo(role) <= 0) {
    return {
      ok: false,
      reason:
        `봇의 최상위 역할(${me.roles.highest})이 ${role} 역할보다 **위**에 있어야 합니다.\n` +
        '서버 설정 > 역할 목록에서 봇 역할을 대상 역할보다 위로 끌어올려 주세요.',
    };
  }
  return { ok: true };
}

/**
 * 명령어를 실행한 멤버가 해당 역할을 부여/회수할 수 있는지 검사 (디스코드 역할 관리 규칙과 동일)
 * - 봇을 통해 자기보다 높은 역할(관리자 역할 등)을 나눠 주는 권한 상승을 막기 위한 검사
 * - 서버 소유자: 항상 가능
 * - 그 외: 역할 관리 권한 + 최상위 역할이 대상 역할보다 위
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {import('discord.js').Role} role
 * @returns {{ ok: boolean, reason?: string }}
 */
export function checkMemberCanManageRole(interaction, role) {
  if (interaction.guild?.ownerId === interaction.user.id) return { ok: true };
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles)) {
    return { ok: false, reason: '**역할 관리(Manage Roles)** 권한이 있어야 역할을 부여하거나 회수할 수 있습니다.' };
  }
  const highest = interaction.member?.roles?.highest;
  if (!highest || highest.comparePositionTo(role) <= 0) {
    return { ok: false, reason: `내 최상위 역할이 ${role} 역할보다 **위**에 있어야 합니다.` };
  }
  return { ok: true };
}

/** 역할이 가진 위험 권한 이름 목록 (없으면 빈 배열) */
export function getDangerousPermissions(role) {
  return DANGEROUS_PERMISSIONS.filter(([flag]) => role.permissions.has(flag)).map(([, label]) => label);
}

// ─────────────────────────────────────────────────────────────
// 자동 역할 (신규 멤버 입장 시)
// ─────────────────────────────────────────────────────────────

/**
 * 서버의 자동 역할 ID 결정
 * - /자동역할 로 설정한 값이 있으면 그 값 (/자동역할 해제 시 비활성화)
 * - 슬래시 설정 이력이 없는 서버는 .env 의 AUTO_ROLE_ID 폴백
 */
export function resolveAutoRoleId(guildId) {
  const settings = settingsManager.getGuildSettings(guildId);
  return settingsManager.resolveId(settings, 'autoRoleId');
}

/**
 * 신규 멤버에게 자동 역할 부여
 * @returns {Promise<{ status: 'assigned'|'skipped'|'disabled'|'missing'|'failed', role?: import('discord.js').Role, reason?: string }>}
 */
export async function assignAutoRole(member) {
  if (member.user.bot) return { status: 'skipped', reason: '봇 계정' };

  const roleId = resolveAutoRoleId(member.guild.id);
  if (!roleId) return { status: 'disabled' };

  const role = member.guild.roles.cache.get(roleId);
  if (!role) return { status: 'missing', reason: `역할 ID(${roleId})를 찾을 수 없습니다.` };
  if (member.roles.cache.has(roleId)) return { status: 'skipped', role, reason: '이미 보유' };

  const check = checkBotCanManageRole(member.guild, role);
  if (!check.ok) return { status: 'failed', role, reason: check.reason };

  try {
    await member.roles.add(role, '신규 멤버 자동 역할 부여');
    return { status: 'assigned', role };
  } catch (error) {
    return { status: 'failed', role, reason: error.message };
  }
}

/**
 * 현재 서버의 모든(봇 제외) 멤버에게 역할 일괄 부여
 * @returns {Promise<{ total: number, added: number, skipped: number, failed: number }>}
 */
export async function applyRoleToAllMembers(guild, role) {
  const members = await guild.members.fetch();
  const result = { total: 0, added: 0, skipped: 0, failed: 0 };

  for (const member of members.values()) {
    if (member.user.bot) continue;
    result.total++;
    if (member.roles.cache.has(role.id)) {
      result.skipped++;
      continue;
    }
    try {
      await member.roles.add(role, '/자동역할 일괄적용 일괄 부여');
      result.added++;
    } catch (error) {
      result.failed++;
      console.error(`[AutoRole] ${member.user.tag} 역할 부여 실패:`, error.message);
    }
  }
  return result;
}

// ─────────────────────────────────────────────────────────────
// 이모지 반응 역할 (Reaction Roles)
// ─────────────────────────────────────────────────────────────

/**
 * 관리자가 입력한 이모지 문자열을 파싱
 * @returns {{ key: string, id: string|null, name: string, animated: boolean, display: string }|null}
 */
export function parseEmojiInput(input) {
  const trimmed = (input || '').trim();
  if (!trimmed) return null;

  const parsed = parseEmoji(trimmed);
  if (!parsed || !parsed.name) return null;

  if (parsed.id) {
    return {
      key: parsed.id,
      id: parsed.id,
      name: parsed.name,
      animated: Boolean(parsed.animated),
      display: `<${parsed.animated ? 'a' : ''}:${parsed.name}:${parsed.id}>`,
    };
  }

  // 유니코드 이모지: 그림 문자, 국기(지역 표시 문자), 키캡(1️⃣ 등) 포함 여부로 대략 검증
  const looksLikeEmoji =
    /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u.test(parsed.name) && parsed.name.length <= 16;
  if (!looksLikeEmoji) return null;

  return { key: parsed.name, id: null, name: parsed.name, animated: false, display: parsed.name };
}

/** 리액션 이벤트의 이모지 → 저장 키 (커스텀은 ID, 유니코드는 문자 자체) */
export function reactionEmojiKey(emoji) {
  return emoji.id || emoji.name;
}

/** 저장된 매핑 → message.react() 에 넘길 값 */
export function toReactable(mapping) {
  return mapping.emojiId || mapping.emojiName;
}

/** 저장된 매핑 → 표시 문자열 */
export function mappingDisplay(mapping) {
  if (mapping.emojiId) return `<${mapping.animated ? 'a' : ''}:${mapping.emojiName}:${mapping.emojiId}>`;
  return mapping.emojiName;
}

/** 서버의 이모지 역할 매핑 목록 */
export function getReactionRoles(guildId) {
  const settings = settingsManager.getGuildSettings(guildId);
  return Array.isArray(settings.reactionRoles) ? settings.reactionRoles : [];
}

/** 서버의 이모지 역할 패널 메시지 목록 */
export function getReactionRolePanels(guildId) {
  const settings = settingsManager.getGuildSettings(guildId);
  return Array.isArray(settings.reactionRolePanels) ? settings.reactionRolePanels : [];
}

/**
 * 패널 임베드 생성 (현재 서버에 존재하는 역할만 표시)
 */
export function buildReactionRolePanelEmbed(guild, { title, description } = {}) {
  const mappings = getReactionRoles(guild.id).filter(m => guild.roles.cache.has(m.roleId));

  const lines = mappings.map(m => {
    const role = guild.roles.cache.get(m.roleId);
    return `${mappingDisplay(m)} → ${role}${m.description ? ` · ${m.description}` : ''}`;
  });

  return new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(title || '🎭 역할 선택')
    .setDescription(
      (description ? `${description}\n\n` : '') +
        (lines.length ? lines.join('\n') : '등록된 역할이 없습니다.') +
        '\n\n아래 이모지를 누르면 역할이 부여되고, 다시 눌러 반응을 해제하면 역할이 제거됩니다.'
    )
    .setFooter({ text: '반응 역할 패널 · 관리자는 /역할 명령어로 관리할 수 있습니다.' });
}

/**
 * 패널 메시지에 등록된 이모지 반응을 모두 추가 (이미 있는 것은 건너뜀)
 * @returns {Promise<{ reacted: number, failed: string[] }>}
 */
export async function ensurePanelReactions(message) {
  const mappings = getReactionRoles(message.guild.id).filter(m => message.guild.roles.cache.has(m.roleId));
  const result = { reacted: 0, failed: [] };

  for (const mapping of mappings) {
    const already = message.reactions.cache.find(r => reactionEmojiKey(r.emoji) === mapping.emojiKey && r.me);
    if (already) continue;
    try {
      await message.react(toReactable(mapping));
      result.reacted++;
    } catch (error) {
      console.error(`[ReactionRole] 이모지 반응 실패 (${mappingDisplay(mapping)}):`, error.message);
      result.failed.push(mappingDisplay(mapping));
    }
  }
  return result;
}

/**
 * 패널에서 더 이상 등록되지 않은 이모지 반응 정리 (/역할 제거 후 남은 반응)
 * - 메시지 관리 권한이 있으면 반응 전체 제거, 없으면 봇이 단 반응만 제거
 * @returns {Promise<number>} 정리한 이모지 수
 */
async function removeStalePanelReactions(message) {
  const validKeys = new Set(
    getReactionRoles(message.guild.id).filter(m => message.guild.roles.cache.has(m.roleId)).map(m => m.emojiKey)
  );
  let removed = 0;
  for (const reaction of message.reactions.cache.values()) {
    if (validKeys.has(reactionEmojiKey(reaction.emoji))) continue;
    try {
      await reaction.remove();
      removed++;
    } catch {
      await reaction.users.remove(message.client.user.id).catch(() => {});
    }
  }
  return removed;
}

/** 서버별 패널 작업을 한 번에 하나씩 실행 (동시에 실행되어 패널이 두 개 생기는 것 방지) */
const panelLocks = new Map();
function withPanelLock(guildId, task) {
  const previous = panelLocks.get(guildId) ?? Promise.resolve();
  const run = previous.catch(() => {}).then(task);
  panelLocks.set(guildId, run.finally(() => {
    if (panelLocks.get(guildId) === run) panelLocks.delete(guildId);
  }));
  return run;
}

/** 봇이 올린 패널 메시지 삭제 (이미 없으면 무시) */
async function deletePanelMessage(guild, panel) {
  const channel = guild.channels.cache.get(panel.channelId);
  if (!channel?.isTextBased()) return false;
  const message = await channel.messages.fetch(panel.messageId).catch(() => null);
  if (!message) return false;
  return message.delete().then(() => true).catch(() => false);
}

/**
 * 역할 패널을 `/연결 채널 역할패널` 로 지정한 채널에 1개만 유지 (게시 또는 갱신)
 * - 지정 채널에 기존 패널이 있으면 새로 올리지 않고 내용만 수정
 * - 다른 채널에 있거나 중복으로 올라간 예전 패널은 삭제
 * - 패널 메시지가 사라졌으면 새로 게시
 * @param {import('discord.js').Guild} guild
 * @param {{ title?: string, description?: string }} [overrides] 지정하면 패널 제목/안내 문구 변경 (생략 시 기존 값 유지)
 * @returns {Promise<{ status: 'created'|'updated'|'no-channel'|'missing-channel', message?: import('discord.js').Message, removed?: number, reactResult?: { reacted: number, failed: string[] } }>}
 */
export function syncReactionRolePanel(guild, overrides = {}) {
  return withPanelLock(guild.id, async () => {
    const settings = settingsManager.getGuildSettings(guild.id);
    const channelId = settingsManager.resolveId(settings, 'rolePanelChannelId');
    if (!channelId) return { status: 'no-channel' };
    const channel = guild.channels.cache.get(channelId);
    if (!channel?.isTextBased()) return { status: 'missing-channel' };

    // 지정 채널에서 아직 남아 있는 첫 패널을 갱신 대상으로, 나머지는 정리 대상으로
    let target = null;
    let meta = {};
    const stale = [];
    for (const panel of getReactionRolePanels(guild.id)) {
      if (!target && panel.channelId === channelId) {
        const message = await channel.messages.fetch(panel.messageId).catch(() => null);
        if (message) {
          target = message;
          meta = panel;
          continue;
        }
      }
      stale.push(panel);
    }

    const title = overrides.title !== undefined ? overrides.title : meta.title ?? null;
    const description = overrides.description !== undefined ? overrides.description : meta.description ?? null;
    const embed = buildReactionRolePanelEmbed(guild, { title, description });

    let status;
    if (target) {
      await target.edit({ embeds: [embed] });
      status = 'updated';
    } else {
      target = await channel.send({ embeds: [embed] });
      status = 'created';
    }

    // 목록을 먼저 저장해 두어, 이후 작업 중 오류가 나도 새 패널을 잃지 않게 함
    settingsManager.updateGuildSettings(guild.id, {
      reactionRolePanels: [{ messageId: target.id, channelId, title, description }],
    });

    await removeStalePanelReactions(target);
    const reactResult = await ensurePanelReactions(target);

    let removed = 0;
    for (const panel of stale) {
      if (await deletePanelMessage(guild, panel)) removed++;
    }
    return { status, message: target, removed, reactResult };
  });
}

/**
 * 게시된 역할 패널을 모두 삭제하고 목록 비우기 (/연결 채널 해제 역할패널)
 * @returns {Promise<number>} 삭제한 패널 메시지 수
 */
export function removeReactionRolePanels(guild) {
  return withPanelLock(guild.id, async () => {
    let removed = 0;
    for (const panel of getReactionRolePanels(guild.id)) {
      if (await deletePanelMessage(guild, panel)) removed++;
    }
    settingsManager.updateGuildSettings(guild.id, { reactionRolePanels: [] });
    return removed;
  });
}

/**
 * syncReactionRolePanel 결과를 사람이 읽을 안내 한 줄로
 */
export function describePanelSync(result) {
  switch (result.status) {
    case 'no-channel':
      return '⚠️ 패널 채널이 연결되지 않았습니다. `/연결 채널 역할패널 <채널>` 로 지정하면 패널이 게시됩니다.';
    case 'missing-channel':
      return '⚠️ 연결된 패널 채널을 찾을 수 없습니다. `/연결 채널 역할패널 <채널>` 로 다시 지정해 주세요.';
    default: {
      let text = `${result.status === 'created' ? '🆕 역할 패널을 게시했습니다' : '🔄 역할 패널을 갱신했습니다'}: ${result.message.url}`;
      if (result.removed) text += `\n🧹 이전 패널 ${result.removed}개를 정리했습니다.`;
      if (result.reactResult?.failed.length) text += `\n⚠️ 추가하지 못한 이모지: ${result.reactResult.failed.join(' ')}`;
      return text;
    }
  }
}

/**
 * 리액션 추가/제거 이벤트 처리 → 역할 부여/해제
 * @param {import('discord.js').MessageReaction} reaction
 * @param {import('discord.js').User} user
 * @param {'add'|'remove'} action
 */
export async function handleReactionRole(reaction, user, action) {
  if (user.bot) return;

  // 캐시되지 않은 메시지/리액션은 fetch
  if (reaction.partial) {
    try {
      await reaction.fetch();
    } catch (error) {
      console.error('[ReactionRole] 리액션 fetch 실패:', error.message);
      return;
    }
  }
  const message = reaction.message;
  if (message.partial) {
    try {
      await message.fetch();
    } catch (error) {
      console.error('[ReactionRole] 메시지 fetch 실패:', error.message);
      return;
    }
  }

  const guild = message.guild;
  if (!guild) return;

  // 등록된 패널 메시지가 아니면 무시
  const panels = getReactionRolePanels(guild.id);
  if (!panels.some(p => p.messageId === message.id)) return;

  const key = reactionEmojiKey(reaction.emoji);
  const mapping = getReactionRoles(guild.id).find(m => m.emojiKey === key);

  if (!mapping) {
    // 패널에 등록되지 않은 이모지 반응은 정리 (패널을 깔끔하게 유지)
    if (action === 'add') {
      await reaction.users.remove(user.id).catch(() => {});
    }
    return;
  }

  const role = guild.roles.cache.get(mapping.roleId);
  if (!role) {
    console.warn(`[ReactionRole] 역할(${mapping.roleId})이 삭제되어 처리할 수 없습니다.`);
    return;
  }

  const check = checkBotCanManageRole(guild, role);
  if (!check.ok) {
    console.warn(`[ReactionRole] ${role.name} 역할 처리 불가: ${check.reason.replace(/\n/g, ' ')}`);
    return;
  }

  const member = await guild.members.fetch(user.id).catch(() => null);
  if (!member) return;

  try {
    if (action === 'add' && !member.roles.cache.has(role.id)) {
      await member.roles.add(role, '이모지 반응 역할 부여');
      console.log(`[ReactionRole] ${member.user.tag} → ${role.name} 부여`);
    } else if (action === 'remove' && member.roles.cache.has(role.id)) {
      await member.roles.remove(role, '이모지 반응 역할 해제');
      console.log(`[ReactionRole] ${member.user.tag} → ${role.name} 해제`);
    }
  } catch (error) {
    console.error(`[ReactionRole] ${member.user.tag} 역할 ${action === 'add' ? '부여' : '해제'} 실패:`, error.message);
  }
}
