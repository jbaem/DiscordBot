import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

/**
 * 게임 공용 도구 (버튼, 한 줄 요약, 표시 형식)
 */

/** 고르기·버튼 누르기 제한 시간 */
export const PICK_TIMEOUT_MS = 30 * 1000;
/** 결과 뒤 "한 판 더 / 그만하기" 를 고를 수 있는 시간 */
export const AGAIN_TIMEOUT_MS = 30 * 1000;

export const COLOR = Object.freeze({ playing: 0x5865F2, win: 0x57F287, lose: 0xED4245, draw: 0xFEE75C, cancel: 0x99AAB5 });

export const p = n => `${n.toLocaleString()}P`;
export const signed = n => (n > 0 ? `+${p(n)}` : n < 0 ? `-${p(-n)}` : '±0P');

/** 결과 뒤 이어 할지 묻는 버튼 (🔁 한 판 더 / 🛑 그만하기) */
export function againButtons(prefix, againLabel) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${prefix}:again`).setLabel(againLabel).setEmoji('🔁').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`${prefix}:stop`).setLabel('그만하기').setEmoji('🛑').setStyle(ButtonStyle.Secondary)
  );
}

/** 게임이 끝나면 큰 임베드 대신 남기는 한 줄 (멘션 알림 없음) */
export const oneLine = content => ({ content, embeds: [], components: [], allowedMentions: { parse: [] } });

/** 버튼을 누른 사람이 이 게임 참가자가 아니면 본인에게만 안내 */
export function rejectOthers(i) {
  return i.reply({ content: '🙅 이 게임의 참가자만 누를 수 있습니다.', ephemeral: true }).catch(() => {});
}
