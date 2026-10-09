import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, EmbedBuilder } from 'discord.js';
import { pointsManager } from '../../stores/pointsManager.js';
import { lockPlayers, releasePlayers } from './sessions.js';
import { PICK_TIMEOUT_MS, AGAIN_TIMEOUT_MS, COLOR, p, signed, againButtons, oneLine, rejectOthers } from './common.js';

/**
 * 봇 상대 1인용 게임 진행 엔진 (가위바위보·홀짝·주사위·슬롯 공용)
 * - 진행은 하는 사람에게만 보이는 메시지로, 끝나면 채널에 결과 한 줄만 공개
 * - 버튼 고르기 → 결과 → 🔁 한 판 더(같은 베팅) / 🛑 그만하기
 * - 한 판이 진행되는 동안 참가자를 잠가 같은 포인트로 다른 게임·선물·구매를 못 하게 함
 *
 * @typedef {object} SoloGame
 * @property {string} key      버튼 ID 접두어 (예: 'rps')
 * @property {string} name     한 줄 요약에 쓰는 이름 (예: '가위바위보 vs 연두봇')
 * @property {string} title    화면 제목 (예: '✊✌️✋ 가위바위보 vs 연두봇')
 * @property {string} prompt   고르기 안내 (예: '낼 손을 골라 주세요!')
 * @property {(bet: number) => string} rules  베팅·배당 안내
 * @property {Array<{ id: string, label: string, emoji: string }>} choices  고르는 버튼 (굴리기 버튼 하나여도 됨)
 * @property {(choiceId: string, bet: number) => { delta: number, detail: string }} play
 *   한 판 결과 — delta: 포인트 변화 (양수 승리, 음수 패배, 0 무승부), detail: 결과 화면 설명
 * @property {(streak: number) => number} [streakBonusRate]  연승 보너스 비율 (있으면 연승 기록·보너스 지급)
 */

const OUTCOME_TITLE = { win: '🎉 승리!', lose: '😢 패배…', draw: '🤝 무승부' };

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {SoloGame} game
 * @param {number} bet
 */
export async function playSoloGame(interaction, game, bet) {
  const { guild, user } = interaction;
  if (lockPlayers(guild.id, [user.id])) {
    return interaction.reply({ content: '⏳ 이미 진행 중인 게임이 있습니다. 끝난 뒤 다시 시도해 주세요.', ephemeral: true });
  }
  const ctx = {
    game, guild, user, bet, prefix: `${game.key}:${interaction.id}`, round: 1,
    channel: interaction.channel,
    name: interaction.member?.displayName ?? user.username,
    stats: { wins: 0, losses: 0, draws: 0, net: 0, bonus: 0, bestStreak: 0 },
    // 나만 보이는 메시지는 채널에서 직접 수정할 수 없어 가장 최근 상호작용으로 수정 (토큰 15분 유효)
    last: interaction,
  };
  await interaction.reply({ ...pickPayload(ctx), ephemeral: true });
  const message = await interaction.fetchReply();
  runRound(message, ctx);
}

const roundTag = ctx => (ctx.round > 1 ? ` · ${ctx.round}판째` : '');

/** 고르기 화면 */
function pickPayload(ctx) {
  const { game, user, bet, prefix } = ctx;
  const embed = new EmbedBuilder()
    .setColor(COLOR.playing)
    .setTitle(`${game.title}${roundTag(ctx)}`)
    .setDescription(`${user} 님, ${game.prompt} (${PICK_TIMEOUT_MS / 1000}초)\n베팅 **${p(bet)}** · ${game.rules(bet)}`);
  const row = new ActionRowBuilder().addComponents(
    game.choices.map(c => new ButtonBuilder().setCustomId(`${prefix}:${c.id}`).setLabel(c.label).setEmoji(c.emoji).setStyle(ButtonStyle.Secondary))
  );
  return { content: '', embeds: [embed], components: [row] };
}

const playedRounds = stats => stats.wins + stats.losses + stats.draws;

/** 판 수·승패·포인트 변화 한 줄 */
function resultText({ stats }) {
  return (
    `${playedRounds(stats)}판 ${stats.wins}승 ${stats.losses}패 ${stats.draws}무 · ` +
    `${signed(stats.net)}${stats.bonus ? ` (연승 보너스 +${p(stats.bonus)} 포함)` : ''}` +
    `${stats.bestStreak >= 2 ? ` · 🔥 최고 ${stats.bestStreak}연승` : ''}`
  );
}

/**
 * 끝: 본인 메시지는 한 줄 요약(잔액 포함)으로, 채널에는 결과 한 줄 공개 (한 판도 안 했으면 공개 안 함)
 * @param {import('discord.js').ButtonInteraction} [i] 그만하기를 누른 상호작용 (시간 초과면 없음)
 */
