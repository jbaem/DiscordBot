/**
 * 템플릿 문자열의 `{변수}` 를 값으로 치환
 * - 한 번의 패스로 치환하므로 값 안에 `{server}` 같은 글자가 있어도 다시 치환되지 않음
 * - 함수형 치환을 사용하므로 닉네임 등에 포함된 `$&`, `$'` 같은 특수 패턴이 해석되지 않음
 * - 정의되지 않은 변수는 원문 그대로 둠
 * @param {string} template
 * @param {Record<string, string|number>} values
 */
export function fillTemplate(template, values) {
  if (!template) return '';
  return template.replace(/\{(\w+)\}/g, (match, key) =>
    Object.hasOwn(values, key) ? String(values[key]) : match
  );
}
