import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ScreenRecorder } from '../ScreenRecorder.js';

const mocks = vi.hoisted(() => ({
  stopFn: vi.fn(),
  record: vi.fn(),
  takeFullSnapshot: vi.fn(),
}));

vi.mock('rrweb', () => ({
  record: Object.assign(mocks.record, { takeFullSnapshot: mocks.takeFullSnapshot }),
}));

describe('ScreenRecorder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.record.mockImplementation(({ emit }: { emit: (event: unknown, isCheckout?: boolean) => void }) => {
      emit({ type: 2, data: {}, timestamp: 1000 });
      return mocks.stopFn;
    });
  });

  it('start()는 rrweb.record()를 호출한다', () => {
    const recorder = new ScreenRecorder();
    recorder.start();
    expect(mocks.record).toHaveBeenCalledOnce();
  });

  it('start()는 checkoutEveryNms 20분 옵션을 전달한다', () => {
    const recorder = new ScreenRecorder();
    recorder.start();
    expect(mocks.record).toHaveBeenCalledWith(
      expect.objectContaining({ checkoutEveryNms: 20 * 60 * 1000 }),
    );
  });

  it('start()를 중복 호출해도 record는 한 번만 호출된다', () => {
    const recorder = new ScreenRecorder();
    recorder.start();
    recorder.start();
    expect(mocks.record).toHaveBeenCalledOnce();
  });

  it('isCheckout이 true이면 이벤트 배열을 해당 이벤트만으로 초기화한다', () => {
    const recorder = new ScreenRecorder();
    mocks.record.mockImplementation(({ emit }: { emit: (event: unknown, isCheckout?: boolean) => void }) => {
      emit({ type: 2, data: {}, timestamp: 1000 });         // 일반 이벤트
      emit({ type: 2, data: {}, timestamp: 2000 });         // 일반 이벤트
      emit({ type: 2, data: {}, timestamp: 3000 }, true);   // 체크포인트 (이전 버퍼 초기화)
      emit({ type: 3, data: {}, timestamp: 4000 });         // 이후 이벤트
      return mocks.stopFn;
    });
    recorder.start();
    const events = recorder.getEvents();
    expect(events).toHaveLength(2); // 체크포인트 이벤트 + 이후 이벤트
    expect((events[0] as { timestamp: number }).timestamp).toBe(3000);
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

  it('getEvents()는 수집된 이벤트 배열을 반환한다', () => {
    const recorder = new ScreenRecorder();
    recorder.start();
    const events = recorder.getEvents();
    expect(Array.isArray(events)).toBe(true);
    expect(events.length).toBeGreaterThan(0);
  });

  it('getEvents()를 start() 전에 호출하면 에러를 던진다', () => {
    const recorder = new ScreenRecorder();
    expect(() => recorder.getEvents()).toThrow('No recording available');
  });

  it('clearBuffer()는 이벤트를 초기화하고 takeFullSnapshot을 호출한다', () => {
    const recorder = new ScreenRecorder();
    recorder.start();
    recorder.clearBuffer();
    expect(mocks.takeFullSnapshot).toHaveBeenCalledOnce();
    expect(recorder.getEvents()).toHaveLength(0);
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

  it('prependEvents()는 20분 이내 이벤트를 버퍼 앞에 추가한다', () => {
    const recorder = new ScreenRecorder();
    recorder.start();
    const eventsBefore = recorder.getEvents().length;
    const initial = [{ type: 2, data: {}, timestamp: Date.now() - 1000 }];
    recorder.prependEvents(initial);
    expect(recorder.getEvents().length).toBe(eventsBefore + 1);
    expect((recorder.getEvents()[0] as { timestamp: number }).timestamp).toBe(initial[0].timestamp);
  });

  it('prependEvents()에서 20분 초과된 이벤트는 필터링된다', () => {
    const recorder = new ScreenRecorder();
    recorder.start();
    const old = { type: 2, data: {}, timestamp: Date.now() - 21 * 60 * 1000 };
    const recent = { type: 2, data: {}, timestamp: Date.now() - 1000 };
    recorder.prependEvents([old, recent]);
    const events = recorder.getEvents();
    expect(events.some(e => (e as { timestamp: number }).timestamp === old.timestamp)).toBe(false);
    expect(events.some(e => (e as { timestamp: number }).timestamp === recent.timestamp)).toBe(true);
  });

  it('prependEvents() 이후 신규 이벤트가 뒤에 추가된다', () => {
    const recorder = new ScreenRecorder();
    mocks.record.mockImplementation(({ emit }: { emit: (event: unknown) => void }) => {
      emit({ type: 3, data: {}, timestamp: Date.now() });
      return mocks.stopFn;
    });
    recorder.start();
    const initial = [{ type: 2, data: {}, timestamp: Date.now() - 1000 }];
    recorder.prependEvents(initial);
    const events = recorder.getEvents();
    expect((events[0] as { timestamp: number }).timestamp).toBe(initial[0].timestamp);
    expect((events[events.length - 1] as { type: number }).type).toBe(3);
  });
});
