import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, EmbedBuilder } from 'discord.js';
import { pointsManager } from '../../stores/pointsManager.js';
import { lockPlayers, releasePlayers } from './sessions.js';

/** 낼 수 있는 손 */
export const HANDS = Object.freeze({
  rock: { emoji: '✊', name: '바위', beats: 'scissors' },
  scissors: { emoji: '✌️', name: '가위', beats: 'paper' },
  paper: { emoji: '✋', name: '보', beats: 'rock' },
});

/** 손을 고를 수 있는 시간 */
export const PICK_TIMEOUT_MS = 30 * 1000;
/** 대결 신청을 수락할 수 있는 시간 */
export const ACCEPT_TIMEOUT_MS = 60 * 1000;

const COLOR = { playing: 0x5865F2, win: 0x57F287, lose: 0xED4245, draw: 0xFEE75C, cancel: 0x99AAB5 };

const p = n => `${n.toLocaleString()}P`;
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

/** 버튼을 누른 사람이 이 게임 참가자가 아니면 본인에게만 안내 */
function rejectOthers(i) {
  return i.reply({ content: '🙅 이 게임의 참가자만 누를 수 있습니다.', ephemeral: true }).catch(() => {});
}

/**
 * 1인용: 봇과 가위바위보 — 이기면 베팅만큼 얻고, 지면 잃고, 비기면 그대로
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {number} bet
 */
export async function playSolo(interaction, bet) {
  const { guild, user } = interaction;
  if (lockPlayers(guild.id, [user.id])) {
    return interaction.reply({ content: '⏳ 이미 진행 중인 게임이 있습니다. 끝난 뒤 다시 시도해 주세요.', ephemeral: true });
  }

  const prefix = `rps:${interaction.id}`;
  const embed = new EmbedBuilder()
    .setColor(COLOR.playing)
    .setTitle('✊✌️✋ 가위바위보 vs 연두봇')
    .setDescription(`${user} 님, 낼 손을 골라 주세요! (${PICK_TIMEOUT_MS / 1000}초)\n베팅 **${p(bet)}** · 이기면 +${p(bet)}, 지면 -${p(bet)}, 비기면 그대로`);
  await interaction.reply({ embeds: [embed], components: [handButtons(prefix)] });
  const message = await interaction.fetchReply();

  const collector = message.createMessageComponentCollector({ componentType: ComponentType.Button, time: PICK_TIMEOUT_MS });
  collector.on('collect', async i => {
    if (i.user.id !== user.id) return rejectOthers(i);
    collector.stop('picked');

    const mine = i.customId.split(':').pop();
    const botHand = randomHand();
    const result = judge(mine, botHand);
    const outcome = result > 0 ? 'win' : result < 0 ? 'lose' : 'draw';
    const delta = outcome === 'win' ? bet : outcome === 'lose' ? -bet : 0;
    const [{ applied, balance }] = pointsManager.applyGameResult(guild.id, [{ userId: user.id, delta, outcome }]);
    releasePlayers(guild.id, [user.id]);

    const title = { win: '🎉 승리!', lose: '😢 패배…', draw: '🤝 무승부' }[outcome];
    const change = applied > 0 ? `+${p(applied)}` : applied < 0 ? `-${p(-applied)}` : '변화 없음';
    await i.update({
      embeds: [
        new EmbedBuilder()
          .setColor(COLOR[outcome])
          .setTitle(`✊✌️✋ 가위바위보 vs 연두봇 · ${title}`)
          .setDescription(`${user} ${handText(mine)}  vs  ${handText(botHand)} 연두봇\n\n포인트 ${change} → 잔액 **${p(balance)}**`),
      ],
      components: [],
    }).catch(() => {});
  });
  collector.on('end', async (_, reason) => {
    if (reason === 'picked') return;
    releasePlayers(guild.id, [user.id]);
    await message.edit({
      embeds: [new EmbedBuilder().setColor(COLOR.cancel).setTitle('✊✌️✋ 가위바위보 vs 연두봇 · ⏰ 시간 초과').setDescription(`${user} 님이 손을 고르지 않아 게임이 취소되었습니다. (포인트 변화 없음)`)],
      components: [],
    }).catch(() => {});
  });
}

