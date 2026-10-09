import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, EmbedBuilder } from 'discord.js';
import { pointsManager } from '../../stores/pointsManager.js';
import { lockPlayers, releasePlayers } from './sessions.js';
import { PICK_TIMEOUT_MS, AGAIN_TIMEOUT_MS, COLOR, p, signed, againButtons, oneLine, rejectOthers } from './common.js';
import { playSoloGame } from './soloSession.js';

export { PICK_TIMEOUT_MS, AGAIN_TIMEOUT_MS };

/** 낼 수 있는 손 */
export const HANDS = Object.freeze({
  rock: { emoji: '✊', name: '바위', beats: 'scissors' },
  scissors: { emoji: '✌️', name: '가위', beats: 'paper' },
  paper: { emoji: '✋', name: '보', beats: 'rock' },
});

/**
 * 봇과의 1인용 연승 보너스 — 연승 수 → 이번 판 베팅액에 곱할 비율
 * (고정 금액이면 1P 베팅으로 보너스만 노릴 수 있어 베팅액에 비례)
 * 10연승 이후에는 5연승마다(15, 20, …) 마지막 비율로 지급
 */
export const STREAK_BONUS_RATES = Object.freeze({ 3: 0.5, 5: 1, 7: 1.5, 10: 3 });

/** 연승 수 → 보너스 비율 (없으면 0) */
export function streakBonusRate(streak) {
  if (STREAK_BONUS_RATES[streak]) return STREAK_BONUS_RATES[streak];
  const last = Math.max(...Object.keys(STREAK_BONUS_RATES).map(Number));
  return streak > last && streak % 5 === 0 ? STREAK_BONUS_RATES[last] : 0;
}

/** 대결 신청을 수락할 수 있는 시간 */
export const ACCEPT_TIMEOUT_MS = 60 * 1000;

const handText = hand => `${HANDS[hand].emoji} ${HANDS[hand].name}`;

/** 승패 판정: 1 = a 승, -1 = b 승, 0 = 무승부 */
export function judge(a, b) {
  if (a === b) return 0;
  return HANDS[a].beats === b ? 1 : -1;
}

function randomHand() {
  const hands = Object.keys(HANDS);
  return hands[Math.floor(Math.random() * hands.length)];
}

function handButtons(prefix) {
  return new ActionRowBuilder().addComponents(
    Object.entries(HANDS).map(([hand, h]) =>
      new ButtonBuilder().setCustomId(`${prefix}:${hand}`).setLabel(h.name).setEmoji(h.emoji).setStyle(ButtonStyle.Secondary)
    )
  );
}

/** 서버 표시 이름 (한 줄 요약·임베드 꼬리말은 멘션 대신 이름) */
const displayName = (guild, id, fallback = '참가자') => guild.members.cache.get(id)?.displayName ?? fallback;
const nameOf = i => i.member?.displayName ?? i.user.username;

// ─────────────────────────────────────────────────────────────
// 1인용 (봇 상대) — 진행 방식은 soloSession.js (본인에게만, 🔁/🛑, 끝나면 한 줄 요약)
// ─────────────────────────────────────────────────────────────

/** 봇과의 가위바위보 — 이기면 +베팅, 지면 -베팅, 비기면 그대로, 연승 보너스 */
export const RPS_SOLO = Object.freeze({
  key: 'rps',
  name: '가위바위보 vs 연두봇',
  title: '✊✌️✋ 가위바위보 vs 연두봇',
  prompt: '낼 손을 골라 주세요!',
  rules: bet => `이기면 +${p(bet)}, 지면 -${p(bet)}, 비기면 그대로 (연승 보너스 있음)`,
  choices: Object.entries(HANDS).map(([id, h]) => ({ id, label: h.name, emoji: h.emoji })),
  play(mine, bet) {
    const botHand = randomHand();
    const result = judge(mine, botHand);
    return { delta: result * bet, detail: `${handText(mine)}  vs  ${handText(botHand)} 연두봇` };
  },
  streakBonusRate,
});

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {number} bet
 */
export function playSolo(interaction, bet) {
  return playSoloGame(interaction, RPS_SOLO, bet);
}

