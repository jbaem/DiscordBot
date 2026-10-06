/**
 * 시간/기간 표기 헬퍼 (디스코드 타임스탬프 마크업 <t:초:형식> 사용)
 */

/** 타임스탬프(ms) → 디스코드 절대 시각 + 상대 시각 표기 (예: 2026년 9월 26일 오후 3:04 (3분 전)) */
export function formatDateTime(timestamp) {
  const sec = Math.floor(timestamp / 1000);
  return `<t:${sec}:F> (<t:${sec}:R>)`;
}

/** 두 시각 사이의 기간을 "N일" / "N시간" / "1시간 미만" 으로 표기 */
export function formatStayDuration(fromTimestamp, toTimestamp) {
  const ms = Math.max(0, toTimestamp - fromTimestamp);
  const days = Math.floor(ms / 86_400_000);
  if (days >= 1) return `${days.toLocaleString()}일`;
  const hours = Math.floor(ms / 3_600_000);
  return hours >= 1 ? `${hours}시간` : '1시간 미만';
}

/** 초 단위 시간을 "N시간 M분" 형태로 변환 */
export function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours === 0 && minutes === 0) return seconds > 0 ? '1분 미만' : '0분';
  if (hours === 0) return `${minutes}분`;
  return minutes > 0 ? `${hours.toLocaleString()}시간 ${minutes}분` : `${hours.toLocaleString()}시간`;
}

/** 타임스탬프(ms)를 디스코드 절대 + 상대 시간 표기로 변환 */
export function formatDate(timestamp) {
  if (!timestamp) return '알 수 없음';
  const sec = Math.floor(timestamp / 1000);
  return `<t:${sec}:D> (<t:${sec}:R>)`;
}
