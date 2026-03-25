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

    it('응답 body를 content에 기록한다', async () => {
      vi.stubGlobal('fetch', makeMockFetch(200, '{"id":1}'));
      const capture = new NetworkCapture(100, []);
      capture.start();

      await window.fetch('https://example.com/api');

      const entry = capture.snapshot()[0];
      expect(entry.response.content.text).toBe('{"id":1}');
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
