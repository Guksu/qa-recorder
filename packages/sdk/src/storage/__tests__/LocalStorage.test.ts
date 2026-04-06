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
    expect(clickedLinks.find((l) => l.download.endsWith('.rr.json'))).toBeDefined();
  });

  it('HAR 파일 다운로드가 트리거된다 (.har)', async () => {
    await LocalStorage.save(makeEvents(), makeHARLog());
    expect(clickedLinks.find((l) => l.download.endsWith('.har'))).toBeDefined();
  });

  it('통합 뷰어 다운로드가 트리거된다 (qa-report-*.html)', async () => {
    await LocalStorage.save(makeEvents(), makeHARLog());
    expect(clickedLinks.find((l) => l.download.startsWith('qa-report') && l.download.endsWith('.html'))).toBeDefined();
  });

  it('세션 있을 때 정확히 3개의 파일이 다운로드된다', async () => {
    await LocalStorage.save(makeEvents(), makeHARLog());
    expect(clickedLinks).toHaveLength(3);
  });

  it('파일명에 타임스탬프가 포함된다', async () => {
    await LocalStorage.save(makeEvents(), makeHARLog());
    expect(clickedLinks[0].download).toMatch(/qa-session-\d{4}/);
    expect(clickedLinks[1].download).toMatch(/qa-network-\d{4}/);
    expect(clickedLinks[2].download).toMatch(/qa-report-\d{4}/);
  });

  it('통합 뷰어 HTML에 QA Report가 포함된다', async () => {
    await LocalStorage.save(makeEvents(), makeHARLog());
    const createObjectURL = URL.createObjectURL as ReturnType<typeof vi.fn>;
    const reportBlob: Blob = createObjectURL.mock.calls[2][0];
    const text = await reportBlob.text();
    expect(text).toContain('QA Report');
  });

  it('HAR 파일에 올바른 JSON이 담긴다', async () => {
    const harLog = makeHARLog();
    await LocalStorage.save(makeEvents(), harLog);
    const createObjectURL = URL.createObjectURL as ReturnType<typeof vi.fn>;
    const harBlob: Blob = createObjectURL.mock.calls[1][0];
    const text = await harBlob.text();
    expect(JSON.parse(text)).toEqual(harLog);
  });

  it('통합 뷰어 HTML은 <!DOCTYPE html>을 포함한다', async () => {
    await LocalStorage.save(makeEvents(), makeHARLog());
    const createObjectURL = URL.createObjectURL as ReturnType<typeof vi.fn>;
    const htmlBlob: Blob = createObjectURL.mock.calls[2][0];
    const text = await htmlBlob.text();
    expect(text).toContain('<!DOCTYPE html>');
  });

  it('다운로드 후 Object URL이 해제된다', async () => {
    await LocalStorage.save(makeEvents(), makeHARLog());
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(3);
  });

  it('sessionEvents가 null이면 .rr.json 다운로드를 건너뛴다', async () => {
    await LocalStorage.save(null, makeHARLog());
    expect(clickedLinks.find((l) => l.download.endsWith('.rr.json'))).toBeUndefined();
  });

  it('sessionEvents가 null이어도 .har와 통합 뷰어는 다운로드된다', async () => {
    await LocalStorage.save(null, makeHARLog());
    expect(clickedLinks.find((l) => l.download.endsWith('.har'))).toBeDefined();
    expect(clickedLinks.find((l) => l.download.endsWith('.html'))).toBeDefined();
  });

  it('sessionEvents가 null이면 정확히 2개의 파일이 다운로드된다', async () => {
    await LocalStorage.save(null, makeHARLog());
    expect(clickedLinks).toHaveLength(2);
  });
});
