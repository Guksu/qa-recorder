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

  it('체크아웃이 발생해도 직전 구간은 유지된다 (최소 한 주기 히스토리 보장)', () => {
    const recorder = new ScreenRecorder();
    mocks.record.mockImplementation(({ emit }: { emit: (event: unknown, isCheckout?: boolean) => void }) => {
      emit({ type: 2, data: {}, timestamp: 1000 });         // 이전 구간
      emit({ type: 3, data: {}, timestamp: 2000 });         // 이전 구간
      emit({ type: 4, data: {}, timestamp: 3000 }, true);   // 체크아웃 → 새 구간 시작
      emit({ type: 3, data: {}, timestamp: 4000 });         // 현재 구간
      return mocks.stopFn;
    });
    recorder.start();
    const events = recorder.getEvents();
    expect(events).toHaveLength(4); // 직전 구간 2개 + 체크아웃 이벤트 + 이후 이벤트
    expect((events[0] as { timestamp: number }).timestamp).toBe(1000);
  });

  it('체크아웃이 두 번 발생하면 가장 오래된 구간은 폐기된다 (최대 두 구간 유지)', () => {
    const recorder = new ScreenRecorder();
    mocks.record.mockImplementation(({ emit }: { emit: (event: unknown, isCheckout?: boolean) => void }) => {
      emit({ type: 2, data: {}, timestamp: 1000 });         // 1구간 (폐기 대상)
      emit({ type: 4, data: {}, timestamp: 2000 }, true);   // 체크아웃 1 → 2구간 시작
      emit({ type: 3, data: {}, timestamp: 3000 });
      emit({ type: 4, data: {}, timestamp: 4000 }, true);   // 체크아웃 2 → 3구간 시작
      emit({ type: 3, data: {}, timestamp: 5000 });
      return mocks.stopFn;
    });
    recorder.start();
    const events = recorder.getEvents();
    expect(events).toHaveLength(4); // 2구간(2개) + 3구간(2개)
    expect((events[0] as { timestamp: number }).timestamp).toBe(2000);
    expect(events.some(e => (e as { timestamp: number }).timestamp === 1000)).toBe(false);
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

  it('clearBuffer()는 녹화 중이 아니면 takeFullSnapshot을 호출하지 않는다', () => {
    const recorder = new ScreenRecorder();
    expect(() => recorder.clearBuffer()).not.toThrow();
    expect(mocks.takeFullSnapshot).not.toHaveBeenCalled();

    recorder.start();
    recorder.stop();
    recorder.clearBuffer();
    expect(mocks.takeFullSnapshot).not.toHaveBeenCalled();
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

  it('prependEvents()는 컷오프로 FullSnapshot이 잘리면 고아 incremental 이벤트도 버린다', () => {
    const recorder = new ScreenRecorder();
    recorder.start();
    const eventsBefore = recorder.getEvents().length;
    // FullSnapshot은 컷오프(20분) 밖, incremental만 안에 남는 상황
    const staleSnapshot = { type: 2, data: {}, timestamp: Date.now() - 21 * 60 * 1000 };
    const orphan1 = { type: 3, data: {}, timestamp: Date.now() - 2000 };
    const orphan2 = { type: 3, data: {}, timestamp: Date.now() - 1000 };
    recorder.prependEvents([staleSnapshot, orphan1, orphan2]);
    expect(recorder.getEvents()).toHaveLength(eventsBefore); // 전부 폐기
  });

  it('prependEvents()는 첫 FullSnapshot 앞의 이벤트를 제거하되 직전 Meta는 유지한다', () => {
    const recorder = new ScreenRecorder();
    recorder.start();
    const orphan   = { type: 3, data: {}, timestamp: Date.now() - 5000 };
    const meta     = { type: 4, data: {}, timestamp: Date.now() - 4000 };
    const snapshot = { type: 2, data: {}, timestamp: Date.now() - 3000 };
    const after    = { type: 3, data: {}, timestamp: Date.now() - 2000 };
    recorder.prependEvents([orphan, meta, snapshot, after]);

    const events = recorder.getEvents();
    expect(events.some(e => (e as { timestamp: number }).timestamp === orphan.timestamp)).toBe(false);
    expect((events[0] as { timestamp: number }).timestamp).toBe(meta.timestamp);
    expect((events[1] as { timestamp: number }).timestamp).toBe(snapshot.timestamp);
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

  describe('mode preset', () => {
    it("mode='light'는 checkoutEveryNms 30분, sampling 없음을 전달한다", () => {
      const recorder = new ScreenRecorder('light');
      recorder.start();
      const opts = mocks.record.mock.calls[0]![0] as Record<string, unknown>;
      expect(opts.checkoutEveryNms).toBe(30 * 60 * 1000);
      expect(opts.sampling).toBeUndefined();
    });

    it("mode='normal'은 checkoutEveryNms 20분, sampling 없음을 전달한다 (기본값)", () => {
      const recorder = new ScreenRecorder('normal');
      recorder.start();
      const opts = mocks.record.mock.calls[0]![0] as Record<string, unknown>;
      expect(opts.checkoutEveryNms).toBe(20 * 60 * 1000);
      expect(opts.sampling).toBeUndefined();
    });

    it("mode='heavy'는 checkoutEveryNms 5분, sampling을 전달한다", () => {
      const recorder = new ScreenRecorder('heavy');
      recorder.start();
      const opts = mocks.record.mock.calls[0]![0] as Record<string, unknown>;
      expect(opts.checkoutEveryNms).toBe(5 * 60 * 1000);
      expect(opts.sampling).toEqual({ mousemove: 100, scroll: 150, input: 'last' });
    });

    it("mode='heavy'에서 prependEvents는 5분 컷오프를 적용한다", () => {
      const recorder = new ScreenRecorder('heavy');
      recorder.start();
      const beyondHeavy = { type: 2, data: {}, timestamp: Date.now() - 6 * 60 * 1000 };
      const withinHeavy = { type: 2, data: {}, timestamp: Date.now() - 1000 };
      recorder.prependEvents([beyondHeavy, withinHeavy]);
      const events = recorder.getEvents();
      expect(events.some(e => (e as { timestamp: number }).timestamp === beyondHeavy.timestamp)).toBe(false);
      expect(events.some(e => (e as { timestamp: number }).timestamp === withinHeavy.timestamp)).toBe(true);
    });
  });
});
