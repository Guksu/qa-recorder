import { MaskingFilter } from './MaskingFilter.js';
import type { HAREntry } from '@qa-recorder/shared';

/**
 * XHR / fetch 인터셉터로 네트워크 요청을 캡처.
 * 최대 maxRequests 개의 항목을 FIFO 순환 버퍼로 유지.
 */
export class NetworkCapture {
  private buffer: HAREntry[] = [];
  private originalFetch: typeof fetch;
  private originalXHR: typeof XMLHttpRequest;
  private recordingStartedAt: Date | null = null;
  private readonly maskSet: Set<string>;

  constructor(
    private readonly maxRequests: number,
    maskHeaders: string[],
  ) {
    this.maskSet = new Set(maskHeaders.map((h) => h.toLowerCase()));
    this.originalFetch = window.fetch;
    this.originalXHR = window.XMLHttpRequest;
  }

  start(): void {
    this.recordingStartedAt = new Date();
    this.interceptFetch();
    this.interceptXHR();
  }

  stop(): void {
    window.fetch = this.originalFetch;
    (window as Window & { XMLHttpRequest: typeof XMLHttpRequest }).XMLHttpRequest = this.originalXHR;
  }

  /** 버퍼를 비우고 기록 시작 시점을 현재로 재설정 */
  clearBuffer(): void {
    this.buffer = [];
    this.recordingStartedAt = new Date();
  }

  /** 현재 버퍼의 복사본 반환 (저장 시점 스냅샷) */
  snapshot(): HAREntry[] {
    return [...this.buffer];
  }

  /** 백업에서 복원된 엔트리를 버퍼 앞에 추가 (maxRequests 초과분 앞에서 제거) */
  restoreEntries(entries: HAREntry[]): void {
    this.buffer = [...entries, ...this.buffer].slice(-this.maxRequests);
  }

  private push(entry: HAREntry): HAREntry {
    if (this.buffer.length >= this.maxRequests) {
      this.buffer.shift(); // FIFO: 가장 오래된 항목 제거
    }
    const offsetMs = this.recordingStartedAt
      ? new Date(entry.startedDateTime).getTime() - this.recordingStartedAt.getTime()
      : 0;
    const stored = { ...entry, _offsetMs: offsetMs };
    this.buffer.push(stored);
    return stored;
  }

  private interceptFetch(): void {
    const self = this;
    window.fetch = async function (input, init) {
      const startedAt = new Date();
      const startTime = performance.now();

      let response: Response;
      try {
        response = await self.originalFetch.call(window, input, init);
      } catch (err) {
        self.captureFetch(input, init, startedAt, performance.now() - startTime, null);
        throw err;
      }

      self.captureFetch(input, init, startedAt, performance.now() - startTime, response);
      return response;
    };
  }

  /**
   * fetch 요청/응답을 버퍼에 기록. response가 null이면 네트워크 실패(status 0)로 기록.
   * 캡처 로직의 예외가 앱의 fetch 호출로 전파되지 않도록 내부에서 모두 삼킨다.
   * 응답 body는 호출자를 블로킹하지 않도록 비동기로 채운다 (SSE/스트리밍 응답 대응).
   */
  private captureFetch(
    input: RequestInfo | URL,
    init: RequestInit | undefined,
    startedAt: Date,
    elapsed: number,
    response: Response | null,
  ): void {
    try {
      const { method, url, headers } = describeFetchRequest(input, init);

      let postData: { mimeType: string; text: string } | undefined;
      if (init?.body) {
        const text = typeof init.body === 'string' ? init.body : '[binary]';
        const mimeType = headers.find((h) => h.name.toLowerCase() === 'content-type')?.value ?? '';
        postData = { mimeType, text };
      }

      const content = {
        size: 0,
        mimeType: response?.headers.get('content-type') ?? '',
        text: '',
      };

      const stored = this.push(
        MaskingFilter.apply(
          {
            startedDateTime: startedAt.toISOString(),
            time: elapsed,
            request: {
              method,
              url,
              httpVersion: 'HTTP/1.1',
              headers,
              queryString: parseQueryString(url),
              postData,
              bodySize: postData ? postData.text.length : -1,
              headersSize: -1,
            },
            response: {
              status: response?.status ?? 0,
              statusText: response ? response.statusText : 'Network Error',
              httpVersion: 'HTTP/1.1',
              headers: response
                ? Array.from(response.headers.entries()).map(([name, value]) => ({ name, value }))
                : [],
              content,
              bodySize: response ? 0 : -1,
              headersSize: -1,
            },
            timings: { send: 0, wait: elapsed, receive: 0 },
          },
          this.maskSet,
        ),
      );

      if (response) {
        response.clone().text().then((text) => {
          stored.response.content.text = text;
          stored.response.content.size = text.length;
          stored.response.bodySize = text.length;
        }).catch(() => { /* body 읽기 실패 무시 */ });
      }
    } catch {
      /* 캡처 실패가 앱 요청에 영향을 주지 않도록 무시 */
    }
  }

