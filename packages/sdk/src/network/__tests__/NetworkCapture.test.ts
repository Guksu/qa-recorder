import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NetworkCapture } from '../NetworkCapture.js';

function makeMockFetch(status = 200, body = '{}', headers: Record<string, string> = {}) {
  return vi.fn().mockResolvedValue(
    new Response(body, {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    }),
  );
}

describe('NetworkCapture', () => {
  let originalFetch: typeof window.fetch;

  beforeEach(() => {
    originalFetch = window.fetch;
  });

  afterEach(() => {
    window.fetch = originalFetch;
  });

  describe('fetch 인터셉터', () => {
    it('start() 후 fetch 요청이 버퍼에 기록된다', async () => {
      vi.stubGlobal('fetch', makeMockFetch());
      const capture = new NetworkCapture(100, []);
      capture.start();

      await window.fetch('https://example.com/api');

      const entries = capture.snapshot();
      expect(entries).toHaveLength(1);
      expect(entries[0].request.method).toBe('GET');
      expect(entries[0].request.url).toBe('https://example.com/api');
      expect(entries[0].response.status).toBe(200);
      capture.stop();
    });

    it('요청 메서드와 URL을 정확히 기록한다', async () => {
      vi.stubGlobal('fetch', makeMockFetch(201));
      const capture = new NetworkCapture(100, []);
      capture.start();

      await window.fetch('https://api.example.com/users', { method: 'POST', body: '{"name":"test"}' });

      const entry = capture.snapshot()[0];
      expect(entry.request.method).toBe('POST');
      expect(entry.request.url).toBe('https://api.example.com/users');
      expect(entry.response.status).toBe(201);
      capture.stop();
    });

    it('요청 body가 있으면 postData를 기록한다', async () => {
      vi.stubGlobal('fetch', makeMockFetch());
      const capture = new NetworkCapture(100, []);
      capture.start();

      await window.fetch('https://example.com', {
        method: 'POST',
        body: '{"key":"value"}',
        headers: { 'content-type': 'application/json' },
      });

      const entry = capture.snapshot()[0];
      expect(entry.request.postData?.text).toBe('{"key":"value"}');
      capture.stop();
    });

    it('쿼리스트링을 파싱하여 queryString에 기록한다', async () => {
      vi.stubGlobal('fetch', makeMockFetch());
      const capture = new NetworkCapture(100, []);
      capture.start();

      await window.fetch('https://example.com/search?q=hello&page=2');

      const entry = capture.snapshot()[0];
      expect(entry.request.queryString).toEqual(
        expect.arrayContaining([
          { name: 'q', value: 'hello' },
          { name: 'page', value: '2' },
        ]),
      );
      capture.stop();
    });

    it('지정된 요청 헤더를 마스킹한다', async () => {
      vi.stubGlobal('fetch', makeMockFetch());
      const capture = new NetworkCapture(100, ['Authorization']);
      capture.start();

      await window.fetch('https://example.com', {
        headers: { Authorization: 'Bearer secret-token' },
      });

      const entry = capture.snapshot()[0];
      const authHeader = entry.request.headers.find(
        (h) => h.name.toLowerCase() === 'authorization',
      );
      expect(authHeader?.value).toBe('[MASKED]');
      capture.stop();
    });

    it('요청 body와 URL 쿼리의 민감 키 값을 마스킹한다', async () => {
      vi.stubGlobal('fetch', makeMockFetch());
      const capture = new NetworkCapture(100, [], { maskKeys: ['password', 'token'] });
      capture.start();

      const body = '{"id":"kim","password":"pw"}';
      await window.fetch('https://example.com/login?access_token=abc&lang=ko', {
        method: 'POST',
        body,
        headers: { 'content-type': 'application/json' },
      });

      const entry = capture.snapshot()[0];
      expect(entry.request.url).toBe('https://example.com/login?access_token=[MASKED]&lang=ko');
      expect(entry.request.queryString).toEqual([
        { name: 'access_token', value: '[MASKED]' },
        { name: 'lang', value: 'ko' },
      ]);
      expect(entry.request.postData?.text).toBe('{"id":"kim","password":"[MASKED]"}');
      expect(entry.request.bodySize).toBe(body.length); // 크기는 원본 기준
      capture.stop();
    });

    it('요청 URL fragment의 민감 키 값도 쿼리와 함께 마스킹한다', async () => {
      const mockFetch = makeMockFetch();
      vi.stubGlobal('fetch', mockFetch);
      const capture = new NetworkCapture(100, [], { maskKeys: ['token'] });
      capture.start();

      const url = 'https://example.com/callback?code=1&token=abc#access_token=xyz&token_type=bearer';
      await window.fetch(url);

      const entry = capture.snapshot()[0];
      expect(entry.request.url).toBe(
        'https://example.com/callback?code=1&token=[MASKED]#access_token=[MASKED]&token_type=bearer',
      );
      expect(entry.request.queryString).toEqual([
        { name: 'code', value: '1' },
        { name: 'token', value: '[MASKED]' },
      ]);
      expect(mockFetch).toHaveBeenCalledWith(url, undefined); // 실제 요청은 원본 URL
      capture.stop();
    });

    it('비동기로 채워지는 응답 body도 마스킹하고, 앱이 받는 응답은 원본 그대로다', async () => {
      const body = '{"access_token":"a","user":"kim"}';
      vi.stubGlobal('fetch', makeMockFetch(200, body));
      const capture = new NetworkCapture(100, [], { maskKeys: ['token'] });
      capture.start();

      const response = await window.fetch('https://example.com/oauth/token');
      await new Promise((r) => setTimeout(r, 0)); // body 비동기 캡처 대기

      expect(await response.json()).toEqual({ access_token: 'a', user: 'kim' });
      const entry = capture.snapshot()[0];
      expect(entry.response.content.text).toBe('{"access_token":"[MASKED]","user":"kim"}');
      // 디코딩한 본문 크기는 측정값, 네트워크로 받은(압축된) 크기는 페이지에서 알 수 없어 -1
      expect(entry.response.content.size).toBe(body.length);
      expect(entry.response.bodySize).toBe(-1);
      capture.stop();
    });

    it('응답 body를 content에 기록한다 (비동기로 채워짐)', async () => {
      vi.stubGlobal('fetch', makeMockFetch(200, '{"id":1}'));
      const capture = new NetworkCapture(100, []);
      capture.start();

      await window.fetch('https://example.com/api');
      await new Promise((r) => setTimeout(r, 0)); // body 비동기 캡처 대기

      const entry = capture.snapshot()[0];
      expect(entry.response.content.text).toBe('{"id":1}');
      expect(entry.response.content.size).toBe(8);
      expect(entry.response.bodySize).toBe(-1);
      capture.stop();
    });

    it('스트리밍 응답이어도 fetch가 body 완료를 기다리지 않고 즉시 resolve된다', async () => {
      // 절대 close되지 않는 스트림 — 기존 구현은 여기서 영원히 블로킹됨
      const neverEndingStream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: hello\n\n'));
        },
      });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        new Response(neverEndingStream, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        }),
      ));
      const capture = new NetworkCapture(100, []);
      capture.start();

      const response = await window.fetch('https://example.com/sse');

      expect(response.status).toBe(200);
      const entries = capture.snapshot();
      expect(entries).toHaveLength(1);
      expect(entries[0].response.status).toBe(200);
      capture.stop();
    });

    it('네트워크 실패 시 에러가 그대로 전파되고 status 0 엔트리가 기록된다', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
      const capture = new NetworkCapture(100, []);
      capture.start();

      await expect(window.fetch('https://example.com/down')).rejects.toThrow('Failed to fetch');

      const entries = capture.snapshot();
      expect(entries).toHaveLength(1);
      expect(entries[0].response.status).toBe(0);
      expect(entries[0].request.url).toBe('https://example.com/down');
      capture.stop();
    });

    it('Headers 인스턴스로 전달한 content-type도 postData.mimeType에 기록된다', async () => {
      vi.stubGlobal('fetch', makeMockFetch());
      const capture = new NetworkCapture(100, []);
      capture.start();

      await window.fetch('https://example.com', {
        method: 'POST',
        body: '{"a":1}',
        headers: new Headers({ 'Content-Type': 'application/json' }),
      });

      const entry = capture.snapshot()[0];
      expect(entry.request.postData?.mimeType).toBe('application/json');
      capture.stop();
    });

    it('경과 시간(time)이 0보다 크다', async () => {
      vi.stubGlobal('fetch', makeMockFetch());
      const capture = new NetworkCapture(100, []);
      capture.start();

      await window.fetch('https://example.com');

      expect(capture.snapshot()[0].time).toBeGreaterThanOrEqual(0);
      capture.stop();
    });

    it('ignoreUrls에 해당하는 요청은 기록하지 않고 나머지는 기록한다', async () => {
      const mockFetch = makeMockFetch(500);
      vi.stubGlobal('fetch', mockFetch);
      const endpoint = 'https://qa.example.com/upload?token=SECRET';
      const capture = new NetworkCapture(1, [], { ignoreUrls: [endpoint] });
      capture.start();

      await window.fetch('https://example.com/api');
      await window.fetch(endpoint, { method: 'POST', body: 'x' });
      await window.fetch(new Request(`${endpoint}#frag`, { method: 'POST' }));

      // 무시된 요청도 실제로는 전송되며, 순환 버퍼(최대 1건)에서 앱 요청을 밀어내지 않는다
      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(capture.snapshot().map((e) => e.request.url)).toEqual(['https://example.com/api']);
      capture.stop();
    });

    it('상대 경로 ignoreUrls는 페이지 URL 기준으로 해석해 비교한다', async () => {
      vi.stubGlobal('fetch', makeMockFetch());
      const capture = new NetworkCapture(100, [], { ignoreUrls: ['/qa/upload'] });
      capture.start();

      await window.fetch(new URL('/qa/upload', window.location.href).href, { method: 'POST' });
      await window.fetch(new URL('/qa/upload/other', window.location.href).href);

      expect(capture.snapshot().map((e) => new URL(e.request.url).pathname)).toEqual(['/qa/upload/other']);
      capture.stop();
    });
  });

  describe('XHR 인터셉터', () => {
    class MockXHR {
      static lastInstance: MockXHR | null = null;
      status = 200;
      statusText = 'OK';
      responseType = '';
      responseText = '{"ok":true}';
      sentBody: unknown = null;
      openedWith: { method: string; url: string } | null = null;
      headers: Record<string, string> = {};
      private listeners: Record<string, Array<() => void>> = {};

      constructor() { MockXHR.lastInstance = this; }
      open(method: string, url: string) { this.openedWith = { method, url }; }
      setRequestHeader(name: string, value: string) { this.headers[name] = value; }
      send(body?: unknown) {
        this.sentBody = body ?? null;
        (this.listeners['loadend'] ?? []).forEach((cb) => cb());
      }
      addEventListener(type: string, cb: () => void) {
        (this.listeners[type] ??= []).push(cb);
      }
      getAllResponseHeaders() { return 'content-type: application/json\r\n'; }
      getResponseHeader(name: string) {
        return name.toLowerCase() === 'content-type' ? 'application/json' : null;
      }
    }

    let originalXHR: typeof XMLHttpRequest;

    beforeEach(() => {
      originalXHR = window.XMLHttpRequest;
      vi.stubGlobal('XMLHttpRequest', MockXHR as unknown as typeof XMLHttpRequest);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      window.XMLHttpRequest = originalXHR;
    });

    it('XHR 요청이 버퍼에 기록된다', () => {
      const capture = new NetworkCapture(100, []);
      capture.start();

      const xhr = new window.XMLHttpRequest();
      xhr.open('POST', 'https://example.com/api');
      xhr.setRequestHeader('content-type', 'application/json');
      xhr.send('{"key":"value"}');

      const entries = capture.snapshot();
      expect(entries).toHaveLength(1);
      expect(entries[0].request.method).toBe('POST');
      expect(entries[0].request.url).toBe('https://example.com/api');
      expect(entries[0].request.postData?.text).toBe('{"key":"value"}');
      expect(entries[0].response.status).toBe(200);
      expect(entries[0].response.content.text).toBe('{"ok":true}');
      capture.stop();
    });

    it('ignoreUrls에 해당하는 XHR 요청은 기록하지 않는다', () => {
      const capture = new NetworkCapture(100, [], { ignoreUrls: ['https://qa.example.com/upload'] });
      capture.start();

      const ignored = new window.XMLHttpRequest();
      ignored.open('POST', 'https://qa.example.com/upload');
      ignored.send('x');
      const kept = new window.XMLHttpRequest();
      kept.open('GET', 'https://example.com/api');
      kept.send();

      expect(capture.snapshot().map((e) => e.request.url)).toEqual(['https://example.com/api']);
      capture.stop();
    });

    it('실제 요청은 원본 XHR로 전달된다', () => {
      const capture = new NetworkCapture(100, []);
      capture.start();

      const xhr = new window.XMLHttpRequest();
      xhr.open('GET', 'https://example.com/data');
      xhr.send();

      const inner = MockXHR.lastInstance!;
      expect(inner.openedWith).toEqual({ method: 'GET', url: 'https://example.com/data' });
      capture.stop();
    });

    it('지정된 요청 헤더를 마스킹한다', () => {
      const capture = new NetworkCapture(100, ['Authorization']);
      capture.start();

      const xhr = new window.XMLHttpRequest();
      xhr.open('GET', 'https://example.com');
      xhr.setRequestHeader('Authorization', 'Bearer secret');
      xhr.send();

      const auth = capture.snapshot()[0].request.headers.find(
        (h) => h.name.toLowerCase() === 'authorization',
      );
      expect(auth?.value).toBe('[MASKED]');
      capture.stop();
    });

    it('요청 body·URL 쿼리와 응답 body의 민감 키 값을 마스킹한다', () => {
      const capture = new NetworkCapture(100, [], { maskKeys: ['password', 'token'] });
      capture.start();

      const xhr = new window.XMLHttpRequest();
      MockXHR.lastInstance!.responseText = '{"refreshToken":"r","ok":true}';
      xhr.open('POST', '/api/login?token=abc');
      xhr.setRequestHeader('content-type', 'application/x-www-form-urlencoded');
      xhr.send('user=kim&password=p%40ss');

      const entry = capture.snapshot()[0];
      expect(entry.request.url).toBe(`${location.origin}/api/login?token=[MASKED]`); // 페이지 기준 절대 URL
      expect(entry.request.queryString).toEqual([{ name: 'token', value: '[MASKED]' }]);
      expect(entry.request.postData?.text).toBe('user=kim&password=[MASKED]');
      expect(entry.response.content.text).toBe('{"refreshToken":"[MASKED]","ok":true}');
      expect(xhr.responseText).toBe('{"refreshToken":"r","ok":true}'); // 앱이 받는 응답은 원본
      capture.stop();
    });

    it('XHR 요청 URL의 해시 라우트 쿼리도 마스킹하고, 원본 XHR에는 원래 URL을 전달한다', () => {
      const capture = new NetworkCapture(100, [], { maskKeys: ['token'] });
      capture.start();

      const xhr = new window.XMLHttpRequest();
      xhr.open('GET', '/app?lang=ko#/reset?token=abc&step=2');
      xhr.send();

      expect(capture.snapshot()[0].request.url).toBe(`${location.origin}/app?lang=ko#/reset?token=[MASKED]&step=2`);
      expect(MockXHR.lastInstance!.openedWith?.url).toBe('/app?lang=ko#/reset?token=abc&step=2');
      capture.stop();
    });

    it('open()을 다시 호출하면 이전 헤더가 초기화된다', () => {
      const capture = new NetworkCapture(100, []);
      capture.start();

      const xhr = new window.XMLHttpRequest();
      xhr.open('GET', 'https://example.com/first');
      xhr.setRequestHeader('X-First', '1');
      xhr.open('GET', 'https://example.com/second');
      xhr.send();

      const entry = capture.snapshot()[0];
      expect(entry.request.url).toBe('https://example.com/second');
      expect(entry.request.headers).toHaveLength(0);
      capture.stop();
    });

    it('stop() 후 원본 XMLHttpRequest 생성자가 복원된다', () => {
      const capture = new NetworkCapture(100, []);
      capture.start();
      expect(window.XMLHttpRequest).not.toBe(MockXHR);

      capture.stop();
      expect(window.XMLHttpRequest).toBe(MockXHR as unknown as typeof XMLHttpRequest);
    });

    it('stop() 후에는 XHR 요청이 기록되지 않는다', () => {
      const capture = new NetworkCapture(100, []);
      capture.start();
      capture.stop();

      const xhr = new window.XMLHttpRequest();
      xhr.open('GET', 'https://example.com');
      xhr.send();

      expect(capture.snapshot()).toHaveLength(0);
    });

    it('원본 생성자의 커스텀 정적 멤버도 패치 후 조회된다', () => {
      const capture = new NetworkCapture(100, []);
      capture.start();

      new window.XMLHttpRequest();
      const Patched = window.XMLHttpRequest as unknown as typeof MockXHR;
      expect(Patched).not.toBe(MockXHR);
      expect(Patched.lastInstance).not.toBeNull();
      expect(Patched.lastInstance).toBe(MockXHR.lastInstance);
      capture.stop();
    });
  });

  describe('XHR 정적 멤버 (jsdom 원본 XMLHttpRequest)', () => {
    const STATE_CONSTANTS = ['UNSENT', 'OPENED', 'HEADERS_RECEIVED', 'LOADING', 'DONE'] as const;
    let originalXHR: typeof XMLHttpRequest;

    beforeEach(() => {
      originalXHR = window.XMLHttpRequest;
    });

    afterEach(() => {
      window.XMLHttpRequest = originalXHR;
    });

    it('start() 후에도 readyState 정적 상수 5개가 원본과 동일하다', () => {
      expect(STATE_CONSTANTS.map((k) => originalXHR[k])).toEqual([0, 1, 2, 3, 4]);

      const capture = new NetworkCapture(100, []);
      capture.start();

      expect(window.XMLHttpRequest).not.toBe(originalXHR);
      for (const key of STATE_CONSTANTS) {
        expect(window.XMLHttpRequest[key]).toBe(originalXHR[key]);
      }
      capture.stop();
    });

    it('start() 후에도 new XMLHttpRequest()는 instanceof XMLHttpRequest이다', () => {
      const capture = new NetworkCapture(100, []);
      capture.start();

      const xhr = new window.XMLHttpRequest();
      expect(xhr instanceof window.XMLHttpRequest).toBe(true);
      expect(xhr instanceof originalXHR).toBe(true);
      capture.stop();
    });

    it('호스트 앱의 readyState === XMLHttpRequest.OPENED 비교가 패치 후에도 동작한다', () => {
      const capture = new NetworkCapture(100, []);
      capture.start();

      const xhr = new window.XMLHttpRequest();
      expect(xhr.readyState).toBe(window.XMLHttpRequest.UNSENT);
      xhr.open('GET', 'https://example.com/data');
      expect(xhr.readyState).toBe(window.XMLHttpRequest.OPENED);
      capture.stop();
    });

    it('stop() 후 원본 생성자가 복원되고 정적 상수도 유지된다', () => {
      const capture = new NetworkCapture(100, []);
      capture.start();
      capture.stop();

      expect(window.XMLHttpRequest).toBe(originalXHR);
      expect(window.XMLHttpRequest.DONE).toBe(4);
    });
  });

  describe('순환 버퍼', () => {
    it('maxRequests를 초과하면 가장 오래된 항목을 제거한다', async () => {
      vi.stubGlobal('fetch', makeMockFetch());
      const capture = new NetworkCapture(2, []);
      capture.start();

      await window.fetch('https://example.com/1');
      await window.fetch('https://example.com/2');
      await window.fetch('https://example.com/3');

      const entries = capture.snapshot();
      expect(entries).toHaveLength(2);
      expect(entries[0].request.url).toBe('https://example.com/2');
      expect(entries[1].request.url).toBe('https://example.com/3');
      capture.stop();
    });

    it('maxRequests 이하일 때는 모든 항목을 유지한다', async () => {
      vi.stubGlobal('fetch', makeMockFetch());
      const capture = new NetworkCapture(5, []);
      capture.start();

      await window.fetch('https://example.com/1');
      await window.fetch('https://example.com/2');

      expect(capture.snapshot()).toHaveLength(2);
      capture.stop();
    });
  });

  describe('stop()', () => {
    it('stop() 후 원본 fetch가 복원된다', async () => {
      const mockFetch = makeMockFetch();
      vi.stubGlobal('fetch', mockFetch);
      const capture = new NetworkCapture(100, []);
      capture.start();

      expect(window.fetch).not.toBe(mockFetch);

      capture.stop();
      expect(window.fetch).toBe(mockFetch);
    });
  });

  describe('snapshot()', () => {
    it('snapshot()은 버퍼의 복사본을 반환한다', async () => {
      vi.stubGlobal('fetch', makeMockFetch());
      const capture = new NetworkCapture(100, []);
      capture.start();

      await window.fetch('https://example.com');

      const snap1 = capture.snapshot();
      const snap2 = capture.snapshot();
      expect(snap1).not.toBe(snap2); // 다른 배열 참조
      expect(snap1).toEqual(snap2);  // 동일한 내용
      capture.stop();
    });
  });

  describe('_offsetMs', () => {
    it('start() 이후 요청에 _offsetMs가 기록된다', async () => {
      vi.stubGlobal('fetch', makeMockFetch());
      const capture = new NetworkCapture(100, []);
      capture.start();

      await window.fetch('https://example.com');

      const entry = capture.snapshot()[0];
      expect(entry._offsetMs).toBeGreaterThanOrEqual(0);
      capture.stop();
    });
  });

  describe('restoreEntries()', () => {
    it('restoreEntries()는 엔트리를 버퍼 앞에 추가한다', async () => {
      vi.stubGlobal('fetch', makeMockFetch());
      const capture = new NetworkCapture(100, []);
      capture.start();
      await window.fetch('https://example.com/new');

      const old = capture.snapshot()[0];
      capture.clearBuffer();

      await window.fetch('https://example.com/after');
      capture.restoreEntries([old]);

      const entries = capture.snapshot();
      expect(entries[0].request.url).toBe('https://example.com/new');
      expect(entries[1].request.url).toBe('https://example.com/after');
      capture.stop();
    });

    it('restoreEntries() 후 maxRequests를 초과하면 오래된 항목이 제거된다', async () => {
      const capture = new NetworkCapture(2, []);
      capture.start();
      const fakeEntries = [1, 2, 3].map(i => ({
        startedDateTime: new Date().toISOString(),
        time: 10, _offsetMs: i * 100,
        request: { method: 'GET', url: `https://example.com/${i}`, httpVersion: 'HTTP/1.1', headers: [], queryString: [], bodySize: -1, headersSize: -1 },
        response: { status: 200, statusText: 'OK', httpVersion: 'HTTP/1.1', headers: [], content: { size: 0, mimeType: 'text/plain' }, bodySize: 0, headersSize: -1 },
        timings: { send: 0, wait: 10, receive: 0 },
      }));
      capture.restoreEntries(fakeEntries);
      expect(capture.snapshot()).toHaveLength(2);
      capture.stop();
    });
  });

  describe('clearBuffer()', () => {
    it('clearBuffer() 호출 후 버퍼가 비워진다', async () => {
      vi.stubGlobal('fetch', makeMockFetch());
      const capture = new NetworkCapture(100, []);
      capture.start();

      await window.fetch('https://example.com/before');
      expect(capture.snapshot()).toHaveLength(1);

      capture.clearBuffer();
      expect(capture.snapshot()).toHaveLength(0);
      capture.stop();
    });

    it('clearBuffer() 이후 추가된 요청만 버퍼에 남는다', async () => {
      vi.stubGlobal('fetch', makeMockFetch());
      const capture = new NetworkCapture(100, []);
      capture.start();

      await window.fetch('https://example.com/before');
      capture.clearBuffer();
      await window.fetch('https://example.com/after');

      const entries = capture.snapshot();
      expect(entries).toHaveLength(1);
      expect(entries[0].request.url).toBe('https://example.com/after');
      capture.stop();
    });
  });
});

