import { settingsManager } from '../stores/settingsManager.js';
import { pointsManager } from '../stores/pointsManager.js';
import { checkBotCanManageRole, getDangerousPermissions } from './roleManager.js';
import { lockPlayers, releasePlayers } from './games/sessions.js';

/**
 * 포인트 상점 — 관리자가 역할을 상품으로 등록하고, 멤버가 포인트로 사거나 기간제로 빌림
 * - 상품: 서버 설정 shopItems [{ roleId, price, days(0 = 영구), description }]
 * - 산 기록: 멤버 포인트 기록 rentals { 역할 ID: 만료 시각(null = 영구) } — 만료되면 봇이 역할 회수
 */

/** 만료된 역할을 확인하는 간격 */
export const RENTAL_CHECK_INTERVAL_MS = 10 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function getShopItems(guildId) {
  return [...(settingsManager.getGuildSettings(guildId).shopItems || [])];
}

/** 상품 추가 (같은 역할이면 가격·기간·설명 갱신) */
export function upsertShopItem(guildId, item) {
  const items = getShopItems(guildId).filter(x => x.roleId !== item.roleId);
  items.push(item);
  items.sort((a, b) => a.price - b.price);
  settingsManager.updateGuildSettings(guildId, { shopItems: items });
}

/** @returns {boolean} 지웠는지 여부 */
export function removeShopItem(guildId, roleId) {
  const items = getShopItems(guildId);
  const next = items.filter(x => x.roleId !== roleId);
  if (next.length === items.length) return false;
  settingsManager.updateGuildSettings(guildId, { shopItems: next });
  return true;
}

/**
 * 상품으로 팔 수 있는 역할인지 (봇이 줄 수 있고, 위험 권한이 없는 역할)
 * @returns {string|null} 안 되는 이유 (되면 null)
 */
export function checkSellableRole(guild, role) {
  const check = checkBotCanManageRole(guild, role);
  if (!check.ok) return check.reason;
  const dangerous = getDangerousPermissions(role);
  if (dangerous.length) return `${role} 역할에는 **${dangerous.join(', ')}** 권한이 있어 상점에서 팔 수 없습니다.`;
  return null;
}

/** 상품 기간 표시 */
export const durationText = days => (days > 0 ? `${days}일` : '영구');

/**
 * 상품 구매 — 역할을 먼저 주고 성공하면 포인트 차감 (실패하면 포인트 그대로)
 * - 기간제: 이미 가지고 있으면 남은 기간에 이어서 연장
 * - 영구: 이미 가지고 있으면 구매 불가
 * - 구매하는 동안 게임·선물을 막아 같은 포인트를 두 번 쓰지 못하게 함
 * @returns {Promise<{ ok: true, item, role, balance: number, expiresAt: number|null, extended: boolean } | { ok: false, reason: string }>}
 */
export async function purchase(guild, member, roleId, now = Date.now()) {
  const item = getShopItems(guild.id).find(x => x.roleId === roleId);
  if (!item) return { ok: false, reason: '상점에 없는 상품입니다. `/게임 상점` 에서 목록을 확인해 주세요.' };
  const role = guild.roles.cache.get(roleId);
  if (!role) return { ok: false, reason: '상품 역할이 서버에서 사라졌습니다. 관리자에게 알려 주세요.' };
  const unsellable = checkSellableRole(guild, role);
  if (unsellable) return { ok: false, reason: `지금은 이 상품을 살 수 없습니다. (${unsellable})` };

  // 영구로 산 역할, 상점이 아닌 다른 경로로 받은 역할은 다시 살 수 없음
  // (기간제로 사면 만료 때 원래 있던 역할까지 회수되므로)
  const rentals = pointsManager.getRentals(guild.id, member.id);
  const bought = roleId in rentals;
  if (rentals[roleId] === null || (!bought && member.roles.cache.has(roleId))) {
    return { ok: false, reason: `이미 ${role} 역할을 가지고 있습니다.` };
  }
  if (lockPlayers(guild.id, [member.id])) {
    return { ok: false, reason: '게임 중에는 살 수 없습니다. 게임이 끝난 뒤 다시 시도해 주세요.' };
  }
  try {
    const balance = pointsManager.get(guild.id, member.id).balance;
    if (balance < item.price) {
      return { ok: false, reason: `포인트가 부족합니다. (잔액 ${balance.toLocaleString()}P, 가격 ${item.price.toLocaleString()}P)` };
    }
    await member.roles.add(role, `/게임 구매 (${item.price}P)`);
    const spent = pointsManager.spend(guild.id, member.id, item.price, now);
    if (!spent.ok) {
      await member.roles.remove(role, '/게임 구매 취소 (포인트 부족)').catch(() => {});
      return { ok: false, reason: '포인트가 부족합니다.' };
    }
    // 기간제: 남은 기간이 있으면 거기서부터 연장
    const current = rentals[roleId];
    const extended = item.days > 0 && typeof current === 'number' && current > now;
    const expiresAt = item.days > 0 ? (extended ? current : now) + item.days * DAY_MS : null;
    pointsManager.setRental(guild.id, member.id, roleId, expiresAt, now);
    return { ok: true, item, role, balance: spent.balance, expiresAt, extended };
  } catch (error) {
    console.error('[Shop] 구매 처리 오류:', error);
    return { ok: false, reason: '역할을 주는 중 오류가 발생했습니다. 봇의 역할 순서와 권한을 확인해 주세요. (포인트는 차감되지 않았습니다)' };
  } finally {
    releasePlayers(guild.id, [member.id]);
  }
}

/**
 * 기간이 끝난 상점 역할 회수 (봇 시작 시와 RENTAL_CHECK_INTERVAL_MS 마다)
 * - 서버를 떠난 멤버·사라진 역할은 기록만 지움
 * @returns {Promise<number>} 회수한 수
 */
export async function expireRentals(client, now = Date.now()) {
  let removed = 0;
  for (const { guildId, userId, roleId } of pointsManager.expiredRentals(now)) {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) continue; // 봇이 없는 서버는 나중에 다시 확인
    const member = await guild.members.fetch(userId).catch(() => null);
    if (member?.roles.cache.has(roleId)) {
      const ok = await member.roles.remove(roleId, '상점 역할 기간 만료').then(() => true).catch(error => {
        console.warn(`[Shop] ${guild.name}: ${member.user.tag} 의 만료 역할 회수 실패:`, error.message);
        return false;
      });
      if (!ok) continue; // 권한 문제 등은 다음에 다시 시도
      removed++;
    }
    pointsManager.removeRental(guildId, userId, roleId);
  }
  if (removed) console.log(`[Shop] 기간이 끝난 상점 역할 ${removed}개 회수`);
  return removed;
}
