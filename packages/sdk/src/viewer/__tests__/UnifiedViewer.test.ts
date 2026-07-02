import { describe, it, expect } from 'vitest';
import { UnifiedViewer } from '../UnifiedViewer.js';
import type { HARLog, HAREntry } from '@qa-recorder/shared';
import type { ConsoleEntry } from '../../console/ConsoleCapture.js';

function makeEntry(url = 'https://api.example.com/users'): HAREntry {
  return {
    startedDateTime: '2024-01-01T00:00:00.000Z',
    time: 120,
    request: {
      method: 'GET', url,
      httpVersion: 'HTTP/1.1',
      headers: [], queryString: [], bodySize: -1, headersSize: -1,
    },
    response: {
      status: 200, statusText: 'OK', httpVersion: 'HTTP/1.1',
      headers: [],
      content: { size: 42, mimeType: 'application/json', text: '{"ok":true}' },
      bodySize: 42, headersSize: -1,
    },
    timings: { send: 0, wait: 120, receive: 0 },
    _offsetMs: 3000,
  };
}

function makeHARLog(entries: HAREntry[] = []): HARLog {
  return { version: '1.2', creator: { name: 'qa-recorder', version: '0.1.0' }, entries };
}

function makeConsoleEntry(level: ConsoleEntry['level'] = 'error'): ConsoleEntry {
  return { timestamp: '2024-01-01T00:00:05.000Z', level, message: 'Test message', _offsetMs: 5000 };
}

const EVENTS = [{ type: 2, data: {}, timestamp: 1000 }, { type: 3, data: {}, timestamp: 61000 }];