describe('NetworkCapture 세션과 저장 구간', () => {
  const nativeFetch = window.fetch;
  const nativeXHR = window.XMLHttpRequest;

  afterEach(() => {
    window.fetch = nativeFetch;
    window.XMLHttpRequest = nativeXHR;
    vi.unstubAllGlobals();
  });

  /** 응답을 원하는 시점에 돌려줄 수 있는 fetch */
  function deferredFetch() {
    const pending: ((r: Response) => void)[] = [];
    const fn = vi.fn(() => new Promise<Response>((resolve) => { pending.push(resolve); }));
    return { fn: fn as unknown as typeof fetch, pending };
  }

  it('생성 이후에 바뀐 fetch를 start() 시점의 원본으로 쓰고 stop()에서 그것으로 되돌린다', async () => {
    const capture = new NetworkCapture(100, []);
    const later = makeMockFetch();
    window.fetch = later as unknown as typeof fetch;
    capture.start();
    await window.fetch('https://example.com/a');
    expect(later).toHaveBeenCalledOnce();
    capture.stop();
    expect(window.fetch).toBe(later);
  });

  it('stop() 후에 끝난 요청은 기록하지 않는다', async () => {
    const { fn, pending } = deferredFetch();
    window.fetch = fn;
    const capture = new NetworkCapture(100, []);
    capture.start();
    const request = window.fetch('https://example.com/slow');
    capture.stop();
    pending[0](new Response('{}'));
    await request;
    expect(capture.snapshot()).toEqual([]);
  });

  it('다시 start()한 세션에는 이전 세션에 시작한 요청이 들어가지 않는다', async () => {
    const { fn, pending } = deferredFetch();
    window.fetch = fn;
    const capture = new NetworkCapture(100, []);
    capture.start();
    const old = window.fetch('https://example.com/old');
    capture.stop();
    capture.start();
    const fresh = window.fetch('https://example.com/fresh');
    pending[0](new Response('{}'));
    pending[1](new Response('{}'));
    await Promise.all([old, fresh]);
    expect(capture.snapshot().map((e) => e.request.url)).toEqual(['https://example.com/fresh']);
    capture.stop();
  });

  it('stop()은 그 위에 다른 코드가 감싼 fetch를 지우지 않고, 남은 패치는 기록 없이 원본만 호출한다', async () => {
    const appFetch = makeMockFetch();
    window.fetch = appFetch as unknown as typeof fetch;
    const capture = new NetworkCapture(100, []);
    capture.start();
    const ours = window.fetch;
    const outer = ((...args: Parameters<typeof fetch>) => ours(...args)) as typeof fetch;
    window.fetch = outer;

    capture.stop();
    expect(window.fetch).toBe(outer);
    await window.fetch('https://example.com/after-stop');
    expect(appFetch).toHaveBeenCalledOnce();
    expect(capture.snapshot()).toEqual([]);

    // 다시 시작해도 남은 이전 패치가 중복으로 기록하지 않는다
    capture.start();
    await window.fetch('https://example.com/again');
    expect(capture.snapshot()).toHaveLength(1);
    capture.stop();
  });

  it('discard()는 저장한 엔트리만 빼고 그 뒤에 기록된 엔트리는 남긴다', async () => {
    vi.stubGlobal('fetch', makeMockFetch());
    const capture = new NetworkCapture(100, []);
    capture.start();
    await window.fetch('https://example.com/saved');
    const saved = capture.snapshot();
    await window.fetch('https://example.com/during-save');

    capture.discard(saved);
    expect(capture.snapshot().map((e) => e.request.url)).toEqual(['https://example.com/during-save']);
    capture.stop();
  });

  it('저장하는 동안 maxRequests를 넘어도 버퍼는 maxRequests개를 넘지 않는다', async () => {
    vi.stubGlobal('fetch', makeMockFetch());
    const capture = new NetworkCapture(3, []);
    capture.start();
    for (let i = 0; i < 3; i++) await window.fetch(`https://example.com/saved/${i}`);
    const saved = capture.snapshot();
    for (let i = 0; i < 5; i++) await window.fetch(`https://example.com/new/${i}`);
    expect(capture.snapshot()).toHaveLength(3);
    capture.discard(saved);
    expect(capture.snapshot().map((e) => e.request.url)).toEqual([
      'https://example.com/new/2', 'https://example.com/new/3', 'https://example.com/new/4',
    ]);
    capture.stop();
  });

  it('rebase()는 남은 엔트리의 _offsetMs를 새 기준 시각으로 다시 계산한다', () => {
    const capture = new NetworkCapture(100, []);
    capture.restoreEntries([{
      startedDateTime: '2026-01-01T00:00:05.000Z', time: 1,
      request: { method: 'GET', url: 'https://example.com', httpVersion: '', headers: [], queryString: [], bodySize: 0, headersSize: -1 },
      response: { status: 200, statusText: '', httpVersion: '', headers: [], content: { size: 0, mimeType: '' }, bodySize: -1, headersSize: -1 },
      timings: { send: 0, wait: 1, receive: 0 },
      _offsetMs: 99_999,
    }]);
    capture.rebase(new Date('2026-01-01T00:00:02.000Z'));
    expect(capture.snapshot()[0]._offsetMs).toBe(3000);
  });

  it('요청 body 크기는 보낸 바이트 수로, 알 수 없는 본문(FormData)은 -1로 기록한다', async () => {
    vi.stubGlobal('fetch', makeMockFetch());
    const capture = new NetworkCapture(100, []);
    capture.start();
    await window.fetch('https://example.com/a', { method: 'POST', body: '가나' });
    await window.fetch('https://example.com/b', { method: 'POST', body: new Blob(['12345']) });
    await window.fetch('https://example.com/c', { method: 'POST', body: new FormData() });
    await window.fetch('https://example.com/d');
    expect(capture.snapshot().map((e) => e.request.bodySize)).toEqual([6, 5, -1, 0]);
    expect(capture.snapshot().map((e) => e.request.httpVersion)).toEqual(['', '', '', '']);
    capture.stop();
  });

  it('XHR: stop() 후에 끝난 요청은 기록하지 않는다', () => {
    let listener: (() => void) | undefined;
    class SlowXHR {
      status = 200; statusText = 'OK'; responseText = ''; responseType = '';
      open() {} setRequestHeader() {} send() {}
      addEventListener(_: string, cb: () => void) { listener = cb; }
      getAllResponseHeaders() { return ''; }
      getResponseHeader() { return null; }
    }
    window.XMLHttpRequest = SlowXHR as unknown as typeof XMLHttpRequest;
    const capture = new NetworkCapture(100, []);
    capture.start();
    const xhr = new window.XMLHttpRequest();
    xhr.open('GET', 'https://example.com/slow');
    xhr.send();
    capture.stop();
    listener!();
    expect(capture.snapshot()).toEqual([]);
  });
});