  private interceptXHR(): void {
    const self = this;
    const OriginalXHR = this.originalXHR;

    function PatchedXHR(this: XMLHttpRequest) {
      const xhr = new OriginalXHR();

      let method = '';
      let url = '';
      let requestHeaders: { name: string; value: string }[] = [];
      let requestBody = '';
      let startedAt: Date;
      let startTime: number;

      const originalOpen = xhr.open.bind(xhr);
      const originalSetRequestHeader = xhr.setRequestHeader.bind(xhr);
      const originalSend = xhr.send.bind(xhr);

      (this as XMLHttpRequest & { open: typeof xhr.open }).open = function (
        m: string, u: string | URL, async: boolean = true, user?: string | null, password?: string | null
      ) {
        method = m;
        url = typeof u === 'string' ? u : u.toString();
        // open()은 XHR 상태를 리셋하므로 이전에 수집한 헤더/바디도 초기화
        requestHeaders = [];
        requestBody = '';
        return originalOpen(m, u, async, user, password);
      };

      (this as XMLHttpRequest & { setRequestHeader: typeof xhr.setRequestHeader }).setRequestHeader = function (name: string, value: string) {
        requestHeaders.push({ name, value });
        return originalSetRequestHeader(name, value);
      };

      (this as XMLHttpRequest & { send: typeof xhr.send }).send = function (body?: Document | XMLHttpRequestBodyInit | null) {
        startedAt = new Date();
        startTime = performance.now();
        if (typeof body === 'string') requestBody = body;

        xhr.addEventListener('loadend', () => {
          const elapsed = performance.now() - startTime;
          const responseHeaders = xhr.getAllResponseHeaders()
            .trim().split('\r\n')
            .filter(Boolean)
            .map((line) => {
              const idx = line.indexOf(': ');
              return { name: line.slice(0, idx), value: line.slice(idx + 2) };
            });

          const mimeType = xhr.getResponseHeader('content-type') ?? '';
          const responseText = xhr.responseType === '' || xhr.responseType === 'text'
            ? xhr.responseText : '[binary]';

          let postData: { mimeType: string; text: string } | undefined;
          if (requestBody) {
            const ct = requestHeaders.find((h) => h.name.toLowerCase() === 'content-type')?.value ?? '';
            postData = { mimeType: ct, text: requestBody };
          }

          self.push(
            MaskingFilter.apply(
              {
                startedDateTime: startedAt.toISOString(),
                time: elapsed,
                request: {
                  method,
                  url,
                  httpVersion: 'HTTP/1.1',
                  headers: requestHeaders,
                  queryString: parseQueryString(url),
                  postData,
                  bodySize: requestBody.length,
                  headersSize: -1,
                },
                response: {
                  status: xhr.status,
                  statusText: xhr.statusText,
                  httpVersion: 'HTTP/1.1',
                  headers: responseHeaders,
                  content: { size: responseText.length, mimeType, text: responseText },
                  bodySize: responseText.length,
                  headersSize: -1,
                },
                timings: { send: 0, wait: elapsed, receive: 0 },
              },
              self.maskSet,
            ),
          );
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
    (window as Window & { XMLHttpRequest: typeof XMLHttpRequest }).XMLHttpRequest =
      PatchedXHR as unknown as typeof XMLHttpRequest;
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
