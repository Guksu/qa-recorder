import { describe, it, expect } from 'vitest';
import { HARBuilder } from '../HARBuilder.js';
import type { HAREntry } from '@qa-recorder/shared';

function makeEntry(url: string): HAREntry {
  return {
    startedDateTime: new Date().toISOString(),
    time: 50,
    request: { method: 'GET', url, httpVersion: 'HTTP/1.1', headers: [], queryString: [], bodySize: -1, headersSize: -1 },
    response: { status: 200, statusText: 'OK', httpVersion: 'HTTP/1.1', headers: [], content: { size: 0, mimeType: '' }, bodySize: 0, headersSize: -1 },
    timings: { send: 0, wait: 50, receive: 0 },
  };
}

describe('HARBuilder.build', () => {
  it('HAR 버전을 1.2로 설정한다', () => {
    expect(HARBuilder.build([]).version).toBe('1.2');
  });

  it('creator 이름을 qa-recorder로 설정한다', () => {
    expect(HARBuilder.build([]).creator.name).toBe('qa-recorder');
  });

  it('전달된 entries를 그대로 포함한다', () => {
    const log = HARBuilder.build([makeEntry('https://a.com'), makeEntry('https://b.com')]);
    expect(log.entries).toHaveLength(2);
    expect(log.entries[0].request.url).toBe('https://a.com');
  });

  it('빈 entries를 그대로 반환한다', () => {
    expect(HARBuilder.build([]).entries).toEqual([]);
  });
});
