/** 호출한 쪽이 취소했는지 (AbortSignal) — 업로드 실패와 달리 대체 저장이나 안내를 하지 않는다 */
export function isAbortError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError';
}

/** fetch가 취소될 때와 같은 name('AbortError')의 에러 */
export function createAbortError(): Error {
  // DOMException 생성자가 없는 환경을 위해 같은 name의 Error로 대체한다
  try {
    return new DOMException('The operation was aborted.', 'AbortError');
  } catch {
    const err = new Error('The operation was aborted.');
    err.name = 'AbortError';
    return err;
  }
}
