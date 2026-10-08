/**
 * 진행 중인 게임 참가자 (서버별)
 * - 한 사람이 동시에 여러 게임에 같은 포인트를 걸지 못하도록 게임마다 참가자를 잠근다.
 * - 메모리에만 두므로 봇이 재시작하면 진행 중이던 게임은 결과 없이 사라진다 (포인트는 결과가 나올 때만 바뀜).
 */
const busy = new Map();

const key = (guildId, userId) => `${guildId}:${userId}`;

/**
 * 참가자 모두를 잠금 (한 명이라도 이미 게임 중이면 아무도 잠그지 않음)
 * @returns {string|null} 이미 게임 중인 유저 ID (모두 잠갔으면 null)
 */
export function lockPlayers(guildId, userIds) {
  const playing = userIds.find(userId => busy.has(key(guildId, userId)));
  if (playing) return playing;
  for (const userId of userIds) busy.set(key(guildId, userId), Date.now());
  return null;
}

export function releasePlayers(guildId, userIds) {
  for (const userId of userIds) busy.delete(key(guildId, userId));
}