async function endSession(ctx, reason, i) {
  const { game, guild, user, stats } = ctx;
  const played = playedRounds(stats);
  const mine =
    played === 0
      ? `🎮 ${game.name} · ${reason} (포인트 변화 없음)`
      : `🎮 ${game.name} · ${resultText(ctx)} · 잔액 ${p(pointsManager.get(guild.id, user.id).balance)} · ${reason}`;
  if (i) await i.update(oneLine(mine)).catch(() => {});
  else await ctx.last.editReply(oneLine(mine)).catch(() => {});
  if (played > 0) {
    await ctx.channel?.send(oneLine(`🎮 ${ctx.name} · ${game.name} ${resultText(ctx)}`)).catch(error =>
      console.warn('[Game] 1인용 결과 공개 실패:', error.message)
    );
  }
}

/** 한 판 진행 (고르기 → 결과 → 이어 할지 묻기) */
function runRound(message, ctx) {
  const { game, guild, user, bet, prefix } = ctx;
  const collector = message.createMessageComponentCollector({ componentType: ComponentType.Button, time: PICK_TIMEOUT_MS });
  collector.on('collect', async i => {
    if (i.user.id !== user.id) return rejectOthers(i);
    collector.stop('picked');
    ctx.last = i;

    const { delta, detail } = game.play(i.customId.split(':').pop(), bet);
    const outcome = delta > 0 ? 'win' : delta < 0 ? 'lose' : 'draw';
    const [{ applied }] = pointsManager.applyGameResult(guild.id, [{ userId: user.id, delta, outcome }]);
    let balance = pointsManager.get(guild.id, user.id).balance;
    let streakText = '';
    let bonus = 0;
    if (game.streakBonusRate) {
      const streak = pointsManager.updateSoloStreak(guild.id, user.id, outcome, s => bet * game.streakBonusRate(s));
      ({ bonus, balance } = streak);
      ctx.stats.bestStreak = Math.max(ctx.stats.bestStreak, streak.streak);
      if (bonus > 0) streakText = `\n🔥 **${streak.streak}연승!** 연승 보너스 +${p(bonus)} (베팅의 ${Math.round(game.streakBonusRate(streak.streak) * 100)}%)`;
      else if (outcome === 'win' && streak.streak >= 2) streakText = `\n🔥 ${streak.streak}연승 중`;
      else if (outcome === 'draw' && streak.streak >= 1) streakText = `\n🔥 ${streak.streak}연승 유지`;
      else if (outcome === 'lose' && streak.best >= 3 && applied < 0) streakText = `\n연승이 끊겼습니다. (최고 ${streak.best}연승)`;
    }
    releasePlayers(guild.id, [user.id]);
    ctx.stats[{ win: 'wins', lose: 'losses', draw: 'draws' }[outcome]] += 1;
    ctx.stats.net += applied + bonus;
    ctx.stats.bonus += bonus;

    const change = applied > 0 ? `+${p(applied)}` : applied < 0 ? `-${p(-applied)}` : '변화 없음';
    const resultEmbed = new EmbedBuilder()
      .setColor(COLOR[outcome])
      .setTitle(`${game.title}${roundTag(ctx)} · ${OUTCOME_TITLE[outcome]}`)
      .setDescription(`${detail}\n\n포인트 ${change} → 잔액 **${p(balance)}**${streakText}`)
      .setFooter({ text: `🔁 같은 베팅으로 한 판 더 / 🛑 그만하기 (${AGAIN_TIMEOUT_MS / 1000}초)` });
    await i.update({ content: '', embeds: [resultEmbed], components: [againButtons(prefix, `한 판 더 (${p(bet)})`)] }).catch(() => {});
    askAgain(message, ctx);
  });
  collector.on('end', async (_, reason) => {
    if (reason === 'picked') return;
    releasePlayers(guild.id, [user.id]);
    await endSession(ctx, '⏰ 고르지 않아 끝났습니다');
  });
}

/** 결과 뒤 🔁 한 판 더 / 🛑 그만하기 */
function askAgain(message, ctx) {
  const { guild, user, bet } = ctx;
  const collector = message.createMessageComponentCollector({ componentType: ComponentType.Button, time: AGAIN_TIMEOUT_MS });
  collector.on('collect', async i => {
    if (i.user.id !== user.id) return rejectOthers(i);
    if (i.customId.endsWith(':stop')) {
      collector.stop('stop');
      return endSession(ctx, '🛑 그만하기', i);
    }
    const balance = pointsManager.get(guild.id, user.id).balance;
    if (balance < bet) {
      return i
        .reply({ content: `💸 포인트가 부족해 같은 베팅(${p(bet)})으로 이어 할 수 없습니다. (잔액 ${p(balance)}) 🛑 를 누르거나 베팅을 바꿔 새로 시작해 주세요.`, ephemeral: true })
        .catch(() => {});
    }
    if (lockPlayers(guild.id, [user.id])) {
      return i.reply({ content: '⏳ 다른 게임이 진행 중입니다. 끝난 뒤 다시 눌러 주세요.', ephemeral: true }).catch(() => {});
    }
    collector.stop('again');
    ctx.last = i;
    ctx.round += 1;
    await i.update(pickPayload(ctx)).catch(() => {});
    runRound(message, ctx);
  });
  collector.on('end', async (_, reason) => {
    if (reason !== 'time') return;
    await endSession(ctx, '⏰ 시간이 지나 끝났습니다');
  });
}
