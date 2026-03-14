import { describe, it, expect } from 'vitest';
import { HARViewer } from '../HARViewer.js';
import type { HARLog, HAREntry } from '@qa-recorder/shared';

function makeEntry(overrides: Partial<HAREntry> = {}): HAREntry {
  return {
    startedDateTime: '2024-01-01T00:00:00.000Z',
    time: 120,
    request: {
      method: 'GET',
      url: 'https://api.example.com/users',
      httpVersion: 'HTTP/1.1',
      headers: [{ name: 'Authorization', value: '[MASKED]' }],
      queryString: [],
      bodySize: -1,
      headersSize: -1,
    },
    response: {
      status: 200,
      statusText: 'OK',
      httpVersion: 'HTTP/1.1',
      headers: [{ name: 'content-type', value: 'application/json' }],
      content: { size: 42, mimeType: 'application/json', text: '{"id":1}' },
      bodySize: 42,
      headersSize: -1,
    },
    timings: { send: 0, wait: 120, receive: 0 },
    ...overrides,
  };
}

function makeHARLog(entries: HAREntry[] = []): HARLog {
  return { version: '1.2', creator: { name: 'qa-recorder', version: '0.1.0' }, entries };
}

describe('HARViewer.generate', () => {
  it('유효한 HTML 문서를 반환한다', () => {
    const html = HARViewer.generate(makeHARLog());
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html');
    expect(html).toContain('</html>');
  });

  it('HAR 데이터가 HTML에 임베드된다', () => {
    const harLog = makeHARLog([makeEntry()]);
    const html = HARViewer.generate(harLog);
    expect(html).toContain('https://api.example.com/users');
  });

  it('각 엔트리의 HTTP 메서드가 표시된다', () => {
    const harLog = makeHARLog([
      makeEntry({ request: { ...makeEntry().request, method: 'POST' } }),
    ]);
    const html = HARViewer.generate(harLog);
    expect(html).toContain('POST');
  });

  it('각 엔트리의 응답 상태 코드가 표시된다', () => {
    const harLog = makeHARLog([makeEntry()]);
    const html = HARViewer.generate(harLog);
    expect(html).toContain('200');
  });

  it('여러 엔트리가 모두 표시된다', () => {
    const harLog = makeHARLog([
      makeEntry({ request: { ...makeEntry().request, url: 'https://api.example.com/users' } }),
      makeEntry({ request: { ...makeEntry().request, url: 'https://api.example.com/posts' } }),
    ]);
    const html = HARViewer.generate(harLog);
    expect(html).toContain('https://api.example.com/users');
    expect(html).toContain('https://api.example.com/posts');
  });

  it('엔트리가 없어도 오류 없이 동작한다', () => {
    expect(() => HARViewer.generate(makeHARLog([]))).not.toThrow();
  });

  it('외부 리소스 의존성이 없다 (self-contained)', () => {
    const html = HARViewer.generate(makeHARLog());
    expect(html).not.toMatch(/src=["']https?:\/\//);
    expect(html).not.toMatch(/href=["']https?:\/\//);
  });

  it('응답 시간(ms)이 표시된다', () => {
    const harLog = makeHARLog([makeEntry()]);
    const html = HARViewer.generate(harLog);
    expect(html).toContain('120');
  });
});
