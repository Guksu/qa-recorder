import { MaskingFilter, type KeyMatcher } from './MaskingFilter.js';
import {
  BINARY_PLACEHOLDER, isBinaryMime, limitText, readLimitedText, requestBodySize, truncationNote, utf8ByteLength,
} from './bodyLimit.js';
import type { HAREntry } from '../types/har.js';

export interface NetworkCaptureOptions {
  /** body·URL에서 값을 가릴 키 목록 (MaskingFilter.createKeyMatcher 참고) */
  maskKeys?: string[];
  /**
   * 캡처하지 않을 URL 목록 (녹화기 자체의 업로드 endpoint 등).
   * 상대 경로는 요청 시점의 페이지 URL 기준으로 해석하고 fragment는 무시하고 비교한다.
   */
  ignoreUrls?: string[];
  /** 요청/응답 body를 저장할 최대 글자 수 (bodyLimit.ts 참고). 지정하지 않으면 제한 없음, 0이면 body를 저장하지 않음 */
  maxBodySize?: number;
}

/**
 * 페이지의 fetch/XHR에서는 알 수 없는 HTTP 버전. HAR의 httpVersion은 필수 문자열이라 빈 문자열(알 수 없음)로 둔다
 * — 예전처럼 'HTTP/1.1'을 적으면 실제로는 h2/h3인 요청도 측정한 값처럼 보인다.
 */
const UNKNOWN_HTTP_VERSION = '';

/**
 * XHR / fetch 인터셉터로 네트워크 요청을 캡처.
 * 최대 maxRequests 개의 항목을 FIFO 순환 버퍼로 유지.
 *
 * 가로채기는 start()부터 stop()까지의 "세션"에만 기록한다. stop() 후에 끝난 요청이나, stop() 후 다시 start()한
 * 새 세션에서 끝난 이전 세션의 요청은 기록하지 않는다. 원본 fetch/XMLHttpRequest는 start() 시점의 값을 쓰고,
 * stop()은 window의 값이 아직 이 인스턴스의 패치일 때만 되돌린다 — 그 위에 다른 코드가 다시 감쌌다면
 * 그 패치를 지우지 않고, 남은 이 인스턴스의 패치는 그대로 원본을 호출하기만 한다.
 */
export class NetworkCapture {
  private buffer: HAREntry[] = [];
  private originalFetch: typeof fetch;
  private originalXHR: typeof XMLHttpRequest;
  private patchedFetch: typeof fetch | null = null;
  private patchedXHR: typeof XMLHttpRequest | null = null;
  private recordingStartedAt: Date | null = null;
  /** 지금 세션 번호 (stop() 중이면 0) */
  private session = 0;
  private sessionSeq = 0;
  private readonly maskSet: Set<string>;
  private readonly isSensitiveKey: KeyMatcher | null;
  private readonly ignoreUrls: string[];
  private readonly maxBodySize: number;

  constructor(
    private readonly maxRequests: number,
    maskHeaders: string[],
    options: NetworkCaptureOptions = {},
  ) {
    this.maskSet = new Set(maskHeaders.map((h) => h.toLowerCase()));
    this.isSensitiveKey = MaskingFilter.createKeyMatcher(options.maskKeys ?? []);
    this.ignoreUrls = options.ignoreUrls ?? [];
    const { maxBodySize } = options;
    this.maxBodySize = typeof maxBodySize === 'number' && maxBodySize >= 0 ? maxBodySize : Infinity;
    this.originalFetch = window.fetch;
    this.originalXHR = window.XMLHttpRequest;
  }

  start(): void {
    if (this.session !== 0) return;
    this.session = ++this.sessionSeq;
    this.recordingStartedAt = new Date();
    // 생성 이후에 다른 코드(다른 녹화기 인스턴스 포함)가 감쌌을 수 있으므로 지금 값을 원본으로 쓴다
    this.originalFetch = window.fetch;
    this.originalXHR = window.XMLHttpRequest;
    this.interceptFetch();
    this.interceptXHR();
  }

