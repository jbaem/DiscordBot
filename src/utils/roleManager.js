import { PermissionFlagsBits, EmbedBuilder, parseEmoji } from 'discord.js';
import { config } from '../config.js';
import { settingsManager } from './settingsManager.js';

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

/** 역할이 가진 위험 권한 이름 목록 (없으면 빈 배열) */
export function getDangerousPermissions(role) {
  return DANGEROUS_PERMISSIONS.filter(([flag]) => role.permissions.has(flag)).map(([, label]) => label);
}

// ─────────────────────────────────────────────────────────────
// 자동 역할 (신규 멤버 입장 시)
// ─────────────────────────────────────────────────────────────

/**
 * 서버의 자동 역할 ID 결정
 * - /autorole 로 설정한 값이 있으면 그 값 (null 이면 비활성화)
 * - 슬래시 설정 이력이 없는 서버는 .env 의 AUTO_ROLE_ID 폴백
 */
export function resolveAutoRoleId(guildId) {
  const settings = settingsManager.getGuildSettings(guildId);
  if (settings.autoRoleId === undefined) return config.autoRoleId || null;
  return settings.autoRoleId || null;
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
    .setFooter({ text: '반응 역할 패널 · 관리자는 /이모지역할 명령어로 관리할 수 있습니다.' });
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