// ─────────────────────────────────────────────────────────────
// 다인용 (멤버 대결) — 두 사람이 함께 봐야 하므로 공개, 끝나면 한 줄 요약
// ─────────────────────────────────────────────────────────────

/**
 * 다인용: 다른 멤버와 가위바위보 — 같은 금액을 걸고 이긴 사람이 가져감
 * 1) 상대가 수락 → 2) 두 사람이 각자 손을 고름(서로 보이지 않음) → 3) 공개
 * - 수락 전 시간 초과/거절/신청자 취소: 포인트 변화 없음
 * - 한 사람만 손을 골랐으면 고르지 않은 사람의 기권패, 둘 다 안 골랐으면 취소
 * - 결과 뒤 🔁 재대결(두 사람 모두 눌러야 같은 베팅으로 다시) / 🛑 그만하기(한 사람만 눌러도 끝)
 * - 대결이 끝나면 큰 임베드를 한 줄 요약으로 바꿔 채널에 남는 양을 줄임
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {import('discord.js').User} opponent
 * @param {number} bet
 */
export async function playDuel(interaction, opponent, bet) {
  const { guild, user } = interaction;
  const players = [user.id, opponent.id];
  const playing = lockPlayers(guild.id, players);
  if (playing) {
    const who = playing === user.id ? '이미 진행 중인 게임이 있습니다.' : `${opponent} 님이 다른 게임을 하고 있습니다.`;
    return interaction.reply({ content: `⏳ ${who} 끝난 뒤 다시 시도해 주세요.`, ephemeral: true });
  }
  const release = () => releasePlayers(guild.id, players);

  const prefix = `rps:${interaction.id}`;
  const title = '✊✌️✋ 가위바위보 대결';
  const header = `${user}  vs  ${opponent} · 베팅 **${p(bet)}** (이긴 사람이 상대의 ${p(bet)}을 가져감)`;
  const names = {
    [user.id]: interaction.member?.displayName ?? displayName(guild, user.id, user.username),
    [opponent.id]: displayName(guild, opponent.id, opponent.username),
  };
  const end = (color, status, extra = '') =>
    new EmbedBuilder().setColor(color).setTitle(`${title} · ${status}`).setDescription(`${header}${extra ? `\n\n${extra}` : ''}`);

  // 대결 전체 기록 (한 줄 요약용)
  const stats = { rounds: 0, draws: 0, wins: { [user.id]: 0, [opponent.id]: 0 }, net: { [user.id]: 0, [opponent.id]: 0 } };
  const summary = reason => {
    const [a, b] = players;
    if (stats.rounds === 0) return `⚔️ 가위바위보 대결 · ${names[a]} vs ${names[b]} · ${reason} (포인트 변화 없음)`;
    return (
      `⚔️ 가위바위보 대결 · ${names[a]} vs ${names[b]} · ${stats.rounds}판 ` +
      `(${names[a]} ${stats.wins[a]}승 · ${names[b]} ${stats.wins[b]}승${stats.draws ? ` · 무 ${stats.draws}` : ''}) · ` +
      `${names[a]} ${signed(stats.net[a])} / ${names[b]} ${signed(stats.net[b])} · ${reason}`
    );
  };

  // 1) 대결 신청
  const acceptRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${prefix}:accept`).setLabel('수락').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`${prefix}:decline`).setLabel('거절').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`${prefix}:cancel`).setLabel('신청 취소').setStyle(ButtonStyle.Secondary)
  );
  await interaction.reply({
    content: `${opponent}`,
    embeds: [new EmbedBuilder().setColor(COLOR.playing).setTitle(`${title} 신청`).setDescription(`${header}\n\n${opponent} 님, ${ACCEPT_TIMEOUT_MS / 1000}초 안에 수락해 주세요!`)],
    components: [acceptRow],
    allowedMentions: { users: [opponent.id] },
  });
  const message = await interaction.fetchReply();

  const picks = new Map();
  let phase = 'invite';
  let round = 1;
  let collector = message.createMessageComponentCollector({ componentType: ComponentType.Button, time: ACCEPT_TIMEOUT_MS });

  const pickStatus = () =>
    players.map(id => `<@${id}> ${picks.has(id) ? '✅ 선택 완료' : '⏳ 고르는 중'}`).join('\n');
  const pickTitle = () => `${title}${round > 1 ? ` · ${round}판째` : ''} · 손을 고르세요!`;

  const startPicking = async i => {
    phase = 'pick';
    picks.clear();
    await i.update({
      content: '',
      embeds: [new EmbedBuilder().setColor(COLOR.playing).setTitle(pickTitle()).setDescription(`${header}\n\n${pickStatus()}\n\n${PICK_TIMEOUT_MS / 1000}초 안에 골라 주세요. 고른 손은 공개 전까지 서로 보이지 않습니다.`)],
      components: [handButtons(prefix)],
    });
    collector = message.createMessageComponentCollector({ componentType: ComponentType.Button, time: PICK_TIMEOUT_MS });
    collector.on('collect', onPick);
    collector.on('end', onPickEnd);
  };

  // 3) 결과 반영
  const finish = async (i, winnerId, loserId, reasonText) => {
    release();
    stats.rounds += 1;
    let extra;
    let color;
    let status;
    if (!winnerId) {
      pointsManager.applyGameResult(guild.id, players.map(userId => ({ userId, delta: 0, outcome: 'draw' })));
      stats.draws += 1;
      color = COLOR.draw;
      status = '🤝 무승부';
      extra = `${reasonText}\n포인트 변화 없음`;
    } else {
      // 진 사람이 실제로 낸 만큼만 이긴 사람이 받음 (그 사이 잔액이 줄었을 수 있음)
      const loserBalance = pointsManager.get(guild.id, loserId).balance;
      const amount = Math.min(bet, loserBalance);
      const results = pointsManager.applyGameResult(guild.id, [
        { userId: winnerId, delta: amount, outcome: 'win' },
        { userId: loserId, delta: -amount, outcome: 'lose' },
      ]);
      stats.wins[winnerId] += 1;
      stats.net[winnerId] += amount;
      stats.net[loserId] -= amount;
      const balanceOf = id => results.find(r => r.userId === id).balance;
      color = COLOR.win;
      // 임베드 제목에서는 멘션이 표시되지 않으므로 이름으로
      status = `🎉 ${names[winnerId]} 승리!`;
      extra =
        `${reasonText}\n<@${winnerId}> +${p(amount)} → **${p(balanceOf(winnerId))}**\n` +
        `<@${loserId}> -${p(amount)} → **${p(balanceOf(loserId))}**`;
    }
    const embed = end(color, `${round > 1 ? `${round}판째 · ` : ''}${status}`, extra).setFooter({
      text: `🔁 두 사람 모두 누르면 같은 베팅으로 재대결 / 🛑 그만하기 (${AGAIN_TIMEOUT_MS / 1000}초)`,
    });
    const payload = { content: '', embeds: [embed], components: [againButtons(prefix, `재대결 (${p(bet)})`)] };
    if (i) await i.update(payload).catch(() => {});
    else await message.edit(payload).catch(() => {});
    askRematch(embed);
  };

  // 4) 재대결: 두 사람 모두 🔁 → 같은 베팅으로 다시, 한 사람이라도 🛑 → 한 줄 요약으로 끝
  const askRematch = embed => {
    const wants = new Set();
    const again = message.createMessageComponentCollector({ componentType: ComponentType.Button, time: AGAIN_TIMEOUT_MS });
    const close = (i, reason) => {
      again.stop('closed');
      return i.update(oneLine(summary(reason))).catch(() => {});
    };
    again.on('collect', async i => {
      if (!players.includes(i.user.id)) return rejectOthers(i);
      if (i.customId.endsWith(':stop')) return close(i, `🛑 ${nameOf(i)} 님이 그만하기`);

      wants.add(i.user.id);
      if (wants.size < players.length) {
        return i
          .update({ embeds: [embed.setFooter({ text: `🔁 ${nameOf(i)} 님이 재대결을 원합니다. 상대도 🔁 를 누르면 시작합니다. (🛑 그만하기)` })] })
          .catch(() => {});
      }
      const short = players.find(id => pointsManager.get(guild.id, id).balance < bet);
      if (short) return close(i, `💸 ${names[short]} 님의 포인트가 부족해 재대결 불가`);
      if (lockPlayers(guild.id, players)) return close(i, '⏳ 다른 게임 중인 사람이 있어 재대결 불가');
      again.stop('again');
      round += 1;
      return startPicking(i);
    });
    again.on('end', async (_, reason) => {
      if (reason !== 'time') return;
      await message.edit(oneLine(summary('⏰ 시간이 지나 끝남'))).catch(() => {});
    });
  };

  // 2) 손 고르기
  const onPick = async i => {
    if (!players.includes(i.user.id)) return rejectOthers(i);
    if (picks.has(i.user.id)) {
      return i.reply({ content: `이미 ${handText(picks.get(i.user.id))} 을(를) 냈습니다.`, ephemeral: true }).catch(() => {});
    }
    const hand = i.customId.split(':').pop();
    picks.set(i.user.id, hand);

    if (picks.size < players.length) {
      // 고른 사람에게만 확인, 공개 메시지에는 선택 여부만 표시
      await i.reply({ content: `${handText(hand)} 을(를) 냈습니다. 상대를 기다리는 중…`, ephemeral: true }).catch(() => {});
      await message.edit({
        embeds: [new EmbedBuilder().setColor(COLOR.playing).setTitle(pickTitle()).setDescription(`${header}\n\n${pickStatus()}`)],
      }).catch(() => {});
      return;
    }

    collector.stop('done');
    const [a, b] = players;
    const result = judge(picks.get(a), picks.get(b));
    const reveal = `<@${a}> ${handText(picks.get(a))}  vs  ${handText(picks.get(b))} <@${b}>`;
    if (result === 0) return finish(i, null, null, reveal);
    return result > 0 ? finish(i, a, b, reveal) : finish(i, b, a, reveal);
  };

  const onPickEnd = async (_, reason) => {
    if (reason === 'done') return;
    if (picks.size === 0) {
      release();
      return message.edit(oneLine(summary('⏰ 두 사람 모두 손을 고르지 않아 끝남'))).catch(() => {});
    }
    // 한 사람만 골랐으면 고르지 않은 사람의 기권패
    const winnerId = [...picks.keys()][0];
    const loserId = players.find(id => id !== winnerId);
    return finish(null, winnerId, loserId, `<@${loserId}> 님이 시간 안에 고르지 않아 기권패`);
  };

  collector.on('collect', async i => {
    if (phase !== 'invite') return;
    const action = i.customId.split(':').pop();
    if (action === 'cancel') {
      if (i.user.id !== user.id) return i.reply({ content: '🙅 신청한 사람만 취소할 수 있습니다.', ephemeral: true }).catch(() => {});
      collector.stop('cancel');
      release();
      return i.update(oneLine(summary(`🚫 ${names[user.id]} 님이 신청 취소`))).catch(() => {});
    }
    if (i.user.id !== opponent.id) {
      return i.reply({ content: `🙅 ${opponent} 님만 수락하거나 거절할 수 있습니다.`, ephemeral: true }).catch(() => {});
    }
    if (action === 'decline') {
      collector.stop('decline');
      release();
      return i.update(oneLine(summary(`🙅 ${names[opponent.id]} 님이 거절`))).catch(() => {});
    }
    // 수락: 그 사이 잔액이 줄었는지 다시 확인
    const short = players.find(id => pointsManager.get(guild.id, id).balance < bet);
    if (short) {
      collector.stop('short');
      release();
      return i.update(oneLine(summary(`💸 ${names[short]} 님의 포인트가 부족해 취소`))).catch(() => {});
    }
    collector.stop('accepted');
    return startPicking(i);
  });
  collector.on('end', async (_, reason) => {
    if (phase !== 'invite' || reason !== 'time') return;
    release();
    await message.edit(oneLine(summary(`⏰ ${names[opponent.id]} 님이 응답하지 않아 취소`))).catch(() => {});
  });
}