  stop(): void {
    this.session = 0;
    if (this.patchedFetch && window.fetch === this.patchedFetch) window.fetch = this.originalFetch;
    if (this.patchedXHR && window.XMLHttpRequest === this.patchedXHR) {
      (window as Window & { XMLHttpRequest: typeof XMLHttpRequest }).XMLHttpRequest = this.originalXHR;
    }
    this.patchedFetch = null;
    this.patchedXHR = null;
  }

  /** 버퍼를 비우고 기록 시작 시점을 현재로 재설정 */
  clearBuffer(): void {
    this.buffer = [];
    this.recordingStartedAt = new Date();
  }

  /**
   * 저장한 엔트리만 버퍼에서 뺀다 (저장 성공 후). 저장하는 동안 새로 기록된 엔트리는 남는다.
   * 엔트리는 snapshot()이 돌려준 객체와 같은 객체인지로 비교한다.
   */
  discard(entries: readonly HAREntry[]): void {
    if (entries.length === 0) return;
    const saved = new Set(entries);
    this.buffer = this.buffer.filter((entry) => !saved.has(entry));
  }

  /** 기록 시작 시점을 바꾸고 남은 엔트리의 _offsetMs를 그 기준으로 다시 계산한다 */
  rebase(startedAt: Date): void {
    this.recordingStartedAt = startedAt;
    for (const entry of this.buffer) entry._offsetMs = this.offsetOf(entry.startedDateTime);
  }

  /** 현재 버퍼의 복사본 반환 (저장 시점 스냅샷) */
  snapshot(): HAREntry[] {
    return [...this.buffer];
  }

  /** 백업에서 복원된 엔트리를 버퍼 앞에 추가 (maxRequests 초과분 앞에서 제거) */
  restoreEntries(entries: HAREntry[]): void {
    this.buffer = [...entries, ...this.buffer].slice(-this.maxRequests);
  }

  private isIgnored(url: string): boolean {
    if (this.ignoreUrls.length === 0) return false;
    const target = normalizeUrl(url);
    return target !== null && this.ignoreUrls.some((ignored) => normalizeUrl(ignored) === target);
  }

  /** 마스킹을 마친 엔트리의 요청/응답 body를 maxBodySize로 자른다 (마스킹은 반드시 자르기 전에) */
  private limitBodies(entry: HAREntry): HAREntry {
    if (entry.request.postData?.text) entry.request.postData.text = this.limitBody(entry.request.postData.text);
    if (entry.response.content.text) entry.response.content.text = this.limitBody(entry.response.content.text);
    return entry;
  }

  private limitBody(text: string): string {
    if (text === BINARY_PLACEHOLDER) return text;
    return this.maxBodySize > 0 ? limitText(text, this.maxBodySize) : '';
  }

  /**
   * fetch 응답 body를 비동기로 채운다. 바이너리 MIME은 읽지 않고, 나머지는 maxBodySize까지만 읽는다.
   * 끝까지 읽은 body는 maskBody로, 잘린 body는 maskTruncatedBody로 가린다.
   * content.size는 끝까지 읽어 디코딩한 본문의 바이트 수만 기록하고, 읽지 않았거나 잘렸으면 -1(알 수 없음)로 둔다.
   * response.bodySize(네트워크로 받은 압축된 크기)는 페이지에서 알 수 없어 항상 -1이다.
   */
  private fillResponseBody(stored: HAREntry, response: Response): void {
    const { content } = stored.response;
    if (isBinaryMime(content.mimeType)) {
      content.text = BINARY_PLACEHOLDER;
      return;
    }
    if (this.maxBodySize <= 0) return;

    readLimitedText(response, this.maxBodySize).then(({ text, truncated }) => {
      if (truncated) {
        content.text = MaskingFilter.maskTruncatedBody(text, content.mimeType, this.isSensitiveKey)
          + truncationNote(this.maxBodySize);
      } else {
        content.size = utf8ByteLength(text);
        content.text = MaskingFilter.maskBody(text, content.mimeType, this.isSensitiveKey);
      }
    }).catch(() => { /* body 읽기 실패 무시 */ });
  }