describe('UnifiedViewer.generate', () => {
  it('유효한 HTML 문서를 반환한다', () => {
    const html = UnifiedViewer.generate(EVENTS, makeHARLog(), []);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('</html>');
  });

  it('rrweb CDN 스크립트가 포함된다', () => {
    const html = UnifiedViewer.generate(EVENTS, makeHARLog(), []);
    expect(html).toContain('rrweb');
  });

  it('세션 이벤트가 HTML에 임베드된다', () => {
    const html = UnifiedViewer.generate(EVENTS, makeHARLog(), []);
    expect(html).toContain('"type":2');
  });

  it('HAR 엔트리가 HTML에 임베드된다', () => {
    const html = UnifiedViewer.generate(EVENTS, makeHARLog([makeEntry()]), []);
    expect(html).toContain('api.example.com/users');
  });

  it('Console 로그가 HTML에 임베드된다', () => {
    const html = UnifiedViewer.generate(EVENTS, makeHARLog(), [makeConsoleEntry()]);
    expect(html).toContain('Test message');
  });

  it('_offsetMs가 리플레이 시작(EVENTS[0].timestamp) 기준으로 재계산되어 임베드된다', () => {
    const base = Date.parse('2024-01-01T00:00:00.000Z');
    const events = [
      { type: 2, data: {}, timestamp: base },
      { type: 3, data: {}, timestamp: base + 60000 },
    ];
    // startedDateTime이 리플레이 시작 3초 뒤 → offset 3000으로 재계산
    const entry = makeEntry();
    entry.startedDateTime = '2024-01-01T00:00:03.000Z';
    entry._offsetMs = 999999; // 어긋난 기존 값은 무시되어야 함
    const html = UnifiedViewer.generate(events, makeHARLog([entry]), []);
    expect(html).toContain('"_offsetMs":3000');
    expect(html).not.toContain('"_offsetMs":999999');
  });

  it('체크아웃으로 리플레이 원점이 이동해도 _offsetMs가 절대 시각 기준으로 보정된다', () => {
    const base = Date.parse('2024-01-01T00:00:00.000Z');
    // 체크아웃이 발생해 리플레이가 녹화 시작 20분 뒤부터 시작하는 상황
    const events = [
      { type: 2, data: {}, timestamp: base + 20 * 60 * 1000 },
      { type: 3, data: {}, timestamp: base + 25 * 60 * 1000 },
    ];
    const entry = makeEntry();
    entry.startedDateTime = '2024-01-01T00:21:00.000Z'; // 녹화 시작 21분 뒤
    entry._offsetMs = 21 * 60 * 1000;                   // 녹화 시작 기준의 (어긋난) 값
    const html = UnifiedViewer.generate(events, makeHARLog([entry]), []);
    // 리플레이 원점(20분) 기준 1분으로 보정되어야 함
    expect(html).toContain('"_offsetMs":60000');
    expect(html).not.toContain(`"_offsetMs":${21 * 60 * 1000}`);
  });

  it('콘솔 로그의 _offsetMs도 리플레이 원점 기준으로 보정된다', () => {
    const base = Date.parse('2024-01-01T00:00:00.000Z');
    const events = [{ type: 2, data: {}, timestamp: base + 10000 }];
    const log = makeConsoleEntry(); // timestamp 00:00:05 → 리플레이 시작(10초)보다 앞
    const html = UnifiedViewer.generate(events, makeHARLog(), [log]);
    // 원점 이전 항목은 0으로 클램프
    expect(html).toContain('"_offsetMs":0');
  });

  it('rrweb 이벤트가 없으면 기존 _offsetMs를 그대로 유지한다', () => {
    const html = UnifiedViewer.generate([], makeHARLog([makeEntry()]), []);
    expect(html).toContain('"_offsetMs":3000');
  });

  it('외부 리소스 의존성이 rrweb CDN만 있다', () => {
    const html = UnifiedViewer.generate(EVENTS, makeHARLog(), []);
    const externalLinks = (html.match(/src=["']https?:\/\/[^"']+["']/g) || [])
      .concat(html.match(/href=["']https?:\/\/[^"']+["']/g) || []);
    expect(externalLinks.every(l => l.includes('rrweb'))).toBe(true);
  });

  it('세션 이벤트가 없어도 오류 없이 동작한다', () => {
    expect(() => UnifiedViewer.generate([], makeHARLog(), [])).not.toThrow();
  });

  it('네트워크 상세 패널(#net-detail)이 HTML에 포함된다', () => {
    const html = UnifiedViewer.generate(EVENTS, makeHARLog([makeEntry()]), []);
    expect(html).toContain('net-detail');
  });

  it('상세 패널에 Headers/Payload/Response/Timing 탭이 있다', () => {
    const html = UnifiedViewer.generate(EVENTS, makeHARLog([makeEntry()]), []);
    expect(html).toContain('pane-headers');
    expect(html).toContain('pane-payload');
    expect(html).toContain('pane-response');
    expect(html).toContain('pane-timing');
  });

  it('showNetDetail 함수가 스크립트에 포함된다', () => {
    const html = UnifiedViewer.generate(EVENTS, makeHARLog([makeEntry()]), []);
    expect(html).toContain('showNetDetail');
  });

  it('상세 패널 닫기 버튼(detail-close)이 포함된다', () => {
    const html = UnifiedViewer.generate(EVENTS, makeHARLog([makeEntry()]), []);
    expect(html).toContain('detail-close');
  });

  it('네트워크 행 클릭 핸들러가 showNetDetail을 호출한다', () => {
    const html = UnifiedViewer.generate(EVENTS, makeHARLog([makeEntry()]), []);
    expect(html).toMatch(/showNetDetail\(i,\s*tr\)/);
  });

  it('memo가 있으면 리포트에 포함된다', () => {
    const html = UnifiedViewer.generate(EVENTS, makeHARLog(), [], '로그인 500 에러 재현');
    expect(html).toContain('로그인 500 에러 재현');
  });

  it('memo가 없으면 memo 섹션이 렌더링되지 않는다', () => {
    const html = UnifiedViewer.generate(EVENTS, makeHARLog(), [], '');
    expect(html).not.toContain('qa-memo-section');
  });

  it('캡처 데이터에 </script>가 있어도 스크립트 블록이 깨지지 않는다', () => {
    const entry = makeEntry();
    entry.response.content.text = '</script><script>alert(1)</script>';
    const consoleLog: ConsoleEntry = {
      timestamp: '2024-01-01T00:00:05.000Z',
      level: 'error',
      message: '<!--<script>alert(2)</script>',
      _offsetMs: 100,
    };
    const html = UnifiedViewer.generate(EVENTS, makeHARLog([entry]), [consoleLog]);

    expect(html).not.toContain('</script><script>alert(1)');
    expect(html).not.toContain('<!--<script>');
    // 이스케이프된 JSON은 원본 값으로 복원되어야 한다
    expect(JSON.parse('"\\u003c/script>"')).toBe('</script>');
  });

  it('memo의 특수문자가 HTML 이스케이프된다', () => {
    const html = UnifiedViewer.generate(EVENTS, makeHARLog(), [], '<img src=x onerror=alert(1)>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});
