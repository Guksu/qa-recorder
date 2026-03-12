import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LocalStorage } from '../LocalStorage.js';
import type { HARLog } from '@qa-recorder/shared';

function makeHARLog(): HARLog {
  return {
    version: '1.2',
    creator: { name: 'qa-recorder', version: '0.1.0' },
    entries: [],
  };
}

describe('LocalStorage.save', () => {
  let clickedLinks: { href: string; download: string }[];

  beforeEach(() => {
    clickedLinks = [];
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn().mockReturnValue('blob:mock-url'),
      revokeObjectURL: vi.fn(),
    });
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'a') {
        const a = { href: '', download: '', click: vi.fn() } as unknown as HTMLAnchorElement;
        // click를 spy해서 clickedLinks에 기록
        (a.click as ReturnType<typeof vi.fn>).mockImplementation(() => {
          clickedLinks.push({ href: a.href, download: a.download });
        });
        return a;
      }
      return document.createElement(tag);
    });
  });

  it('비디오 파일 다운로드가 트리거된다 (.webm)', async () => {
    const videoBlob = new Blob(['video'], { type: 'video/webm' });
    await LocalStorage.save(videoBlob, makeHARLog());
    const webmLink = clickedLinks.find((l) => l.download.endsWith('.webm'));
    expect(webmLink).toBeDefined();
  });

  it('HAR 파일 다운로드가 트리거된다 (.har)', async () => {
    const videoBlob = new Blob(['video'], { type: 'video/webm' });
    await LocalStorage.save(videoBlob, makeHARLog());
    const harLink = clickedLinks.find((l) => l.download.endsWith('.har'));
    expect(harLink).toBeDefined();
  });

  it('정확히 2개의 파일이 다운로드된다', async () => {
    const videoBlob = new Blob(['video'], { type: 'video/webm' });
    await LocalStorage.save(videoBlob, makeHARLog());
    expect(clickedLinks).toHaveLength(2);
  });

  it('파일명에 타임스탬프가 포함된다', async () => {
    const videoBlob = new Blob(['video'], { type: 'video/webm' });
    await LocalStorage.save(videoBlob, makeHARLog());
    expect(clickedLinks[0].download).toMatch(/qa-recording-\d{4}/);
    expect(clickedLinks[1].download).toMatch(/qa-network-\d{4}/);
  });

  it('HAR 파일에 올바른 JSON이 담긴다', async () => {
    const videoBlob = new Blob(['video'], { type: 'video/webm' });
    const harLog = makeHARLog();
    await LocalStorage.save(videoBlob, harLog);

    // createObjectURL 두 번째 호출이 HAR Blob에 대한 것
    const createObjectURL = URL.createObjectURL as ReturnType<typeof vi.fn>;
    const harBlob: Blob = createObjectURL.mock.calls[1][0];
    const text = await harBlob.text();
    expect(JSON.parse(text)).toEqual(harLog);
  });

  it('다운로드 후 Object URL이 해제된다', async () => {
    const videoBlob = new Blob(['video'], { type: 'video/webm' });
    await LocalStorage.save(videoBlob, makeHARLog());
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });
});