/**
 * 다인용: 다른 멤버와 가위바위보 — 같은 금액을 걸고 이긴 사람이 가져감
 * 1) 상대가 수락 → 2) 두 사람이 각자 손을 고름(서로 보이지 않음) → 3) 공개
 * - 수락 전 시간 초과/거절/신청자 취소: 포인트 변화 없음
 * - 한 사람만 손을 골랐으면 고르지 않은 사람의 기권패, 둘 다 안 골랐으면 취소
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
  const end = (color, status, extra = '') =>
    new EmbedBuilder().setColor(color).setTitle(`${title} · ${status}`).setDescription(`${header}${extra ? `\n\n${extra}` : ''}`);

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
  let collector = message.createMessageComponentCollector({ componentType: ComponentType.Button, time: ACCEPT_TIMEOUT_MS });

  const pickStatus = () =>
    players.map(id => `<@${id}> ${picks.has(id) ? '✅ 선택 완료' : '⏳ 고르는 중'}`).join('\n');

  const startPicking = async i => {
    phase = 'pick';
    await i.update({
      content: '',
      embeds: [new EmbedBuilder().setColor(COLOR.playing).setTitle(`${title} · 손을 고르세요!`).setDescription(`${header}\n\n${pickStatus()}\n\n${PICK_TIMEOUT_MS / 1000}초 안에 골라 주세요. 고른 손은 공개 전까지 서로 보이지 않습니다.`)],
      components: [handButtons(prefix)],
    });
    collector = message.createMessageComponentCollector({ componentType: ComponentType.Button, time: PICK_TIMEOUT_MS });
    collector.on('collect', onPick);
    collector.on('end', onPickEnd);
  };

  // 3) 결과 반영
  const finish = async (i, winnerId, loserId, reasonText) => {
    release();
    let extra;
    let color;
    let status;
    if (!winnerId) {
      pointsManager.applyGameResult(guild.id, players.map(userId => ({ userId, delta: 0, outcome: 'draw' })));
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
      const balanceOf = id => results.find(r => r.userId === id).balance;
      color = COLOR.win;
      // 임베드 제목에서는 멘션이 표시되지 않으므로 이름으로
      status = `🎉 ${guild.members.cache.get(winnerId)?.displayName ?? '승자'} 승리!`;
      extra =
        `${reasonText}\n<@${winnerId}> +${p(amount)} → **${p(balanceOf(winnerId))}**\n` +
        `<@${loserId}> -${p(amount)} → **${p(balanceOf(loserId))}**`;
    }
    const payload = { content: '', embeds: [end(color, status, extra)], components: [] };
    if (i) await i.update(payload).catch(() => {});
    else await message.edit(payload).catch(() => {});
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
        embeds: [new EmbedBuilder().setColor(COLOR.playing).setTitle(`${title} · 손을 고르세요!`).setDescription(`${header}\n\n${pickStatus()}`)],
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
      return message.edit({ content: '', embeds: [end(COLOR.cancel, '⏰ 시간 초과', '두 사람 모두 손을 고르지 않아 취소되었습니다. (포인트 변화 없음)')], components: [] }).catch(() => {});
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
      return i.update({ content: '', embeds: [end(COLOR.cancel, '🚫 신청 취소', '신청한 사람이 대결을 취소했습니다.')], components: [] }).catch(() => {});
    }
    if (i.user.id !== opponent.id) {
      return i.reply({ content: `🙅 ${opponent} 님만 수락하거나 거절할 수 있습니다.`, ephemeral: true }).catch(() => {});
    }
    if (action === 'decline') {
      collector.stop('decline');
      release();
      return i.update({ content: '', embeds: [end(COLOR.cancel, '🙅 거절', `${opponent} 님이 대결을 거절했습니다.`)], components: [] }).catch(() => {});
    }
    // 수락: 그 사이 잔액이 줄었는지 다시 확인
    const short = players.find(id => pointsManager.get(guild.id, id).balance < bet);
    if (short) {
      collector.stop('short');
      release();
      return i.update({ content: '', embeds: [end(COLOR.cancel, '💸 포인트 부족', `<@${short}> 님의 포인트가 베팅액보다 적어 대결이 취소되었습니다.`)], components: [] }).catch(() => {});
    }
    collector.stop('accepted');
    return startPicking(i);
  });
  collector.on('end', async (_, reason) => {
    if (phase !== 'invite' || reason !== 'time') return;
    release();
    await message.edit({ content: '', embeds: [end(COLOR.cancel, '⏰ 응답 없음', `${opponent} 님이 시간 안에 수락하지 않아 대결이 취소되었습니다.`)], components: [] }).catch(() => {});
  });
}
