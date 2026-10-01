import { describe, it, expect, afterEach, vi } from 'vitest';
import { NetworkCapture } from '../NetworkCapture.js';
import { MaskingFilter } from '../MaskingFilter.js';
import { isBinaryMime, readLimitedText } from '../bodyLimit.js';

const NOTE = '\n…[truncated by qa-recorder: kept the first';

/** 청크를 하나씩 내보내고, 다 내보낸 뒤에도 닫히지 않는(endless=true) 스트림. 몇 번 읽혔는지 센다 */
function chunkedStream(chunks: string[], endless = false) {
  const encoder = new TextEncoder();
  const state = { pulls: 0, cancelled: false };
  let i = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      state.pulls++;
      if (i < chunks.length) controller.enqueue(encoder.encode(chunks[i++]));
      else if (endless) controller.enqueue(encoder.encode('data: ping\n\n'));
      else controller.close();
    },
    cancel() { state.cancelled = true; },
  });
  return { stream, state };
}

function stubFetch(response: Response) {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function captureFetch(capture: NetworkCapture, url = 'https://example.com/api', init?: RequestInit) {
  capture.start();
  const response = await window.fetch(url, init);
  await vi.waitFor(() => expect(capture.snapshot()[0]?.response.content.text).not.toBe(''));
  return { entry: capture.snapshot()[0], response };
}

describe('body 크기 제한', () => {
  const originalFetch = window.fetch;
  afterEach(() => {
    vi.unstubAllGlobals();
    window.fetch = originalFetch;
  });

  describe('fetch 응답', () => {
    it('maxBodySize보다 긴 응답은 앞부분만 저장하고 잘렸다고 표시한다', async () => {
      stubFetch(new Response('x'.repeat(50), { headers: { 'content-type': 'text/plain' } }));
      const capture = new NetworkCapture(100, [], { maxBodySize: 10 });
      const { entry } = await captureFetch(capture);
      expect(entry.response.content.text).toBe('x'.repeat(10) + NOTE + ' 10 characters]');
      capture.stop();
    });

    it('끝나지 않는 스트림(SSE)도 상한까지만 읽고 읽기를 취소한다 — 앱이 받는 원본 응답은 그대로다', async () => {
      const { stream, state } = chunkedStream(['data: hello\n\n'], true);
      stubFetch(new Response(stream, { headers: { 'content-type': 'text/event-stream' } }));
      const capture = new NetworkCapture(100, [], { maxBodySize: 64 });
      const { entry, response } = await captureFetch(capture);

      expect(entry.response.content.text.startsWith('data: hello\n\ndata: ping')).toBe(true);
      expect(entry.response.content.text).toContain(NOTE);
      expect(entry.response.content.size).toBe(-1); // 끝까지 읽지 않아 크기를 모름
      const pullsAfterCapture = state.pulls;
      await new Promise((r) => setTimeout(r, 20));
      expect(state.pulls).toBe(pullsAfterCapture); // 캡처 쪽은 더 읽지 않는다

      // 앱 쪽 스트림은 계속 읽을 수 있다
      const reader = response.body!.getReader();
      const first = await reader.read();
      expect(new TextDecoder().decode(first.value)).toBe('data: hello\n\n');
      await reader.cancel();
      capture.stop();
    });

    it('잘린 JSON 응답도 읽은 데까지 민감 키를 가린다', async () => {
      const body = JSON.stringify({ user: 'kim', token: 'SECRET-TOKEN-VALUE', items: 'x'.repeat(100) });
      stubFetch(new Response(body, { headers: { 'content-type': 'application/json', 'content-length': String(body.length) } }));
      const capture = new NetworkCapture(100, [], { maskKeys: ['token'], maxBodySize: 60 });
      const { entry } = await captureFetch(capture);

      expect(entry.response.content.text).not.toContain('SECRET-TOKEN-VALUE');
      expect(entry.response.content.text.startsWith('{"user":"kim","token":"[MASKED]","items":"xxx')).toBe(true);
      expect(entry.response.content.size).toBe(body.length); // Content-Length 사용
      capture.stop();
    });

    it('상한 안의 응답은 그대로 두고 maskBody로 가린다', async () => {
      stubFetch(new Response('{"token":"abc","ok":true}', { headers: { 'content-type': 'application/json' } }));
      const capture = new NetworkCapture(100, [], { maskKeys: ['token'], maxBodySize: 1000 });
      const { entry } = await captureFetch(capture);
      expect(entry.response.content.text).toBe('{"token":"[MASKED]","ok":true}');
      expect(entry.response.content.size).toBe(25);
      capture.stop();
    });

    it('바이너리 응답(이미지 등)은 읽지 않고 [binary]로 기록한다', async () => {
      const { stream, state } = chunkedStream(['\u0089PNG...']);
      stubFetch(new Response(stream, { headers: { 'content-type': 'image/png' } }));
      const capture = new NetworkCapture(100, []);
      const { entry } = await captureFetch(capture);
      expect(entry.response.content.text).toBe('[binary]');
      expect(state.pulls).toBeLessThanOrEqual(1); // 캡처가 읽지 않음 (스트림 시작 시 1회 pull은 브라우저 동작)
      capture.stop();
    });

    it('maxBodySize 0이면 응답 body를 저장하지 않는다', async () => {
      stubFetch(new Response('{"a":1}', { headers: { 'content-type': 'application/json' } }));
      const capture = new NetworkCapture(100, [], { maxBodySize: 0 });
      capture.start();
      await window.fetch('https://example.com/api');
      await new Promise((r) => setTimeout(r, 10));
      expect(capture.snapshot()[0].response.content.text).toBe('');
      capture.stop();
    });

    it('maxBodySize를 지정하지 않으면 자르지 않는다', async () => {
      const long = 'y'.repeat(300_000);
      stubFetch(new Response(long, { headers: { 'content-type': 'text/plain' } }));
      const capture = new NetworkCapture(100, []);
      const { entry } = await captureFetch(capture);
      expect(entry.response.content.text).toBe(long);
      capture.stop();
    });
  });

  describe('요청 body', () => {
    it('긴 요청 body는 가린 다음 자른다', async () => {
      stubFetch(new Response('ok', { headers: { 'content-type': 'text/plain' } }));
      const capture = new NetworkCapture(100, [], { maskKeys: ['password'], maxBodySize: 40 });
      const body = JSON.stringify({ password: 'PW-SECRET', blob: 'z'.repeat(100) });
      const { entry } = await captureFetch(capture, 'https://example.com/login', {
        method: 'POST', body, headers: { 'content-type': 'application/json' },
      });
      const text = entry.request.postData!.text;
      expect(text).not.toContain('PW-SECRET');
      expect(text.startsWith('{"password":"[MASKED]","blob":"zzz')).toBe(true);
      expect(text).toContain(`${NOTE} 40 of`);
      expect(entry.request.bodySize).toBe(body.length);
      capture.stop();
    });
  });

  describe('XHR 응답', () => {
    class LongXHR {
      status = 200; statusText = 'OK'; responseType = ''; responseText = '';
      contentType = 'application/json';
      private listeners: Record<string, Array<() => void>> = {};
      open() {}
      setRequestHeader() {}
      send() { (this.listeners.loadend ?? []).forEach((cb) => cb()); }
      addEventListener(type: string, cb: () => void) { (this.listeners[type] ??= []).push(cb); }
      getAllResponseHeaders() { return `content-type: ${this.contentType}\r\n`; }
      getResponseHeader() { return this.contentType; }
    }

    it('긴 XHR 응답은 전체를 가린 다음 자른다', () => {
      vi.stubGlobal('XMLHttpRequest', LongXHR as unknown as typeof XMLHttpRequest);
      const capture = new NetworkCapture(100, [], { maskKeys: ['token'], maxBodySize: 30 });
      capture.start();
      const xhr = new window.XMLHttpRequest() as unknown as LongXHR;
      xhr.responseText = JSON.stringify({ token: 'XHR-SECRET', data: 'd'.repeat(100) });
      (xhr as unknown as XMLHttpRequest).open('GET', 'https://example.com/x');
      (xhr as unknown as XMLHttpRequest).send();
      const text = capture.snapshot()[0].response.content.text!;
      expect(text).not.toContain('XHR-SECRET');
      expect(text.startsWith('{"token":"[MASKED]"')).toBe(true);
      expect(text).toContain(`${NOTE} 30 of`);
      capture.stop();
    });

    it('바이너리 MIME의 XHR 응답은 [binary]로 기록한다', () => {
      vi.stubGlobal('XMLHttpRequest', LongXHR as unknown as typeof XMLHttpRequest);
      const capture = new NetworkCapture(100, []);
      capture.start();
      const xhr = new window.XMLHttpRequest() as unknown as LongXHR;
      xhr.contentType = 'application/pdf';
      xhr.responseText = '%PDF-1.7 ...';
      (xhr as unknown as XMLHttpRequest).open('GET', 'https://example.com/file.pdf');
      (xhr as unknown as XMLHttpRequest).send();
      expect(capture.snapshot()[0].response.content.text).toBe('[binary]');
      capture.stop();
    });
  });
});

describe('isBinaryMime', () => {
  it.each([
    ['image/png', true], ['image/svg+xml', false], ['video/mp4', true], ['audio/mpeg', true], ['font/woff2', true],
    ['application/pdf', true], ['application/octet-stream; charset=binary', true], ['application/zip', true],
    ['application/json', false], ['text/event-stream', false], ['', false],
  ])('%s → %s', (mime, expected) => {
    expect(isBinaryMime(mime)).toBe(expected);
  });
});

describe('readLimitedText', () => {
  it('여러 바이트로 된 UTF-8 문자가 청크 경계에서 나뉘어도 올바르게 디코딩한다', async () => {
    const bytes = new TextEncoder().encode('가나다');
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 2));
        controller.enqueue(bytes.slice(2));
        controller.close();
      },
    });
    await expect(readLimitedText(new Response(stream), 100)).resolves.toEqual({ text: '가나다', truncated: false });
  });
});

