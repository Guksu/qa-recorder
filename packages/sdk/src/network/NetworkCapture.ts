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

  private push(entry: HAREntry): void {
    if (this.buffer.length >= this.maxRequests) {
      this.buffer.shift(); // FIFO: 가장 오래된 항목 제거
    }
    const offsetMs = this.recordingStartedAt
      ? new Date(entry.startedDateTime).getTime() - this.recordingStartedAt.getTime()
      : 0;
    this.buffer.push({ ...entry, _offsetMs: offsetMs });
  }

  private interceptFetch(): void {
    const self = this;
    window.fetch = async function (input, init) {
      const startedAt = new Date();
      const request = new Request(input, init);
      const startTime = performance.now();

      const response = await self.originalFetch.call(window, input, init);
      const elapsed = performance.now() - startTime;
      const cloned = response.clone();
      const bodyText = await cloned.text().catch(() => '');

      let postData: { mimeType: string; text: string } | undefined;
      if (init?.body) {
        const body = typeof init.body === 'string' ? init.body : '[binary]';
        const mimeType = (init.headers as Record<string, string>)?.['content-type'] ?? '';
        postData = { mimeType, text: body };
      }

      self.push(
        MaskingFilter.apply(
          {
            startedDateTime: startedAt.toISOString(),
            time: elapsed,
            request: {
              method: request.method,
              url: request.url,
              httpVersion: 'HTTP/1.1',
              headers: Array.from(request.headers.entries()).map(([name, value]) => ({ name, value })),
              queryString: parseQueryString(request.url),
              postData,
              bodySize: postData ? postData.text.length : -1,
              headersSize: -1,
            },
            response: {
              status: response.status,
              statusText: response.statusText,
              httpVersion: 'HTTP/1.1',
              headers: Array.from(response.headers.entries()).map(([name, value]) => ({ name, value })),
              content: { size: bodyText.length, mimeType: response.headers.get('content-type') ?? '', text: bodyText },
              bodySize: bodyText.length,
              headersSize: -1,
            },
            timings: { send: 0, wait: elapsed, receive: 0 },
          },
          self.maskSet,
        ),
      );
      return response;
    };
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