describe('NetworkCapture XHR URL', () => {
  const nativeXHR = window.XMLHttpRequest;
  afterEach(() => { window.XMLHttpRequest = nativeXHR; });

  it('상대 경로로 연 XHR도 fetch처럼 페이지 기준의 절대 URL로 기록하고, 원본 XHR에는 받은 그대로 넘긴다', () => {
    const opened: string[] = [];
    let loadend: (() => void) | undefined;
    class FakeXHR {
      status = 200; statusText = 'OK'; responseText = '{}'; responseType = '';
      open(_m: string, u: string) { opened.push(u); }
      setRequestHeader() {}
      send() { loadend?.(); }
      addEventListener(_: string, cb: () => void) { loadend = cb; }
      getAllResponseHeaders() { return 'content-type: application/json\r\n'; }
      getResponseHeader() { return 'application/json'; }
    }
    window.XMLHttpRequest = FakeXHR as unknown as typeof XMLHttpRequest;
    const capture = new NetworkCapture(100, []);
    capture.start();
    const xhr = new window.XMLHttpRequest();
    xhr.open('POST', '/api/echo?x=1');
    xhr.send('{}');
    capture.stop();

    expect(opened).toEqual(['/api/echo?x=1']);
    expect(capture.snapshot()[0].request.url).toBe(new URL('/api/echo?x=1', window.location.href).href);
  });
});

