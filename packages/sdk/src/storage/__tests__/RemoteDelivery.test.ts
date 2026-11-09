import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RemoteDelivery, UploadTimeoutError } from '../RemoteDelivery.js';
import { isAbortError } from '../../core/abort.js';
import type { HARDocument } from '../../types/har.js';

function makeHARLog(): HARDocument {
  return {
    log: {
      version: '1.2',
      creator: { name: 'qa-recorder', version: '0.1.0' },
      entries: [],
    },
  };
}

describe('RemoteDelivery.send', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('ok', { status: 200 })));
  });

  it('지정된 endpoint로 POST 요청을 전송한다', async () => {
    const delivery = new RemoteDelivery('https://example.com/upload');
    await delivery.send(new Blob(['[]'], { type: 'application/json' }), makeHARLog());

    expect(fetch).toHaveBeenCalledWith(
      'https://example.com/upload',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('session과 har 필드를 multipart/form-data로 전송한다', async () => {
    const delivery = new RemoteDelivery('https://example.com/upload');
    await delivery.send(new Blob(['[]'], { type: 'application/json' }), makeHARLog());

    const body: FormData = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get('session')).toBeInstanceOf(Blob);
    expect(body.get('har')).toBeInstanceOf(Blob);
  });

  it('session 파일명은 .rr.json 확장자를 가진다', async () => {
    const delivery = new RemoteDelivery('https://example.com/upload');
    await delivery.send(new Blob(['[]'], { type: 'application/json' }), makeHARLog());

    const body: FormData = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body;
    const sessionFile = body.get('session') as File;
    expect(sessionFile.name).toMatch(/\.rr\.json$/);
  });

  it('har 파일명은 .har 확장자를 가진다', async () => {
    const delivery = new RemoteDelivery('https://example.com/upload');
    await delivery.send(new Blob(['[]'], { type: 'application/json' }), makeHARLog());

    const body: FormData = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body;
    const harFile = body.get('har') as File;
    expect(harFile.name).toMatch(/\.har$/);
  });

  it('har 파일에 올바른 JSON이 담긴다', async () => {
    const delivery = new RemoteDelivery('https://example.com/upload');
    const harLog = makeHARLog();
    await delivery.send(new Blob(['[]'], { type: 'application/json' }), harLog);

    const body: FormData = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body;
    const harFile = body.get('har') as File;
    const text = await harFile.text();
    expect(JSON.parse(text)).toEqual(harLog);
  });

  it('서버 응답이 4xx이면 에러를 던진다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Not Found', { status: 404 })));
    const delivery = new RemoteDelivery('https://example.com/upload');
    await expect(
      delivery.send(new Blob(['[]'], { type: 'application/json' }), makeHARLog()),
    ).rejects.toThrow('Upload failed: 404');
  });

  it('서버 응답이 5xx이면 에러를 던진다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Error', { status: 500 })));
    const delivery = new RemoteDelivery('https://example.com/upload');
    await expect(
      delivery.send(new Blob(['[]'], { type: 'application/json' }), makeHARLog()),
    ).rejects.toThrow('Upload failed: 500');
  });

  it('서버 응답 JSON에 url이 있으면 반환한다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ url: 'https://example.com/share/abc123' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    const delivery = new RemoteDelivery('https://example.com/upload');
    const url = await delivery.send(new Blob(['[]'], { type: 'application/json' }), makeHARLog());
    expect(url).toBe('https://example.com/share/abc123');
  });

  it('서버 응답 JSON에 url이 없으면 undefined를 반환한다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('ok', { status: 200 })),
    );
    const delivery = new RemoteDelivery('https://example.com/upload');
    const url = await delivery.send(new Blob(['[]'], { type: 'application/json' }), makeHARLog());
    expect(url).toBeUndefined();
  });

  it('sessionBlob이 null이면 session 필드 없이 har만 전송한다', async () => {
    const delivery = new RemoteDelivery('https://example.com/upload');
    await delivery.send(null, makeHARLog());

    const body: FormData = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body;
    expect(body.get('session')).toBeNull();
    expect(body.get('har')).toBeInstanceOf(Blob);
  });

  it('memo가 있으면 FormData에 포함된다', async () => {
    const delivery = new RemoteDelivery('https://example.com/upload');
    await delivery.send(null, makeHARLog(), '결제 오류 메모');

    const body: FormData = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body;
    expect(body.get('memo')).toBe('결제 오류 메모');
  });

  it('memo가 없으면 FormData에 memo 필드가 없다', async () => {
    const delivery = new RemoteDelivery('https://example.com/upload');
    await delivery.send(null, makeHARLog());

    const body: FormData = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body;
    expect(body.get('memo')).toBeNull();
  });

  describe('함께 보내는 파일', () => {
    const env = {
      url: 'https://app.example.com/page', userAgent: 'UA', language: 'ko-KR', timeZone: 'Asia/Seoul',
      viewport: { width: 1280, height: 720 }, screen: { width: 1920, height: 1080 },
      devicePixelRatio: 2, savedAt: '2026-10-01T00:00:00.000Z', sdkVersion: '1.12.0',
    };
    const consoleLogs = [{ timestamp: '2026-10-01T00:00:00.000Z', level: 'error' as const, message: 'boom', _offsetMs: 0 }];

    it('콘솔 로그, 통합 리포트, 환경 정보를 각각 console·report·env 필드로 보낸다', async () => {
      const delivery = new RemoteDelivery('https://example.com/upload');
      await delivery.send(null, makeHARLog(), 'memo', { consoleLogs, reportHtml: '<!DOCTYPE html><title>QA Report</title>', environment: env });

      const body: FormData = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body;
      const consoleFile = body.get('console') as File;
      expect(consoleFile.name).toMatch(/^qa-console-.*\.json$/);
      expect(JSON.parse(await consoleFile.text())).toEqual(consoleLogs);

      const report = body.get('report') as File;
      expect(report.name).toMatch(/^qa-report-.*\.html$/);
      expect(report.type).toBe('text/html');
      expect(await report.text()).toContain('<title>QA Report</title>');

      const envFile = body.get('env') as File;
      expect(envFile.name).toMatch(/^qa-env-.*\.json$/);
      expect(JSON.parse(await envFile.text())).toEqual(env);
      expect(body.get('memo')).toBe('memo');
    });

    it('넘기지 않은 파일은 보내지 않는다', async () => {
      const delivery = new RemoteDelivery('https://example.com/upload');
      await delivery.send(null, makeHARLog());
      const body: FormData = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body;
      expect(body.get('console')).toBeNull();
      expect(body.get('report')).toBeNull();
      expect(body.get('env')).toBeNull();
    });
  });
});

