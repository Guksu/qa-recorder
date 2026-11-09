import { createAbortError } from '../core/abort.js';

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

export interface ReadLimitedOptions {
  /** 취소 신호. 취소되면 사본 읽기를 멈추고(앱의 원본 스트림은 그대로) AbortError로 실패한다 */
  signal?: AbortSignal;
  /** 조각을 받을 때마다 지금까지 읽은 텍스트로 호출된다 (아직 받는 중인 본문을 저장할 때 쓴다) */
  onProgress?: (textSoFar: string) => void;
}

/**
 * fetch 응답 사본을 limit 글자까지만 읽는다. 넘으면 읽기를 취소해 나머지를 메모리에 모으지 않는다
 * (response.clone().text()는 끝나지 않는 스트림이면 끝없이 모은다). 앱이 쓰는 원본 body에는 영향이 없다
 * — 사본(tee의 한쪽)만 읽고 취소하므로 원본 스트림은 소비되지도 취소되지도 않는다.
 * text()와 같게 항상 UTF-8로 디코딩한다.
 */
export async function readLimitedText(
  response: Response,
  limit: number,
  options: ReadLimitedOptions = {},
): Promise<{ text: string; truncated: boolean }> {
  const { signal, onProgress } = options;
  if (signal?.aborted) throw createAbortError();
  const copy = response.clone();
  const body = copy.body;
  if (!body || typeof body.getReader !== 'function') {
    const text = await copy.text();
    if (signal?.aborted) throw createAbortError();
    return text.length > limit ? { text: text.slice(0, limit), truncated: true } : { text, truncated: false };
  }

  const reader = body.getReader();
  const onAbort = () => { reader.cancel().catch(() => { /* 취소 실패는 무시 */ }); };
  signal?.addEventListener('abort', onAbort);
  try {
    const decoder = new TextDecoder();
    let text = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (signal?.aborted) throw createAbortError();
      if (done) return { text: text + decoder.decode(), truncated: false };
      text += decoder.decode(value, { stream: true });
      if (text.length > limit) {
        reader.cancel().catch(() => { /* 취소 실패는 무시 */ });
        return { text: text.slice(0, limit), truncated: true };
      }
      onProgress?.(text);
    }
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}

/** 문자열을 UTF-8로 인코딩했을 때의 바이트 수 (인코딩 결과를 만들지 않고 센다) */
export function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length
      && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) {
      bytes += 4; // 서로게이트 쌍 = 코드 포인트 하나
      i++;
    } else bytes += 3; // 짝이 없는 서로게이트는 U+FFFD(3바이트)로 인코딩된다
  }
  return bytes;
}

/**
 * fetch/XHR로 보내는 본문의 바이트 수. 본문이 없으면 0, 페이지에서 크기를 알 수 없는 본문(FormData, 스트림 등)은 -1.
 */
export function requestBodySize(body: unknown): number {
  if (body === undefined || body === null) return 0;
  try {
    if (typeof body === 'string') return utf8ByteLength(body);
    if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) return utf8ByteLength(body.toString());
    if (typeof Blob !== 'undefined' && body instanceof Blob) return body.size;
    if (body instanceof ArrayBuffer) return body.byteLength;
    if (ArrayBuffer.isView(body)) return body.byteLength;
  } catch {
    /* 크기를 읽을 수 없으면 알 수 없음 */
  }
  return -1;
}