describe('NetworkCapture 응답 본문 기록 상태', () => {
  const nativeFetch = window.fetch;
  afterEach(() => { window.fetch = nativeFetch; });

  function openBody() {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });
    return {
      response: new Response(stream, { headers: { 'content-type': 'text/plain' } }),
      push: (t: string) => controller.enqueue(new TextEncoder().encode(t)),
      end: () => controller.close(),
    };
  }

  it('받는 중에는 pending, 끝나면 complete — markPendingBodies는 받은 부분을 담는다', async () => {
    const body = openBody();
    window.fetch = vi.fn(async () => body.response) as unknown as typeof fetch;
    const capture = new NetworkCapture(100, [], { maxBodySize: 1_000 });
    capture.start();
    await window.fetch('https://example.com/a');
    body.push('hello ');
    await new Promise((r) => setTimeout(r, 10));
    const [entry] = capture.snapshot();
    expect(entry.response.content._bodyStatus).toBe('pending');

    expect([...capture.markPendingBodies([entry])]).toEqual([entry]);
    expect(entry.response.content.text).toBe('hello ');

    body.push('world');
    body.end();
    await capture.waitForBodies([entry], 1_000);
    expect(entry.response.content._bodyStatus).toBe('complete');
    expect(entry.response.content.text).toBe('hello world');
    expect(capture.markPendingBodies([entry]).size).toBe(0);
    capture.stop();
  });

  it('waitForBodies는 timeout이나 취소 신호에서 끝난다', async () => {
    const body = openBody();
    window.fetch = vi.fn(async () => body.response) as unknown as typeof fetch;
    const capture = new NetworkCapture(100, []);
    capture.start();
    await window.fetch('https://example.com/never');
    const entries = capture.snapshot();

    const t0 = Date.now();
    await capture.waitForBodies(entries, 50);
    expect(Date.now() - t0).toBeLessThan(500);

    const controller = new AbortController();
    const waiting = capture.waitForBodies(entries, 60_000, controller.signal);
    controller.abort();
    await waiting;
    expect(entries[0].response.content._bodyStatus).toBe('pending');
    capture.stop();
    expect(entries[0].response.content._bodyStatus).toBe('aborted');
  });

  it('maxRequests를 넘어 버퍼에서 밀려난 요청은 본문 읽기를 취소한다 (aborted)', async () => {
    const bodies = [openBody(), openBody()];
    let i = 0;
    window.fetch = vi.fn(async () => bodies[i++].response) as unknown as typeof fetch;
    const capture = new NetworkCapture(1, []);
    capture.start();
    await window.fetch('https://example.com/first');
    const [first] = capture.snapshot();
    await window.fetch('https://example.com/second');
    expect(first.response.content._bodyStatus).toBe('aborted');
    bodies[0].push('late');
    bodies[0].end();
    await new Promise((r) => setTimeout(r, 10));
    expect(first.response.content._bodyStatus).toBe('aborted');
    capture.stop();
  });

  it('백업에서 복원한 pending 엔트리는 더 받을 수 없으므로 aborted로 바꾼다', () => {
    const capture = new NetworkCapture(100, []);
    capture.restoreEntries([{
      startedDateTime: new Date().toISOString(), time: 1,
      request: { method: 'GET', url: 'https://example.com', httpVersion: '', headers: [], queryString: [], bodySize: 0, headersSize: -1 },
      response: {
        status: 200, statusText: '', httpVersion: '', headers: [], bodySize: -1, headersSize: -1,
        content: { size: -1, mimeType: 'text/plain', text: 'part', _bodyStatus: 'pending' },
      },
      timings: { send: 0, wait: 1, receive: 0 },
    }]);
    expect(capture.snapshot()[0].response.content._bodyStatus).toBe('aborted');
  });

  it('XHR은 loadend에서 본문이 끝나므로 complete·truncated·binary로 기록한다', () => {
    const nativeXHR = window.XMLHttpRequest;
    let loadend: (() => void) | undefined;
    let responseText = '';
    let responseType = '';
    class FakeXHR {
      status = 200; statusText = 'OK';
      get responseText() { return responseText; }
      get responseType() { return responseType; }
      response = new ArrayBuffer(3);
      open() {} setRequestHeader() {}
      send() { loadend?.(); }
      addEventListener(_: string, cb: () => void) { loadend = cb; }
      getAllResponseHeaders() { return ''; }
      getResponseHeader() { return 'text/plain'; }
    }
    window.XMLHttpRequest = FakeXHR as unknown as typeof XMLHttpRequest;
    try {
      const capture = new NetworkCapture(100, [], { maxBodySize: 5 });
      capture.start();
      const send = () => { const x = new window.XMLHttpRequest(); x.open('GET', 'https://example.com/x'); x.send(); };
      responseText = 'ok'; send();
      responseText = 'too long'; send();
      responseType = 'arraybuffer'; send();
      expect(capture.snapshot().map((e) => e.response.content._bodyStatus)).toEqual(['complete', 'truncated', 'binary']);
      capture.stop();
    } finally {
      window.XMLHttpRequest = nativeXHR;
    }
  });
});