  private offsetOf(startedDateTime: string): number {
    if (!this.recordingStartedAt) return 0;
    const offset = new Date(startedDateTime).getTime() - this.recordingStartedAt.getTime();
    return Number.isNaN(offset) ? 0 : offset;
  }

  /** session에 시작된 요청을 기록한다. 그 세션이 이미 끝났으면(stop 또는 다시 start) 기록하지 않고 null */
  private push(entry: HAREntry, session: number): HAREntry | null {
    if (session !== this.session) return null;
    if (this.buffer.length >= this.maxRequests) {
      this.buffer.shift(); // FIFO: 가장 오래된 항목 제거
    }
    const stored = { ...entry, _offsetMs: this.offsetOf(entry.startedDateTime) };
    this.buffer.push(stored);
    return stored;
  }

  private interceptFetch(): void {
    const self = this;
    const original = this.originalFetch;
    const patched = async function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
      const session = self.session;
      // stop() 후에도 다른 코드가 위에서 감싸 이 패치가 남아 있으면 원본만 호출한다
      if (session === 0 || self.patchedFetch !== patched) return original.call(window, input, init);
      const startedAt = new Date();
      const startTime = performance.now();

      let response: Response;
      try {
        response = await original.call(window, input, init);
      } catch (err) {
        self.captureFetch(session, input, init, startedAt, performance.now() - startTime, null);
        throw err;
      }

      self.captureFetch(session, input, init, startedAt, performance.now() - startTime, response);
      return response;
    } as typeof fetch;
    this.patchedFetch = patched;
    window.fetch = patched;
  }

  /**
   * fetch 요청/응답을 버퍼에 기록. response가 null이면 네트워크 실패(status 0)로 기록.
   * 캡처 로직의 예외가 앱의 fetch 호출로 전파되지 않도록 내부에서 모두 삼킨다.
   * 응답 body는 호출자를 블로킹하지 않도록 비동기로 채운다 (SSE/스트리밍 응답 대응).
   */
  private captureFetch(
    session: number,
    input: RequestInfo | URL,
    init: RequestInit | undefined,
    startedAt: Date,
    elapsed: number,
    response: Response | null,
  ): void {
    try {
      if (session !== this.session) return;
      const { method, url, headers } = describeFetchRequest(input, init);
      if (this.isIgnored(url)) return;

      let postData: { mimeType: string; text: string } | undefined;
      let bodySize = 0;
      if (init?.body) {
        const text = typeof init.body === 'string' ? init.body : BINARY_PLACEHOLDER;
        const mimeType = headers.find((h) => h.name.toLowerCase() === 'content-type')?.value ?? '';
        postData = { mimeType, text };
        bodySize = requestBodySize(init.body);
      } else if (input instanceof Request && input.body !== null) {
        // Request 객체에 담긴 본문은 읽지 않으므로 크기를 알 수 없다
        bodySize = -1;
      }

      const content = {
        // 본문을 읽기 전이다 — 실패한 요청은 본문이 없으므로 0, 그 밖에는 읽고 나서 채운다 (fillResponseBody)
        size: response ? -1 : 0,
        mimeType: response?.headers.get('content-type') ?? '',
        text: '',
      };

      const stored = this.push(this.limitBodies(
        MaskingFilter.apply(
          {
            startedDateTime: startedAt.toISOString(),
            time: elapsed,
            request: {
              method,
              url,
              httpVersion: UNKNOWN_HTTP_VERSION,
              headers,
              queryString: parseQueryString(url),
              postData,
              bodySize,
              headersSize: -1,
            },
            response: {
              status: response?.status ?? 0,
              statusText: response ? response.statusText : 'Network Error',
              httpVersion: UNKNOWN_HTTP_VERSION,
              headers: response
                ? Array.from(response.headers.entries()).map(([name, value]) => ({ name, value }))
                : [],
              content,
              bodySize: -1,
              headersSize: -1,
            },
            timings: { send: 0, wait: elapsed, receive: 0 },
          },
          this.maskSet,
          this.isSensitiveKey,
        ),
      ), session);

      // body는 엔트리 기록 이후에 도착하므로 여기서 따로 읽고 마스킹한다
      if (stored && response) this.fillResponseBody(stored, response);
    } catch {
      /* 캡처 실패가 앱 요청에 영향을 주지 않도록 무시 */
    }
  }

  private interceptXHR(): void {
    const self = this;
    const OriginalXHR = this.originalXHR;

    function PatchedXHR(this: XMLHttpRequest) {
      const xhr = new OriginalXHR();
      const session = self.session;
      // 세션 밖에서 만든 XHR은 가로채지 않는다 (stop() 후 다른 코드의 패치 아래에 남은 경우)
      if (session === 0 || self.patchedXHR !== (PatchedXHR as unknown)) return xhr;

      let method = '';
      let url = '';
      let requestHeaders: { name: string; value: string }[] = [];
      let requestBody = '';
      let sentBody: unknown = null;
      let startedAt: Date;
      let startTime: number;

      const originalOpen = xhr.open.bind(xhr);
      const originalSetRequestHeader = xhr.setRequestHeader.bind(xhr);
      const originalSend = xhr.send.bind(xhr);

      (this as XMLHttpRequest & { open: typeof xhr.open }).open = function (
        m: string, u: string | URL, async: boolean = true, user?: string | null, password?: string | null
      ) {
        method = m;
        // fetch의 Request.url처럼 페이지 URL 기준의 절대 URL로 기록한다 (HAR의 url은 URI여야 한다)
        url = resolveUrl(typeof u === 'string' ? u : u.toString());
        // open()은 XHR 상태를 리셋하므로 이전에 수집한 헤더/바디도 초기화
        requestHeaders = [];
        requestBody = '';
        sentBody = null;
        return originalOpen(m, u, async, user, password);
      };

      (this as XMLHttpRequest & { setRequestHeader: typeof xhr.setRequestHeader }).setRequestHeader = function (name: string, value: string) {
        requestHeaders.push({ name, value });
        return originalSetRequestHeader(name, value);
      };

      (this as XMLHttpRequest & { send: typeof xhr.send }).send = function (body?: Document | XMLHttpRequestBodyInit | null) {
        startedAt = new Date();
        startTime = performance.now();
        sentBody = body ?? null;
        if (typeof body === 'string') requestBody = body;

        xhr.addEventListener('loadend', () => {
          try {
            if (session !== self.session || self.isIgnored(url)) return;
            self.captureXHR(session, xhr, {
              method, url, requestHeaders, requestBody, sentBody, startedAt, elapsed: performance.now() - startTime,
            });
          } catch {
            /* 캡처 실패가 앱 요청에 영향을 주지 않도록 무시 */
          }
        }, { once: true });

        return originalSend(body);
      };

      // 패치된 open/setRequestHeader/send는 이 객체의 own property에서,
      // 나머지 프로퍼티/메서드는 원본 xhr에 위임
      return new Proxy(this, {
        get(target, prop) {
          if (Object.prototype.hasOwnProperty.call(target, prop)) {
            return (target as unknown as Record<string, unknown>)[prop as string];
          }
          const val = (xhr as unknown as Record<string, unknown>)[prop as string];
          return typeof val === 'function' ? val.bind(xhr) : val;
        },
        set(_, prop, value) {
          (xhr as unknown as Record<string, unknown>)[prop as string] = value;
          return true;
        },
      }) as XMLHttpRequest;
    }

    PatchedXHR.prototype = OriginalXHR.prototype;
    // XMLHttpRequest.DONE 등 정적 상수/멤버가 패치 후에도 조회되도록 원본 생성자를 상속
    Object.setPrototypeOf(PatchedXHR, OriginalXHR);
    this.patchedXHR = PatchedXHR as unknown as typeof XMLHttpRequest;
    (window as Window & { XMLHttpRequest: typeof XMLHttpRequest }).XMLHttpRequest = this.patchedXHR;
  }

  private captureXHR(
    session: number,
    xhr: XMLHttpRequest,
    req: {
      method: string; url: string; requestHeaders: { name: string; value: string }[];
      requestBody: string; sentBody: unknown; startedAt: Date; elapsed: number;
    },
  ): void {
    const responseHeaders = xhr.getAllResponseHeaders()
      .trim().split('\r\n')
      .filter(Boolean)
      .map((line) => {
        const idx = line.indexOf(': ');
        return { name: line.slice(0, idx), value: line.slice(idx + 2) };
      });

    const mimeType = xhr.getResponseHeader('content-type') ?? '';
    const isText = !isBinaryMime(mimeType) && (xhr.responseType === '' || xhr.responseType === 'text');
    const responseText = isText ? xhr.responseText : BINARY_PLACEHOLDER;
    const contentSize = isText ? utf8ByteLength(responseText) : binaryResponseSize(xhr);

    let postData: { mimeType: string; text: string } | undefined;
    if (req.sentBody !== null && req.sentBody !== undefined && req.sentBody !== '') {
      const ct = req.requestHeaders.find((h) => h.name.toLowerCase() === 'content-type')?.value ?? '';
      postData = { mimeType: ct, text: typeof req.sentBody === 'string' ? req.requestBody : BINARY_PLACEHOLDER };
    }

    this.push(this.limitBodies(
      MaskingFilter.apply(
        {
          startedDateTime: req.startedAt.toISOString(),
          time: req.elapsed,
          request: {
            method: req.method,
            url: req.url,
            httpVersion: UNKNOWN_HTTP_VERSION,
            headers: req.requestHeaders,
            queryString: parseQueryString(req.url),
            postData,
            bodySize: requestBodySize(req.sentBody),
            headersSize: -1,
          },
          response: {
            status: xhr.status,
            statusText: xhr.statusText,
            httpVersion: UNKNOWN_HTTP_VERSION,
            headers: responseHeaders,
            content: { size: contentSize, mimeType, text: responseText },
            bodySize: -1,
            headersSize: -1,
          },
          timings: { send: 0, wait: req.elapsed, receive: 0 },
        },
        this.maskSet,
        this.isSensitiveKey,
      ),
    ), session);
  }
}

