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

function makeEvents(): unknown[] {
  return [{ type: 2, data: {}, timestamp: 1000 }];
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
        (a.click as ReturnType<typeof vi.fn>).mockImplementation(() => {
          clickedLinks.push({ href: a.href, download: a.download });
        });
        return a;
      }
      return document.createElement(tag);
    });
  });

  it('세션 파일 다운로드가 트리거된다 (.rr.json)', async () => {
    await LocalStorage.save(makeEvents(), makeHARLog());
    const sessionLink = clickedLinks.find((l) => l.download.endsWith('.rr.json'));
    expect(sessionLink).toBeDefined();
  });

  it('세션 리플레이 뷰어 다운로드가 트리거된다 (.html)', async () => {
    await LocalStorage.save(makeEvents(), makeHARLog());
    const sessionHtmlLinks = clickedLinks.filter((l) =>
      l.download.startsWith('qa-session') && l.download.endsWith('.html'),
    );
    expect(sessionHtmlLinks).toHaveLength(1);
  });

  it('HAR 파일 다운로드가 트리거된다 (.har)', async () => {
    await LocalStorage.save(makeEvents(), makeHARLog());
    const harLink = clickedLinks.find((l) => l.download.endsWith('.har'));
    expect(harLink).toBeDefined();
  });

  it('HAR 뷰어 파일 다운로드가 트리거된다 (.html)', async () => {
    await LocalStorage.save(makeEvents(), makeHARLog());
    const harHtmlLinks = clickedLinks.filter((l) =>
      l.download.startsWith('qa-network') && l.download.endsWith('.html'),
    );
    expect(harHtmlLinks).toHaveLength(1);
  });

  it('세션 있을 때 정확히 4개의 파일이 다운로드된다', async () => {
    await LocalStorage.save(makeEvents(), makeHARLog());
    expect(clickedLinks).toHaveLength(4);
  });

  it('파일명에 타임스탬프가 포함된다', async () => {
    await LocalStorage.save(makeEvents(), makeHARLog());
    expect(clickedLinks[0].download).toMatch(/qa-session-\d{4}/);
    expect(clickedLinks[1].download).toMatch(/qa-session-\d{4}/);
    expect(clickedLinks[2].download).toMatch(/qa-network-\d{4}/);
    expect(clickedLinks[3].download).toMatch(/qa-network-\d{4}/);
  });

  it('세션 리플레이 HTML에 QA Session Replay가 포함된다', async () => {
    await LocalStorage.save(makeEvents(), makeHARLog());
    const createObjectURL = URL.createObjectURL as ReturnType<typeof vi.fn>;
    const sessionHtmlBlob: Blob = createObjectURL.mock.calls[1][0];
    const text = await sessionHtmlBlob.text();
    expect(text).toContain('QA Session Replay');
  });

  it('HAR 파일에 올바른 JSON이 담긴다', async () => {
    const harLog = makeHARLog();
    await LocalStorage.save(makeEvents(), harLog);
    const createObjectURL = URL.createObjectURL as ReturnType<typeof vi.fn>;
    const harBlob: Blob = createObjectURL.mock.calls[2][0];
    const text = await harBlob.text();
    expect(JSON.parse(text)).toEqual(harLog);
  });

  it('HAR 뷰어 HTML은 <!DOCTYPE html>을 포함한다', async () => {
    await LocalStorage.save(makeEvents(), makeHARLog());
    const createObjectURL = URL.createObjectURL as ReturnType<typeof vi.fn>;
    const htmlBlob: Blob = createObjectURL.mock.calls[3][0];
    const text = await htmlBlob.text();
    expect(text).toContain('<!DOCTYPE html>');
  });

  it('다운로드 후 Object URL이 해제된다', async () => {
    await LocalStorage.save(makeEvents(), makeHARLog());
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(4);
  });

  it('sessionEvents가 null이면 .rr.json과 세션 뷰어 다운로드를 건너뛴다', async () => {
    await LocalStorage.save(null, makeHARLog());
    expect(clickedLinks.find((l) => l.download.endsWith('.rr.json'))).toBeUndefined();
    expect(clickedLinks.filter((l) => l.download.startsWith('qa-session'))).toHaveLength(0);
  });

  it('sessionEvents가 null이어도 .har와 .html은 다운로드된다', async () => {
    await LocalStorage.save(null, makeHARLog());
    expect(clickedLinks.find((l) => l.download.endsWith('.har'))).toBeDefined();
    expect(clickedLinks.find((l) => l.download.endsWith('.html'))).toBeDefined();
  });

  it('sessionEvents가 null이면 정확히 2개의 파일이 다운로드된다', async () => {
    await LocalStorage.save(null, makeHARLog());
    expect(clickedLinks).toHaveLength(2);
  });
});
