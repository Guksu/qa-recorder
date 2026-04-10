import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConsoleCapture } from '../ConsoleCapture.js';

let capture: ConsoleCapture;

beforeEach(() => {
  capture = new ConsoleCapture();
});

afterEach(() => {
  capture.stop();
});

describe('ConsoleCapture', () => {
  it('start() 후 console.error가 버퍼에 기록된다', () => {
    capture.start();
    console.error('test error');
    expect(capture.snapshot()).toHaveLength(1);
    expect(capture.snapshot()[0].level).toBe('error');
    expect(capture.snapshot()[0].message).toContain('test error');
  });

  it('start() 후 console.warn이 버퍼에 기록된다', () => {
    capture.start();
    console.warn('test warn');
    expect(capture.snapshot()[0].level).toBe('warn');
  });

  it('기본 설정에서 console.log는 기록되지 않는다', () => {
    capture.start();
    console.log('not captured');
    expect(capture.snapshot()).toHaveLength(0);
  });

  it('start() 전 로그는 기록되지 않는다', () => {
    console.error('before start');
    expect(capture.snapshot()).toHaveLength(0);
  });

  it('stop() 후 로그는 기록되지 않는다', () => {
    capture.start();
    capture.stop();
    console.error('after stop');
    expect(capture.snapshot()).toHaveLength(0);
  });

  it('stop() 후 원본 console 메서드가 복원된다', () => {
    const originalError = console.error;
    const originalWarn = console.warn;
    capture.start();
    capture.stop();
    expect(console.error).toBe(originalError);
    expect(console.warn).toBe(originalWarn);
  });

  it('clearBuffer() 후 snapshot()은 빈 배열을 반환한다', () => {
    capture.start();
    console.error('entry');
    capture.clearBuffer();
    expect(capture.snapshot()).toHaveLength(0);
  });

  it('snapshot()은 버퍼의 복사본을 반환한다', () => {
    capture.start();
    const snap1 = capture.snapshot();
    console.error('new entry');
    expect(snap1).toHaveLength(0);
    expect(capture.snapshot()).toHaveLength(1);
  });

  it('maxEntries 초과 시 오래된 항목이 FIFO로 제거된다', () => {
    capture = new ConsoleCapture(2);
    capture.start();
    console.error('first');
    console.error('second');
    console.error('third');
    const entries = capture.snapshot();
    expect(entries).toHaveLength(2);
    expect(entries[0].message).toContain('second');
    expect(entries[1].message).toContain('third');
  });

  it('window.onerror 발생 시 error로 기록된다', () => {
    capture.start();
    window.onerror?.('Uncaught TypeError', 'app.js', 10, 5, new Error('Uncaught TypeError'));
    expect(capture.snapshot()).toHaveLength(1);
    expect(capture.snapshot()[0].level).toBe('error');
    expect(capture.snapshot()[0].message).toContain('Uncaught TypeError');
  });

  it('각 엔트리에 timestamp가 포함된다', () => {
    capture.start();
    console.error('with timestamp');
    expect(capture.snapshot()[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('각 엔트리에 _offsetMs가 포함된다', () => {
    capture.start();
    console.error('with offset');
    expect(typeof capture.snapshot()[0]._offsetMs).toBe('number');
  });

  it('restoreEntries()는 엔트리를 버퍼 앞에 추가한다', () => {
    capture.start();
    console.error('after');
    const old: import('../ConsoleCapture.js').ConsoleEntry = { timestamp: new Date().toISOString(), level: 'error', message: 'before', _offsetMs: 0 };
    capture.restoreEntries([old]);
    const entries = capture.snapshot();
    expect(entries[0].message).toBe('before');
    expect(entries[1].message).toContain('after');
  });

  it('restoreEntries() 후 maxEntries 초과 시 오래된 항목이 제거된다', () => {
    capture = new ConsoleCapture(2);
    capture.start();
    const fakeEntries: import('../ConsoleCapture.js').ConsoleEntry[] = [1, 2, 3].map(i => ({
      timestamp: new Date().toISOString(), level: 'error' as const, message: `entry${i}`, _offsetMs: i * 100,
    }));
    capture.restoreEntries(fakeEntries);
    expect(capture.snapshot()).toHaveLength(2);
  });

  it('순환 참조 객체는 String() 변환으로 기록된다', () => {
    capture.start();
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    console.error(circular);
    const msg = capture.snapshot()[0].message;
    expect(msg).not.toBe('[unserializable]');
    expect(msg.length).toBeGreaterThan(0);
  });

  it('consoleLevels 옵션으로 log도 캡처할 수 있다', () => {
    capture = new ConsoleCapture(200, ['error', 'warn', 'log']);
    capture.start();
    console.log('captured log');
    expect(capture.snapshot()).toHaveLength(1);
    expect(capture.snapshot()[0].level).toBe('log');
  });
});
