import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RemoteDelivery } from '../RemoteDelivery.js';
import type { HARLog } from '@qa-recorder/shared';

function makeHARLog(): HARLog {
  return {
    version: '1.2',
    creator: { name: 'qa-recorder', version: '0.1.0' },
    entries: [],
  };
}

describe('RemoteDelivery.send', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('ok', { status: 200 })));
  });

  it('지정된 endpoint로 POST 요청을 전송한다', async () => {
    const delivery = new RemoteDelivery('https://example.com/upload');
    await delivery.send(new Blob(['video'], { type: 'video/webm' }), makeHARLog());

    expect(fetch).toHaveBeenCalledWith(
      'https://example.com/upload',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('video와 har 필드를 multipart/form-data로 전송한다', async () => {
    const delivery = new RemoteDelivery('https://example.com/upload');
    await delivery.send(new Blob(['video'], { type: 'video/webm' }), makeHARLog());

    const body: FormData = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get('video')).toBeInstanceOf(Blob);
    expect(body.get('har')).toBeInstanceOf(Blob);
  });

  it('video 파일명은 .webm 확장자를 가진다', async () => {
    const delivery = new RemoteDelivery('https://example.com/upload');
    await delivery.send(new Blob(['video'], { type: 'video/webm' }), makeHARLog());

    const body: FormData = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body;
    const videoFile = body.get('video') as File;
    expect(videoFile.name).toMatch(/\.webm$/);
  });

  it('har 파일명은 .har 확장자를 가진다', async () => {
    const delivery = new RemoteDelivery('https://example.com/upload');
    await delivery.send(new Blob(['video'], { type: 'video/webm' }), makeHARLog());

    const body: FormData = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body;
    const harFile = body.get('har') as File;
    expect(harFile.name).toMatch(/\.har$/);
  });

  it('har 파일에 올바른 JSON이 담긴다', async () => {
    const delivery = new RemoteDelivery('https://example.com/upload');
    const harLog = makeHARLog();
    await delivery.send(new Blob(['video'], { type: 'video/webm' }), harLog);

    const body: FormData = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body;
    const harFile = body.get('har') as File;
    const text = await harFile.text();
    expect(JSON.parse(text)).toEqual(harLog);
  });

  it('서버 응답이 4xx이면 에러를 던진다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Not Found', { status: 404 })));
    const delivery = new RemoteDelivery('https://example.com/upload');
    await expect(
      delivery.send(new Blob(['video'], { type: 'video/webm' }), makeHARLog()),
    ).rejects.toThrow('Upload failed: 404');
  });

  it('서버 응답이 5xx이면 에러를 던진다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Error', { status: 500 })));
    const delivery = new RemoteDelivery('https://example.com/upload');
    await expect(
      delivery.send(new Blob(['video'], { type: 'video/webm' }), makeHARLog()),
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
    const url = await delivery.send(new Blob(['video'], { type: 'video/webm' }), makeHARLog());
    expect(url).toBe('https://example.com/share/abc123');
  });

  it('서버 응답 JSON에 url이 없으면 undefined를 반환한다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('ok', { status: 200 })),
    );
    const delivery = new RemoteDelivery('https://example.com/upload');
    const url = await delivery.send(new Blob(['video'], { type: 'video/webm' }), makeHARLog());
    expect(url).toBeUndefined();
  });
});
