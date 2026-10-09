import { p } from './common.js';

/**
 * 봇 상대 1인용 미니게임 정의 (진행은 soloSession.js)
 * 각 게임의 play(choice, bet, random) 는 { delta: 포인트 변화, detail: 결과 설명 } 을 돌려줌
 */

const roll = (sides, random = Math.random) => 1 + Math.floor(random() * sides);
const DICE_FACES = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

/** 홀짝: 1~100 중 하나를 뽑아 홀/짝을 맞히면 +베팅, 틀리면 -베팅 */
export const ODD_EVEN = Object.freeze({
  key: 'oddeven',
  name: '홀짝',
  title: '🔴🔵 홀짝',
  prompt: '홀일지 짝일지 골라 주세요!',
  rules: bet => `1~100 중 하나를 뽑아요. 맞히면 +${p(bet)}, 틀리면 -${p(bet)}`,
  choices: [
    { id: 'odd', label: '홀', emoji: '🔴' },
    { id: 'even', label: '짝', emoji: '🔵' },
  ],
  play(choice, bet, random = Math.random) {
    const n = roll(100, random);
    const actual = n % 2 ? 'odd' : 'even';
    const label = { odd: '🔴 홀', even: '🔵 짝' };
    return { delta: actual === choice ? bet : -bet, detail: `나온 수 **${n}** → ${label[actual]} (내 선택 ${label[choice]})` };
  },
});

/** 주사위: 나와 봇이 주사위 2개씩 굴려 합이 큰 쪽이 이김 (같으면 무승부) */
export const DICE = Object.freeze({
  key: 'dice',
  name: '주사위 vs 연두봇',
  title: '🎲 주사위 vs 연두봇',
  prompt: '주사위를 굴려 주세요!',
  rules: bet => `주사위 2개의 합이 크면 +${p(bet)}, 작으면 -${p(bet)}, 같으면 그대로`,
  choices: [{ id: 'roll', label: '굴리기', emoji: '🎲' }],
  play(_, bet, random = Math.random) {
    const mine = [roll(6, random), roll(6, random)];
    const bot = [roll(6, random), roll(6, random)];
    const sum = d => d[0] + d[1];
    const show = d => `${DICE_FACES[d[0]]}${DICE_FACES[d[1]]} **${sum(d)}**`;
    return { delta: Math.sign(sum(mine) - sum(bot)) * bet, detail: `나 ${show(mine)}  vs  ${show(bot)} 연두봇` };
  },
});

/**
 * 슬롯머신 배당 (베팅액에 곱해 얻는 포인트, 못 맞히면 -베팅)
 * 기댓값이 약간 손해(약 -12%)라 포인트가 너무 불어나지 않게 함
 */
export const SLOT_SYMBOLS = Object.freeze(['🍒', '🍋', '🍇', '🔔', '⭐', '7️⃣']);
export const SLOT_PAYOUTS = Object.freeze({ jackpot: 20, star: 10, triple: 5, pair: 0.5 });

/** 슬롯 결과 → 배당 배수 (못 맞히면 -1) */
export function slotMultiplier(reels) {
  const [a, b, c] = reels;
  if (a === b && b === c) {
    if (a === '7️⃣') return SLOT_PAYOUTS.jackpot;
    if (a === '⭐') return SLOT_PAYOUTS.star;
    return SLOT_PAYOUTS.triple;
  }
  if (a === b || b === c || a === c) return SLOT_PAYOUTS.pair;
  return -1;
}

export const SLOT = Object.freeze({
  key: 'slot',
  name: '슬롯머신',
  title: '🎰 슬롯머신',
  prompt: '레버를 당겨 주세요!',
  rules: bet =>
    `7️⃣7️⃣7️⃣ +${p(bet * SLOT_PAYOUTS.jackpot)} · ⭐⭐⭐ +${p(bet * SLOT_PAYOUTS.star)} · 같은 그림 3개 +${p(bet * SLOT_PAYOUTS.triple)} · ` +
    `2개 +${p(Math.floor(bet * SLOT_PAYOUTS.pair))} · 꽝 -${p(bet)}`,
  choices: [{ id: 'spin', label: '돌리기', emoji: '🎰' }],
  play(_, bet, random = Math.random) {
    const reels = Array.from({ length: 3 }, () => SLOT_SYMBOLS[Math.floor(random() * SLOT_SYMBOLS.length)]);
    const multiplier = slotMultiplier(reels);
    const delta = multiplier < 0 ? -bet : Math.floor(bet * multiplier);
    const label =
      multiplier === SLOT_PAYOUTS.jackpot ? '💥 잭팟!' : multiplier === SLOT_PAYOUTS.star ? '🌟 대박!' : multiplier === SLOT_PAYOUTS.triple ? '✨ 3개!' : multiplier > 0 ? '2개 일치' : '꽝';
    return { delta, detail: `[ ${reels.join(' | ')} ]  ${label}${multiplier > 0 ? ` (×${multiplier})` : ''}` };
  },
});
