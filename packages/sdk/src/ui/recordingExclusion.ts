/** rrweb의 기본 blockClass — 이 클래스가 붙은 요소는 리플레이에 내용 없이 같은 크기의 빈 placeholder로만 기록된다 */
export const RR_BLOCK_CLASS = 'rr-block';

/**
 * SDK UI를 세션 리플레이에서 제외한다. shadow host와 shadow root의 최상위 자식 모두에 부여해야 한다.
 * host에만 붙이면 부족하다: rrweb은 attachShadow를 패치해 shadow root를 따로 관찰하고,
 * 차단 판정(isBlocked)이 closest() 기반이라 shadow 경계를 넘지 못하므로
 * 녹화 중 마운트된 UI의 내용과 메모 textarea 입력값이 그대로 기록된다.
 * blockSelector는 직렬화에만 적용되고 입력/인터랙션 이벤트에는 적용되지 않으므로 클래스를 쓴다
 * (data-qa 셀렉터는 호스트 앱의 테스트 id와 겹칠 수 있어 사용하지 않음).
 */
export function excludeFromRecording(...elements: Element[]): void {
  for (const el of elements) el.classList.add(RR_BLOCK_CLASS);
}
