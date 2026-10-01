/**
 * 요청/응답 body를 메모리에 둘 때의 크기 제한.
 * 버퍼에는 maxRequests개의 엔트리가 남으므로 body 하나가 크면(파일 다운로드, 끝나지 않는 SSE) 메모리가 계속 늘어난다.
 */

/** 이 MIME의 응답은 텍스트로 읽지 않고 '[binary]'로 기록한다 (디코딩해도 의미 없는 문자열이 메모리만 차지) */
const BINARY_MIME = /^(?:(?:image|audio|video|font)\/(?!svg\+xml)|application\/(?:octet-stream|pdf|zip|gzip|x-gzip|wasm|x-protobuf|protobuf)$)/;

export const BINARY_PLACEHOLDER = '[binary]';

export function isBinaryMime(mimeType: string): boolean {
  return BINARY_MIME.test(mimeType.split(';')[0].trim().toLowerCase());
}

/** 잘린 body 뒤에 붙이는 표시. 전체 길이를 모르면(스트림을 끝까지 읽지 않음) 생략한다 */
export function truncationNote(kept: number, total?: number): string {
  const of = total === undefined ? '' : ` of ${total}`;
  return `\n…[truncated by qa-recorder: kept the first ${kept}${of} characters]`;
}

/** 이미 메모리에 있는 전체 텍스트를 limit 글자로 자른다 (마스킹은 자르기 전에 끝내야 한다) */
export function limitText(text: string, limit: number): string {
  return text.length > limit ? text.slice(0, limit) + truncationNote(limit, text.length) : text;
}

/**
 * fetch 응답 사본을 limit 글자까지만 읽는다. 넘으면 읽기를 취소해 나머지를 메모리에 모으지 않는다
 * (response.clone().text()는 끝나지 않는 스트림이면 끝없이 모은다). 앱이 쓰는 원본 body에는 영향이 없다.
 * text()와 같게 항상 UTF-8로 디코딩한다.
 */
export async function readLimitedText(response: Response, limit: number): Promise<{ text: string; truncated: boolean }> {
  const copy = response.clone();
  const body = copy.body;
  if (!body || typeof body.getReader !== 'function') {
    const text = await copy.text();
    return text.length > limit ? { text: text.slice(0, limit), truncated: true } : { text, truncated: false };
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return { text: text + decoder.decode(), truncated: false };
    text += decoder.decode(value, { stream: true });
    if (text.length > limit) {
      reader.cancel().catch(() => { /* 취소 실패는 무시 */ });
      return { text: text.slice(0, limit), truncated: true };
    }
  }
}