describe('MaskingFilter.maskTruncatedBody', () => {
  const matcher = MaskingFilter.createKeyMatcher(['token', 'password']);
  const mask = (text: string, mime = 'application/json') => MaskingFilter.maskTruncatedBody(text, mime, matcher);

  it('민감 키의 값이 잘린 끝까지 이어지면 거기서 끝내고 가린다', () => {
    expect(mask('{"user":"a","token":"sec')).toBe('{"user":"a","token":"[MASKED]"');
  });

  it('완전한 값은 가리고 나머지는 그대로 둔다 (객체·숫자 값 포함)', () => {
    expect(mask('{"token":{"access":"A","refresh":"R"},"n":1,"accessToken":12345,"rest":"x')).toBe(
      '{"token":"[MASKED]","n":1,"accessToken":"[MASKED]","rest":"x',
    );
  });

  it('배열 안의 객체도 가린다', () => {
    expect(mask('[{"password":"p1"},{"password":"p2"},{"na')).toBe('[{"password":"[MASKED]"},{"password":"[MASKED]"},{"na');
  });

  it('null과 빈 문자열 값은 유지한다', () => {
    expect(mask('{"token":null,"password":"","x":"y')).toBe('{"token":null,"password":"","x":"y');
  });

  it('문자열 값 안의 따옴표나 키처럼 보이는 텍스트는 키로 보지 않는다', () => {
    expect(mask('{"note":"he said \\"token\\": x","token":"abc","z":"')).toBe(
      '{"note":"he said \\"token\\": x","token":"[MASKED]","z":"',
    );
  });

  it('민감 키가 없으면 원문을 그대로 둔다', () => {
    const text = '{"a":"b","c":[1,2,3';
    expect(mask(text)).toBe(text);
  });

  it('form 형식은 필드 단위로 가린다', () => {
    expect(mask('a=1&token=abc&b=x', 'application/x-www-form-urlencoded')).toBe('a=1&token=[MASKED]&b=x');
  });

  it('matcher가 없으면 원문을 그대로 둔다', () => {
    expect(MaskingFilter.maskTruncatedBody('{"token":"x', 'application/json', null)).toBe('{"token":"x');
  });
});
