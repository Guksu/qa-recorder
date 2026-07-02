/**
 * JSON 문자열을 인라인 <script> 안에 안전하게 삽입할 수 있도록 `<`를 유니코드 이스케이프.
 * 캡처된 데이터(응답 body, 콘솔 메시지 등)에 `</script>`나 `<!--`가 포함되어 있으면
 * HTML 파서가 스크립트 블록을 조기 종료해 리포트가 깨지거나 임의 마크업이 주입될 수 있다.
 * `<`는 JSON/JS 문자열 리터럴 양쪽에서 유효한 이스케이프라 파싱 결과는 동일하다.
 */
export function toScriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}