/** 텍스트로 읽지 않은 XHR 응답의 바이트 수 (ArrayBuffer·Blob이면 실제 크기, 그 밖에는 -1) */
function binaryResponseSize(xhr: XMLHttpRequest): number {
  try {
    const { response } = xhr;
    if (response instanceof ArrayBuffer) return response.byteLength;
    if (typeof Blob !== 'undefined' && response instanceof Blob) return response.size;
  } catch {
    /* 응답을 읽을 수 없으면 알 수 없음 */
  }
  return -1;
}

/** 요청 URL을 페이지 URL 기준의 절대 URL로 바꾼다. 해석할 수 없으면 그대로 */
function resolveUrl(url: string): string {
  try {
    return new URL(url, window.location.href).href;
  } catch {
    return url;
  }
}

/** 비교용 URL 정규화 (상대 경로 해석, fragment 제거). 파싱 실패 시 null */
function normalizeUrl(url: string): string | null {
  try {
    const parsed = new URL(url, window.location.href);
    parsed.hash = '';
    return parsed.href;
  } catch {
    return null;
  }
}

function parseQueryString(url: string): { name: string; value: string }[] {
  try {
    const { searchParams } = new URL(url, window.location.href);
    return Array.from(searchParams.entries()).map(([name, value]) => ({ name, value }));
  } catch {
    return [];
  }
}

/**
 * fetch 인자에서 method/url/headers를 추출.
 * new Request()는 ReadableStream body 등에서 throw할 수 있으므로 실패 시 수동 추출로 폴백.
 */
function describeFetchRequest(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
): { method: string; url: string; headers: { name: string; value: string }[] } {
  try {
    const request = new Request(input, init);
    return {
      method: request.method,
      url: request.url,
      headers: Array.from(request.headers.entries()).map(([name, value]) => ({ name, value })),
    };
  } catch {
    const url = typeof input === 'string'
      ? new URL(input, window.location.href).toString()
      : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    let headers: { name: string; value: string }[] = [];
    try {
      const h = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      headers = Array.from(h.entries()).map(([name, value]) => ({ name, value }));
    } catch { /* 헤더 추출 실패 시 빈 배열 유지 */ }
    return { method, url, headers };
  }
}
