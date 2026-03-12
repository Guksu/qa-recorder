import { describe, it, expect } from 'vitest';
import { MaskingFilter } from '../MaskingFilter.js';
import type { HAREntry } from '@qa-recorder/shared';

function makeEntry(
  requestHeaders: { name: string; value: string }[],
  responseHeaders: { name: string; value: string }[] = [],
): HAREntry {
  return {
    startedDateTime: new Date().toISOString(),
    time: 100,
    request: {
      method: 'GET',
      url: 'https://example.com',
      httpVersion: 'HTTP/1.1',
      headers: requestHeaders,
      queryString: [],
      bodySize: -1,
      headersSize: -1,
    },
    response: {
      status: 200,
      statusText: 'OK',
      httpVersion: 'HTTP/1.1',
      headers: responseHeaders,
      content: { size: 0, mimeType: 'application/json' },
      bodySize: 0,
      headersSize: -1,
    },
    timings: { send: 0, wait: 100, receive: 0 },
  };
}

describe('MaskingFilter.apply', () => {
  it('지정된 요청 헤더를 [MASKED]로 대체한다', () => {
    const entry = makeEntry([{ name: 'Authorization', value: 'Bearer secret' }]);
    const result = MaskingFilter.apply(entry, ['Authorization']);
    expect(result.request.headers[0].value).toBe('[MASKED]');
  });

  it('지정된 응답 헤더를 [MASKED]로 대체한다', () => {
    const entry = makeEntry([], [{ name: 'Set-Cookie', value: 'session=abc' }]);
    const result = MaskingFilter.apply(entry, ['Set-Cookie']);
    expect(result.response.headers[0].value).toBe('[MASKED]');
  });

  it('헤더 이름은 대소문자를 구분하지 않는다', () => {
    const entry = makeEntry([{ name: 'AUTHORIZATION', value: 'Bearer secret' }]);
    const result = MaskingFilter.apply(entry, ['authorization']);
    expect(result.request.headers[0].value).toBe('[MASKED]');
  });

  it('마스킹 목록에 없는 헤더는 원본 값을 유지한다', () => {
    const entry = makeEntry([{ name: 'Content-Type', value: 'application/json' }]);
    const result = MaskingFilter.apply(entry, ['Authorization']);
    expect(result.request.headers[0].value).toBe('application/json');
  });

  it('maskHeaders가 빈 배열이면 아무것도 마스킹하지 않는다', () => {
    const entry = makeEntry([
      { name: 'Authorization', value: 'Bearer secret' },
      { name: 'Cookie', value: 'session=abc' },
    ]);
    const result = MaskingFilter.apply(entry, []);
    expect(result.request.headers[0].value).toBe('Bearer secret');
    expect(result.request.headers[1].value).toBe('session=abc');
  });

  it('원본 entry를 변경하지 않는다 (불변성)', () => {
    const entry = makeEntry([{ name: 'Authorization', value: 'Bearer secret' }]);
    MaskingFilter.apply(entry, ['Authorization']);
    expect(entry.request.headers[0].value).toBe('Bearer secret');
  });
});
