import { PermissionFlagsBits } from 'discord.js';

/**
 * 초대 추적 — 디스코드는 입장 이벤트에 어떤 초대 링크를 썼는지 알려 주지 않으므로,
 * 서버별 초대 링크 사용 횟수를 기억해 두었다가 입장 직후 다시 조회해 사용 횟수가 늘어난 링크를 찾는다.
 * - 초대 링크 조회에는 봇의 "서버 관리" 권한이 필요 (없으면 초대자 표시를 생략)
 * - 1회용 등 최대 사용 횟수에 도달한 링크는 사용 즉시 삭제되므로, 사라진 링크 중 마지막 1회가 남아 있던 것을 찾는다.
 */

/** 서버 ID → { invites: Map<code, { uses, maxUses, inviterId }>, vanityCode, vanityUses } */
const snapshots = new Map();
/** 서버별 비교 순서 보장 (동시에 여러 명이 들어와도 비교가 섞이지 않게) */
const queues = new Map();
/** 권한 부족 경고를 서버마다 한 번만 출력 */
const warnedGuilds = new Set();

/** 초대 링크를 조회할 수 있는지 (봇의 서버 관리 권한) */
function canTrack(guild) {
  const ok = guild.members.me?.permissions.has(PermissionFlagsBits.ManageGuild) ?? false;
  if (!ok && !warnedGuilds.has(guild.id)) {
    warnedGuilds.add(guild.id);
    console.warn(`[Invite] ⚠️ ${guild.name}: 봇에 '서버 관리' 권한이 없어 입장 알림에 초대자를 표시하지 않습니다.`);
  }
  if (ok) warnedGuilds.delete(guild.id);
  return ok;
}

function toEntry(invite) {
  return { uses: invite.uses ?? 0, maxUses: invite.maxUses ?? 0, inviterId: invite.inviterId ?? invite.inviter?.id ?? null };
}

/** 서버의 현재 초대 링크 사용 횟수 조회 */
async function takeSnapshot(guild) {
  const invites = await guild.invites.fetch({ cache: false });
  const map = new Map([...invites.values()].map(invite => [invite.code, toEntry(invite)]));
  const vanityCode = guild.vanityURLCode ?? null;
  const vanityUses = vanityCode ? await guild.fetchVanityData().then(v => v.uses ?? null).catch(() => null) : null;
  return { invites: map, vanityCode, vanityUses };
}

/**
 * 서버의 초대 링크 사용 횟수를 기억 (봇 시작 시)
 * @returns {Promise<boolean>} 기억했는지 여부 (권한 없음·오류면 false)
 */
export async function cacheGuildInvites(guild) {
  if (!canTrack(guild)) {
    snapshots.delete(guild.id);
    return false;
  }
  try {
    snapshots.set(guild.id, await takeSnapshot(guild));
    return true;
  } catch (error) {
    console.warn(`[Invite] ${guild.name}: 초대 링크 조회 실패:`, error.message);
    snapshots.delete(guild.id);
    return false;
  }
}

/** 초대 링크가 새로 만들어지면 기억 (삭제 이벤트는 무시 — 1회용 링크 판별에 사용 직전 기록이 필요) */
export function rememberInvite(invite) {
  const snapshot = invite.guild && snapshots.get(invite.guild.id);
  if (snapshot) snapshot.invites.set(invite.code, toEntry(invite));
}

/**
 * 방금 입장한 멤버가 사용한 초대 링크 찾기
 * @param {import('discord.js').GuildMember} member
 * @returns {Promise<
 *   { type: 'invite', code: string, inviterId: string|null, uses: number }
 *   | { type: 'vanity', code: string }
 *   | { type: 'bot' }
 *   | { type: 'unknown' }
 *   | null
 * >} null 이면 추적 불가(권한 없음, 이전 기록 없음) → 표시 생략
 */
export function findUsedInvite(member) {
  const guild = member.guild;
  const run = (queues.get(guild.id) ?? Promise.resolve()).then(async () => {
    // 봇은 OAuth 로 추가되어 초대 링크를 쓰지 않음
    if (member.user.bot) return { type: 'bot' };

    const before = snapshots.get(guild.id);
    if (!before || !canTrack(guild)) {
      // 비교할 이전 기록이 없으면 이번에는 기억만 하고 다음 입장부터 확인
      await cacheGuildInvites(guild);
      return null;
    }

    let after;
    try {
      after = await takeSnapshot(guild);
    } catch (error) {
      console.warn(`[Invite] ${guild.name}: 초대 링크 조회 실패:`, error.message);
      return { type: 'unknown' };
    }
    snapshots.set(guild.id, after);

    // 1. 사용 횟수가 늘어난 링크 (기억하기 전에 만들어진 링크는 0회에서 늘어난 것으로 봄)
    const increased = [...after.invites].filter(([code, entry]) => entry.uses > (before.invites.get(code)?.uses ?? 0));
    if (increased.length === 1) {
      const [code, entry] = increased[0];
      return { type: 'invite', code, inviterId: entry.inviterId, uses: entry.uses };
    }
    if (increased.length > 1) return { type: 'unknown' }; // 동시에 여러 명이 다른 링크로 입장

    // 2. 사라진 링크 중 마지막 1회가 남아 있던 것 (최대 사용 횟수에 도달해 삭제됨)
    const exhausted = [...before.invites].filter(
      ([code, entry]) => !after.invites.has(code) && entry.maxUses > 0 && entry.uses + 1 >= entry.maxUses
    );
    if (exhausted.length === 1) {
      const [code, entry] = exhausted[0];
      return { type: 'invite', code, inviterId: entry.inviterId, uses: entry.uses + 1 };
    }

    // 3. 서버 고유 주소 (discord.gg/<서버 주소>)
    if (after.vanityUses !== null && before.vanityUses !== null && after.vanityUses > before.vanityUses) {
      return { type: 'vanity', code: after.vanityCode };
    }

    // 서버 찾기(Discovery) 등 초대 링크 없이 들어온 경우
    return { type: 'unknown' };
  });
  queues.set(guild.id, run.catch(() => {}));
  return run;
}
