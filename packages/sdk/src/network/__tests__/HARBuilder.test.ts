import { describe, it, expect, afterEach, vi } from 'vitest';
import { HARBuilder, HAR_TIMINGS_COMMENT } from '../HARBuilder.js';
import { NetworkCapture } from '../NetworkCapture.js';
import type { HAREntry } from '../../types/har.js';
import { harProblems } from './harValidation.js';

/** 예전 버전이 만든(그리고 sessionStorage 백업에 남아 있을 수 있는) 캡처 엔트리 */
function makeLegacyEntry(url: string): HAREntry {
  return {
    startedDateTime: new Date().toISOString(),
    time: 50,
    request: { method: 'GET', url, httpVersion: 'HTTP/1.1', headers: [], queryString: [], bodySize: -1, headersSize: -1 },
    response: { status: 200, statusText: 'OK', httpVersion: 'HTTP/1.1', headers: [], content: { size: 0, mimeType: '' }, bodySize: 0, headersSize: -1 },
    timings: { send: 0, wait: 50, receive: 0 },
    _offsetMs: 120,
  };
}

describe('HARBuilder.build', () => {
  it('표준 HAR 1.2 최상위 구조({ log })로 만든다', () => {
    const har = HARBuilder.build([]);
    expect(Object.keys(har)).toEqual(['log']);
    expect(har.log.version).toBe('1.2');
    expect(har.log.creator.name).toBe('qa-recorder');
    expect(har.log.entries).toEqual([]);
    expect(harProblems(har)).toEqual([]);
  });

  it('검증기가 예전 형식(log 없이 entries를 최상위에 둔 파일)을 거부한다', () => {
    const legacy = { version: '1.2', creator: { name: 'qa-recorder', version: '1' }, entries: [makeLegacyEntry('https://a.com')] };
    expect(harProblems(legacy).join('\n')).toContain("must have required property 'log'");
  });

  it('예전 엔트리에서 빠진 필수 필드(cookies, cache, redirectURL)를 채워 스키마를 통과한다', () => {
    const har = HARBuilder.build([makeLegacyEntry('https://a.com'), makeLegacyEntry('https://b.com')]);
    expect(harProblems(har)).toEqual([]);
    const [entry] = har.log.entries;
    expect(entry.request.url).toBe('https://a.com');
    expect(entry.request.cookies).toEqual([]);
    expect(entry.response.cookies).toEqual([]);
    expect(entry.response.redirectURL).toBe('');
    expect(entry.cache).toEqual({});
    expect(entry._offsetMs).toBe(120); // 뷰어 타임라인용 사용자 정의 필드는 유지
  });

  it('입력 엔트리를 바꾸지 않는다', () => {
    const entry = makeLegacyEntry('https://a.com');
    const before = JSON.stringify(entry);
    HARBuilder.build([entry]);
    expect(JSON.stringify(entry)).toBe(before);
  });

  it('단계별 시간은 측정값이 아님을 comment로 밝히고, 합이 time과 같다', () => {
    const [entry] = HARBuilder.build([{ ...makeLegacyEntry('https://a.com'), time: 87.5 }]).log.entries;
    expect(entry.timings).toEqual({
      blocked: -1, dns: -1, connect: -1, ssl: -1, send: 0, wait: 87.5, receive: 0, comment: HAR_TIMINGS_COMMENT,
    });
  });

  it('음수나 숫자가 아닌 크기·시간은 알 수 없음(-1)이나 0으로 고친다', () => {
    const broken = makeLegacyEntry('https://a.com') as unknown as Record<string, Record<string, unknown>>;
    broken.time = Number.NaN as unknown as Record<string, unknown>;
    broken.request.bodySize = 3.7;
    broken.response.headersSize = -5;
    const har = HARBuilder.build([broken as unknown as HAREntry]);
    expect(harProblems(har)).toEqual([]);
    expect(har.log.entries[0].time).toBe(0);
    expect(har.log.entries[0].request.bodySize).toBe(4);
    expect(har.log.entries[0].response.headersSize).toBe(-1);
  });

  it('마스킹된 URL의 대괄호를 퍼센트 인코딩해 URI 형식을 지키고, 호스트의 IPv6 대괄호는 그대로 둔다', () => {
    const masked = makeLegacyEntry('https://a.com/p?token=[MASKED]#access_token=[MASKED]');
    const ipv6 = makeLegacyEntry('http://[::1]:8080/x?k=[v]');
    const har = HARBuilder.build([masked, ipv6]);
    expect(har.log.entries[0].request.url).toBe('https://a.com/p?token=%5BMASKED%5D#access_token=%5BMASKED%5D');
    expect(har.log.entries[1].request.url).toBe('http://[::1]:8080/x?k=%5Bv%5D');
    expect(harProblems(har)).toEqual([]);
  });

  it.each([
    ['pending', /still being received/],
    ['error', /could not be read completely/],
    ['aborted', /capture stopped before the body was complete/],
    ['omitted', /maxBodySize is 0/],
  ] as const)('본문 상태 %s는 _bodyStatus와 이유(comment)를 남기고 크기는 알 수 없음(-1)으로 둔다', (status, reason) => {
    const entry = makeLegacyEntry('https://a.com');
    entry.response.content = { size: 10, mimeType: 'text/plain', text: 'part', _bodyStatus: status };
    const har = HARBuilder.build([entry]);
    const { content } = har.log.entries[0].response;
    expect(content._bodyStatus).toBe(status);
    expect(content.comment).toMatch(reason);
    if (status !== 'omitted') expect(content.size).toBe(-1);
    expect(harProblems(har)).toEqual([]);
  });

  it('앞선 리포트에도 들어간 요청은 _alsoInEarlierReport와 comment로 알린다', () => {
    const entry = { ...makeLegacyEntry('https://a.com'), _alsoInEarlierReport: true };
    const [out] = HARBuilder.build([entry]).log.entries;
    expect(out._alsoInEarlierReport).toBe(true);
    expect(out.comment).toMatch(/Also included in an earlier report/);
  });

  it('Location 헤더가 있으면 redirectURL로 쓴다', () => {
    const entry = makeLegacyEntry('https://a.com');
    entry.response.status = 302;
    entry.response.headers = [{ name: 'Location', value: 'https://a.com/next' }];
    expect(HARBuilder.build([entry]).log.entries[0].response.redirectURL).toBe('https://a.com/next');
  });
});