describe('RemoteDelivery.send — 시간 제한과 취소', () => {
  /** 신호로 취소될 때까지 끝나지 않는 fetch (실제 fetch처럼 AbortError로 끝난다) */
  function hangingFetch() {
    return vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_, reject) => {
      init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
  }

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('timeout을 넘기면 요청을 취소하고 UploadTimeoutError로 실패한다', async () => {
    vi.useFakeTimers();
    const fetchMock = hangingFetch();
    vi.stubGlobal('fetch', fetchMock);
    const promise = new RemoteDelivery('https://example.com/upload').send(null, makeHARLog(), '', {}, { timeout: 30_000 });
    const assertion = expect(promise).rejects.toMatchObject({ name: 'UploadTimeoutError', message: 'timed out after 30 s' });
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
    await expect(promise).rejects.toBeInstanceOf(UploadTimeoutError);
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal!.aborted).toBe(true);
  });

  it('응답 본문을 읽는 동안에도 timeout이 적용된다', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => Promise.resolve({
      ok: true,
      json: () => new Promise((_, reject) => {
        init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      }),
    } as unknown as Response)));
    const promise = new RemoteDelivery('https://example.com/upload').send(null, makeHARLog(), '', {}, { timeout: 1_000 });
    const assertion = expect(promise).rejects.toBeInstanceOf(UploadTimeoutError);
    await vi.advanceTimersByTimeAsync(1_000);
    await assertion;
  });

  it('호출한 쪽이 취소하면 AbortError로 실패한다 (시간 초과와 구분)', async () => {
    vi.stubGlobal('fetch', hangingFetch());
    const controller = new AbortController();
    const promise = new RemoteDelivery('https://example.com/upload')
      .send(null, makeHARLog(), '', {}, { timeout: 60_000, signal: controller.signal });
    controller.abort();
    const err = await promise.catch((e: unknown) => e);
    expect(isAbortError(err)).toBe(true);
    expect(err).not.toBeInstanceOf(UploadTimeoutError);
  });

  it('이미 취소된 신호면 요청을 보내지 않는다', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    controller.abort();
    const err = await new RemoteDelivery('https://example.com/upload')
      .send(null, makeHARLog(), '', {}, { signal: controller.signal }).catch((e: unknown) => e);
    expect(isAbortError(err)).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('timeout이 0이면 시간 제한 없이 기다린다', async () => {
    vi.useFakeTimers();
    let resolveFetch!: (r: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((r) => { resolveFetch = r; })));
    const promise = new RemoteDelivery('https://example.com/upload').send(null, makeHARLog(), '', {}, { timeout: 0 });
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    resolveFetch(new Response('{"url":"https://example.com/share/1"}'));
    await expect(promise).resolves.toBe('https://example.com/share/1');
  });

  it('응답의 url이 문자열이 아니면 무시한다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"url":{"x":1}}')));
    await expect(new RemoteDelivery('https://example.com/upload').send(null, makeHARLog())).resolves.toBeUndefined();
  });

  it('har 필드는 표준 HAR 문서({ log })를 그대로 담는다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')));
    const har = makeHARLog();
    await new RemoteDelivery('https://example.com/upload').send(null, har);
    const body = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as FormData;
    expect(JSON.parse(await (body.get('har') as Blob).text())).toEqual(har);
  });
});
