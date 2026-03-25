import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ScreenRecorder } from '../ScreenRecorder.js';

const mocks = vi.hoisted(() => ({
  stopFn: vi.fn(),
  record: vi.fn(),
}));

vi.mock('rrweb', () => ({
  record: mocks.record,
}));

describe('ScreenRecorder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.record.mockImplementation(({ emit }: { emit: (event: unknown) => void }) => {
      emit({ type: 2, data: {}, timestamp: 1000 });
      return mocks.stopFn;
    });
  });

  it('start()는 rrweb.record()를 호출한다', () => {
    const recorder = new ScreenRecorder();
    recorder.start();
    expect(mocks.record).toHaveBeenCalledOnce();
  });

  it('start()를 중복 호출해도 record는 한 번만 호출된다', () => {
    const recorder = new ScreenRecorder();
    recorder.start();
    recorder.start();
    expect(mocks.record).toHaveBeenCalledOnce();
  });

  it('stop()은 record()가 반환한 stop 함수를 호출한다', () => {
    const recorder = new ScreenRecorder();
    recorder.start();
    recorder.stop();
    expect(mocks.stopFn).toHaveBeenCalledOnce();
  });

  it('stop()을 recording 시작 전에 호출해도 에러가 발생하지 않는다', () => {
    const recorder = new ScreenRecorder();
    expect(() => recorder.stop()).not.toThrow();
  });

  it('getBlob()은 수집된 이벤트를 JSON으로 담은 Blob을 반환한다', async () => {
    const recorder = new ScreenRecorder();
    recorder.start();
    recorder.stop();
    const blob = recorder.getBlob();
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('application/json');
    const text = await blob.text();
    const events = JSON.parse(text);
    expect(Array.isArray(events)).toBe(true);
    expect(events.length).toBeGreaterThan(0);
  });

  it('getBlob()을 start() 전에 호출하면 에러를 던진다', () => {
    const recorder = new ScreenRecorder();
    expect(() => recorder.getBlob()).toThrow('No recording available');
  });

  it('reset()은 stopped 상태에서 idle로 되돌려 start()를 다시 호출할 수 있다', () => {
    const recorder = new ScreenRecorder();
    recorder.start();
    recorder.stop();
    recorder.reset();
    recorder.start();
    expect(mocks.record).toHaveBeenCalledTimes(2);
  });

  it('reset()은 recording 중에는 동작하지 않는다', () => {
    const recorder = new ScreenRecorder();
    recorder.start();
    recorder.reset();
    recorder.start();
    expect(mocks.record).toHaveBeenCalledOnce();
  });

  it('getEvents()는 수집된 이벤트 배열을 반환한다', () => {
    const recorder = new ScreenRecorder();
    recorder.start();
    recorder.stop();
    const events = recorder.getEvents();
    expect(Array.isArray(events)).toBe(true);
    expect(events.length).toBeGreaterThan(0);
  });

  it('getEvents()를 start() 전에 호출하면 에러를 던진다', () => {
    const recorder = new ScreenRecorder();
    expect(() => recorder.getEvents()).toThrow('No recording available');
  });
});
