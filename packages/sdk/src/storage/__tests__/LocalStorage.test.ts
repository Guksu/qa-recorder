import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LocalStorage } from '../LocalStorage.js';
import type { HARLog } from '@qa-recorder/shared';

const mocks = vi.hoisted(() => ({
  zipSync: vi.fn(),
  zip: vi.fn(),
}));

vi.mock('fflate', () => ({
  zipSync: (entries: Record<string, Uint8Array>) => {
    mocks.zipSync(entries);
    return new Uint8Array(4); // dummy bytes — only the call arg matters in tests
  },
  zip: (entries: Record<string, Uint8Array>, cb: (err: Error | null, data: Uint8Array) => void) =>
    mocks.zip(entries, cb),
  strToU8: (s: string) => new TextEncoder().encode(s),
}));

/** 비동기 zip 기본 동작: 성공해서 dummy bytes를 돌려준다 */
const zipSucceeds = (_entries: unknown, cb: (err: Error | null, data: Uint8Array) => void) =>
  cb(null, new Uint8Array(4));

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
    vi.useFakeTimers();
    mocks.zipSync.mockClear();
    mocks.zip.mockReset();
    mocks.zip.mockImplementation(zipSucceeds);
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

  afterEach(() => {
    vi.useRealTimers();
  });

  async function saveAndFlush(...args: Parameters<typeof LocalStorage.save>) {
    const p = LocalStorage.save(...args);
    await vi.runAllTimersAsync();
    return p;
  }

  function getZippedEntries(): Record<string, Uint8Array> {
    return mocks.zip.mock.calls[0][0] as Record<string, Uint8Array>;
  }

  function decode(data: Uint8Array): string {
    return new TextDecoder().decode(data);
  }

  it('환경 정보를 넘기면 ZIP에 qa-env-*.json을 넣고 리포트에도 담는다', async () => {
    const env = {
      url: 'https://app.example.com/page', userAgent: 'UA-TEST', language: 'ko-KR', timeZone: 'Asia/Seoul',
      viewport: { width: 1280, height: 720 }, screen: { width: 1920, height: 1080 },
      devicePixelRatio: 2, savedAt: '2026-10-01T00:00:00.000Z', sdkVersion: '1.12.0',
    };
    await saveAndFlush(makeEvents(), makeHARLog(), [], '', env);
    const entries = getZippedEntries();
    const envKey = Object.keys(entries).find((f) => /^qa-env-.*\.json$/.test(f))!;
    expect(JSON.parse(decode(entries[envKey]))).toEqual(env);
    const htmlKey = Object.keys(entries).find((f) => f.endsWith('.html'))!;
    expect(decode(entries[htmlKey])).toContain('UA-TEST');
  });

  it('환경 정보가 없으면 qa-env-*.json을 넣지 않는다', async () => {
    await saveAndFlush(makeEvents(), makeHARLog());
    expect(Object.keys(getZippedEntries()).some((f) => f.startsWith('qa-env-'))).toBe(false);
  });

  it('정확히 1개의 ZIP 파일이 다운로드된다', async () => {
    await saveAndFlush(makeEvents(), makeHARLog());
    expect(clickedLinks).toHaveLength(1);
  });

  it('다운로드 파일명은 qa-report-*.zip 형식이다', async () => {
    await saveAndFlush(makeEvents(), makeHARLog());
    expect(clickedLinks[0].download).toMatch(/^qa-report-.*\.zip$/);
  });

  it('ZIP 안에 .rr.json 파일이 포함된다', async () => {
    await saveAndFlush(makeEvents(), makeHARLog());
    const entries = getZippedEntries();
    expect(Object.keys(entries).some(f => f.endsWith('.rr.json'))).toBe(true);
  });

  it('ZIP 안에 .har 파일이 포함된다', async () => {
    await saveAndFlush(makeEvents(), makeHARLog());
    const entries = getZippedEntries();
    expect(Object.keys(entries).some(f => f.endsWith('.har'))).toBe(true);
  });

  it('ZIP 안에 .html 뷰어 파일이 포함된다', async () => {
    await saveAndFlush(makeEvents(), makeHARLog());
    const entries = getZippedEntries();
    expect(Object.keys(entries).some(f => f.endsWith('.html'))).toBe(true);
  });

  it('세션 있을 때 ZIP 안에 3개 파일이 포함된다', async () => {
    await saveAndFlush(makeEvents(), makeHARLog());
    expect(Object.keys(getZippedEntries())).toHaveLength(3);
  });

  it('HAR 파일에 올바른 JSON이 담긴다', async () => {
    const harLog = makeHARLog();
    await saveAndFlush(makeEvents(), harLog);
    const entries = getZippedEntries();
    const harKey = Object.keys(entries).find(f => f.endsWith('.har'))!;
    expect(JSON.parse(decode(entries[harKey]))).toEqual(harLog);
  });

  it('HTML 뷰어에 QA Report가 포함된다', async () => {
    await saveAndFlush(makeEvents(), makeHARLog());
    const entries = getZippedEntries();
    const htmlKey = Object.keys(entries).find(f => f.endsWith('.html'))!;
    expect(decode(entries[htmlKey])).toContain('QA Report');
  });

  it('HTML 뷰어에 <!DOCTYPE html>이 포함된다', async () => {
    await saveAndFlush(makeEvents(), makeHARLog());
    const entries = getZippedEntries();
    const htmlKey = Object.keys(entries).find(f => f.endsWith('.html'))!;
    expect(decode(entries[htmlKey])).toContain('<!DOCTYPE html>');
  });

  it('다운로드 후 Object URL이 해제된다', async () => {
    await saveAndFlush(makeEvents(), makeHARLog());
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it('sessionEvents가 null이어도 ZIP 1개가 다운로드된다', async () => {
    await saveAndFlush(null, makeHARLog());
    expect(clickedLinks).toHaveLength(1);
  });

  it('sessionEvents가 null이면 ZIP 안에 .rr.json이 포함되지 않는다', async () => {
    await saveAndFlush(null, makeHARLog());
    const entries = getZippedEntries();
    expect(Object.keys(entries).some(f => f.endsWith('.rr.json'))).toBe(false);
  });

  it('sessionEvents가 null이면 ZIP 안에 2개 파일이 포함된다', async () => {
    await saveAndFlush(null, makeHARLog());
    expect(Object.keys(getZippedEntries())).toHaveLength(2);
  });

  it('memo가 있으면 HTML 뷰어에 포함된다', async () => {
    await saveAndFlush(makeEvents(), makeHARLog(), [], '결제 버튼 오류');
    const entries = getZippedEntries();
    const htmlKey = Object.keys(entries).find(f => f.endsWith('.html'))!;
    expect(decode(entries[htmlKey])).toContain('결제 버튼 오류');
  });

  describe('압축', () => {
    it('비동기 zip이 실패하면(예: CSP가 Worker를 막음) 같은 파일로 zipSync 압축해 다운로드한다', async () => {
      mocks.zip.mockImplementation((_entries: unknown, cb: (err: Error | null, data: Uint8Array | null) => void) =>
        cb(new Error('worker blocked'), null));
      await saveAndFlush(makeEvents(), makeHARLog());
      expect(mocks.zipSync).toHaveBeenCalledOnce();
      expect(mocks.zipSync.mock.calls[0][0]).toBe(mocks.zip.mock.calls[0][0]);
      expect(clickedLinks).toHaveLength(1);
    });

    it('비동기 zip 호출 자체가 throw해도 zipSync로 대신 압축한다', async () => {
      mocks.zip.mockImplementation(() => { throw new Error('no Worker'); });
      await saveAndFlush(makeEvents(), makeHARLog());
      expect(mocks.zipSync).toHaveBeenCalledOnce();
      expect(clickedLinks).toHaveLength(1);
    });

    it('비동기 zip이 성공하면 zipSync를 쓰지 않는다', async () => {
      await saveAndFlush(makeEvents(), makeHARLog());
      expect(mocks.zip).toHaveBeenCalledOnce();
      expect(mocks.zipSync).not.toHaveBeenCalled();
    });

    it('직렬화·압축 전에 한 번 양보해 진행 막대가 먼저 그려지게 한다', async () => {
      const p = LocalStorage.save(makeEvents(), makeHARLog());
      await Promise.resolve();
      expect(mocks.zip).not.toHaveBeenCalled(); // 아직 타이머(다음 그리기)를 기다리는 중
      await vi.runAllTimersAsync();
      await p;
      expect(mocks.zip).toHaveBeenCalledOnce();
    });
  });
});