describe('HARBuilder.build — 실제 캡처 엔트리', () => {
  const originalFetch = window.fetch;
  const OriginalXHR = window.XMLHttpRequest;

  afterEach(() => {
    window.fetch = originalFetch;
    window.XMLHttpRequest = OriginalXHR;
    vi.unstubAllGlobals();
  });

  async function captureAll(maxBodySize = 64): Promise<HAREntry[]> {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.endsWith('/offline')) throw new TypeError('Failed to fetch');
      if (url.endsWith('/image')) return new Response('\u0089PNG', { headers: { 'content-type': 'image/png' } });
      if (url.endsWith('/long')) return new Response('x'.repeat(500), { headers: { 'content-type': 'text/plain' } });
      return new Response('{"ok":true,"name":"한글"}', { status: 201, headers: { 'content-type': 'application/json' } });
    }));
    const capture = new NetworkCapture(100, ['authorization'], { maskKeys: ['token'], maxBodySize });
    capture.start();
    await window.fetch('https://api.example.com/items?token=abc&page=2', {
      method: 'POST', body: '{"token":"secret","q":"한"}', headers: { 'content-type': 'application/json', authorization: 'Bearer x' },
    });
    const form = new FormData();
    form.append('file', new Blob(['abc']), 'a.txt');
    await window.fetch('https://api.example.com/upload', { method: 'POST', body: form });
    await window.fetch('https://api.example.com/image');
    await window.fetch('https://api.example.com/long');
    await window.fetch('https://api.example.com/offline').catch(() => {});
    await new Promise((r) => setTimeout(r, 20)); // 응답 body 비동기 캡처 대기
    const entries = capture.snapshot();
    capture.stop();
    return entries;
  }

  it('fetch 성공·FormData·바이너리·잘린 응답·네트워크 실패 엔트리 모두 HAR 1.2 스키마와 명세 규칙을 통과한다', async () => {
    const entries = await captureAll();
    expect(entries).toHaveLength(5);
    const har = JSON.parse(JSON.stringify(HARBuilder.build(entries))); // 실제 파일처럼 직렬화한 결과로 검증
    expect(harProblems(har)).toEqual([]);
  });

  it('측정하지 않은 값은 측정값처럼 기록하지 않는다', async () => {
    const [json, formData, image, long, offline] = HARBuilder.build(await captureAll()).log.entries;

    for (const entry of [json, formData, image, long, offline]) {
      expect(entry.request.httpVersion).toBe(''); // 페이지에서는 알 수 없음
      expect(entry.response.httpVersion).toBe('');
      expect(entry.request.headersSize).toBe(-1);
      expect(entry.response.headersSize).toBe(-1);
      expect(entry.response.bodySize).toBe(-1); // 전송(압축된) 크기는 알 수 없음
      expect(entry.timings.comment).toBe(HAR_TIMINGS_COMMENT);
    }

    // 끝까지 읽은 응답: 디코딩한 본문의 UTF-8 바이트 수
    const body = '{"ok":true,"name":"한글"}';
    expect(json.response.content.size).toBe(new TextEncoder().encode(body).length);
    expect(json.request.bodySize).toBe(new TextEncoder().encode('{"token":"secret","q":"한"}').length);
    expect(json.request.postData?.text).toBe('{"token":"[MASKED]","q":"한"}');

    // FormData: 크기를 모르고 본문을 텍스트로 기록하지 않았다
    expect(formData.request.bodySize).toBe(-1);
    expect(formData.request.postData?.text).toBeUndefined();
    expect(formData.request.postData?.comment).toMatch(/not captured/);

    // 바이너리 응답: '[binary]' 자리표시자를 본문처럼 내보내지 않는다
    expect(image.response.content.text).toBeUndefined();
    expect(image.response.content.size).toBe(-1);
    expect(image.response.content.comment).toMatch(/not captured/);

    // 잘린 응답: 잘림 표시를 본문에서 떼어 comment로 옮기고, 크기는 알 수 없음
    expect(long.response.content.text).toBe('x'.repeat(64));
    expect(long.response.content.comment).toMatch(/Truncated by qa-recorder: kept the first 64 characters/);
    expect(long.response.content.size).toBe(-1);

    // 네트워크 실패: 응답이 없었다
    expect(offline.response.status).toBe(0);
    expect(offline.response.content.size).toBe(0);
    expect(offline.response.comment).toMatch(/No response/);
  });
});
