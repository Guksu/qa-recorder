import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

  it('프라이버시 옵션 미지정 시 rrweb 기본값(비밀번호 입력만 마스킹, 셀렉터 없음)을 유지한다', () => {
    const recorder = new ScreenRecorder();
    recorder.start();
    const opts = mocks.record.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts.maskAllInputs).toBe(false);
    expect(opts).not.toHaveProperty('maskInputOptions');
    expect(opts).not.toHaveProperty('maskTextSelector');
    expect(opts).not.toHaveProperty('blockSelector');
  });

  it('maskTextSelector / blockSelector를 record()에 그대로 전달한다', () => {
    const recorder = new ScreenRecorder('normal', {
      maskTextSelector: '.pii',
      blockSelector: '[data-private]',
    });
    recorder.start();
    expect(mocks.record).toHaveBeenCalledWith(expect.objectContaining({
      maskTextSelector: '.pii',
      blockSelector: '[data-private]',
    }));
  });

  it('maskAllInputs: true는 textarea 텍스트 자식도 가리도록 maskTextSelector에 textarea를 더한다', () => {
    new ScreenRecorder('normal', { maskAllInputs: true }).start();
    new ScreenRecorder('normal', { maskAllInputs: true, maskTextSelector: '.pii', blockSelector: '[data-private]' }).start();
    const [onlyInputs, withSelectors] = mocks.record.mock.calls.map(([opts]) => opts as Record<string, unknown>);
    expect(onlyInputs!.maskTextSelector).toBe('textarea');
    expect(withSelectors!.maskTextSelector).toBe('.pii, textarea');
    expect(withSelectors!.blockSelector).toBe('[data-private]');
  });

  it('maskAllInputs: true는 태그 이름 키(input)를 더한 maskInputOptions로 전달한다 (rrweb은 maskAllInputs: true면 이를 무시)', () => {
    const recorder = new ScreenRecorder('normal', { maskAllInputs: true });
    recorder.start();
    const opts = mocks.record.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts).not.toHaveProperty('maskAllInputs');
    expect(opts.maskInputOptions).toEqual(expect.objectContaining({
      input: true, text: true, email: true, textarea: true, select: true, password: true,
    }));
  });

  it('셀렉터가 null이면 record()에 전달하지 않는다', () => {
    const recorder = new ScreenRecorder('normal', { maskTextSelector: null, blockSelector: null });
    recorder.start();
    const opts = mocks.record.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts).not.toHaveProperty('maskTextSelector');
    expect(opts).not.toHaveProperty('blockSelector');
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

  describe('resume()', () => {
    type Emit = (event: unknown, isCheckout?: boolean) => void;

    /** record() 호출마다 emit 함수를 보관하고 Meta + FullSnapshot을 emit하는 mock */
    function mockRecordSessions(): Emit[] {
      const emits: Emit[] = [];
      mocks.record.mockImplementation(({ emit }: { emit: Emit }) => {
        emits.push(emit);
        const t = emits.length * 1000;
        emit({ type: 4, data: {}, timestamp: t });
        emit({ type: 2, data: {}, timestamp: t + 1 });
        return mocks.stopFn;
      });
      return emits;
    }

    const timestamps = (events: unknown[]) => events.map((e) => (e as { timestamp: number }).timestamp);
    const types = (events: unknown[]) => events.map((e) => (e as { type: number }).type);

    it('stopped 상태에서 기존 이벤트를 유지한 채 record()를 다시 시작한다', () => {
      const emits = mockRecordSessions();
      const recorder = new ScreenRecorder();
      recorder.start();
      emits[0]!({ type: 3, data: {}, timestamp: 1500 });
      recorder.stop();

      recorder.resume();

      expect(mocks.record).toHaveBeenCalledTimes(2);
      expect(timestamps(recorder.getEvents())).toEqual([1000, 1001, 1500, 2000, 2001]);
    });

    it('재개 후 이벤트는 [기존, 신규 Meta, FullSnapshot, ...] 순서라 그대로 재생 가능하다', () => {
      const emits = mockRecordSessions();
      const recorder = new ScreenRecorder();
      recorder.start();
      emits[0]!({ type: 3, data: {}, timestamp: 1500 });
      recorder.stop();

      recorder.resume();
      emits[1]!({ type: 3, data: {}, timestamp: 2500 });

      // 기존 구간 뒤에 새 FullSnapshot 기준 구간이 이어짐
      expect(types(recorder.getEvents())).toEqual([4, 2, 3, 4, 2, 3]);
    });

    it('체크아웃 이전 구간까지 포함해 보존하고, 다음 체크아웃 때 보존된 이벤트는 폐기된다', () => {
      const emits = mockRecordSessions();
      const recorder = new ScreenRecorder();
      recorder.start();
      emits[0]!({ type: 4, data: {}, timestamp: 1100 }, true); // 체크아웃 → prevEvents로 이동
      emits[0]!({ type: 2, data: {}, timestamp: 1101 });
      recorder.stop();

      recorder.resume();
      expect(timestamps(recorder.getEvents())).toEqual([1000, 1001, 1100, 1101, 2000, 2001]);

      emits[1]!({ type: 4, data: {}, timestamp: 3000 }, true);
      expect(timestamps(recorder.getEvents())).toEqual([2000, 2001, 3000]);
    });

    it('재개 후 stop()은 새로 시작된 record()의 stop 함수를 호출한다', () => {
      mockRecordSessions();
      const recorder = new ScreenRecorder();
      recorder.start();
      recorder.stop();
      recorder.resume();
      recorder.stop();
      expect(mocks.stopFn).toHaveBeenCalledTimes(2);
    });

    it('recording 중에 호출하면 아무 동작도 하지 않는다', () => {
      const emits = mockRecordSessions();
      const recorder = new ScreenRecorder();
      recorder.start();
      emits[0]!({ type: 3, data: {}, timestamp: 1500 });

      recorder.resume();

      expect(mocks.record).toHaveBeenCalledOnce();
      expect(timestamps(recorder.getEvents())).toEqual([1000, 1001, 1500]);
    });

    it('idle 상태에서 호출하면 보존할 녹화가 없으므로 start()처럼 새로 녹화를 시작한다', () => {
      mockRecordSessions();
      const recorder = new ScreenRecorder();

      recorder.resume();

      expect(mocks.record).toHaveBeenCalledOnce();
      expect(timestamps(recorder.getEvents())).toEqual([1000, 1001]);
    });

    it('reset() 후 호출하면 이전 녹화 없이 새로 시작한다', () => {
      mockRecordSessions();
      const recorder = new ScreenRecorder();
      recorder.start();
      recorder.stop();
      recorder.reset();

      recorder.resume();

      expect(timestamps(recorder.getEvents())).toEqual([2000, 2001]);
    });
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

  describe('페이지 URL 마스킹 (Meta 이벤트 href)', () => {
    type Emit = (event: unknown, isCheckout?: boolean) => void;
    const MASK_KEYS = ['token', 'password'];
    const SECRET_HREF = 'https://app.example.com/reset?token=RESET-SECRET&lang=ko#access_token=AT-SECRET&token_type=bearer';
    const MASKED_HREF = 'https://app.example.com/reset?token=[MASKED]&lang=ko#access_token=[MASKED]&token_type=bearer';

    const meta = (href: string, timestamp = 1000) => ({ type: 4, data: { href, width: 1280, height: 720 }, timestamp });

    /** record()가 주어진 이벤트를 순서대로 emit하도록 설정 */
    function emitOnRecord(...calls: [event: unknown, isCheckout?: boolean][]) {
      mocks.record.mockImplementation(({ emit }: { emit: Emit }) => {
        calls.forEach(([event, isCheckout]) => emit(event, isCheckout));
        return mocks.stopFn;
      });
    }

    it('maskKeys에 매칭되는 쿼리·fragment 값을 Meta 이벤트의 href에서 가린다 (체크아웃 스냅샷 포함)', () => {
      emitOnRecord(
        [meta(SECRET_HREF, 1000)],
        [{ type: 2, data: {}, timestamp: 1001 }],
        [meta(SECRET_HREF, 5000), true], // 체크아웃 → 새 구간
        [{ type: 2, data: {}, timestamp: 5001 }],
      );
      const recorder = new ScreenRecorder('normal', { maskKeys: MASK_KEYS });
      recorder.start();

      const metas = recorder.getEvents().filter((e) => (e as { type: number }).type === 4);
      expect(metas).toEqual([
        { type: 4, data: { href: MASKED_HREF, width: 1280, height: 720 }, timestamp: 1000 },
        { type: 4, data: { href: MASKED_HREF, width: 1280, height: 720 }, timestamp: 5000 },
      ]);
    });

    it('rrweb이 넘긴 Meta 이벤트 객체는 수정하지 않고 새 객체로 저장한다', () => {
      const original = meta(SECRET_HREF);
      emitOnRecord([original]);
      const recorder = new ScreenRecorder('normal', { maskKeys: MASK_KEYS });
      recorder.start();

      const [stored] = recorder.getEvents() as (typeof original)[];
      expect(stored).not.toBe(original);
      expect(stored!.data).not.toBe(original.data);
      expect(stored!.data.href).toBe(MASKED_HREF);
      expect(original).toEqual(meta(SECRET_HREF));
    });

    it('Meta 이외의 이벤트와 가릴 값이 없거나 href가 없는 Meta 이벤트는 받은 객체 그대로 저장한다', () => {
      const emitted = [
        { type: 2, data: { node: { type: 0, childNodes: [] } }, timestamp: 1000 },
        { type: 3, data: { source: 0, adds: [], removes: [] }, timestamp: 1001 },
        { type: 5, data: { tag: 'route', payload: { path: '/reset' } }, timestamp: 1002 },
        meta('https://app.example.com/search?q=token#section', 1003),
        { type: 4, data: {}, timestamp: 1004 },
      ];
      emitOnRecord(...emitted.map((event): [unknown] => [event]));
      const recorder = new ScreenRecorder('normal', { maskKeys: MASK_KEYS });
      recorder.start();

      const events = recorder.getEvents();
      expect(events).toHaveLength(emitted.length);
      events.forEach((event, i) => expect(event).toBe(emitted[i]));
    });

    it('maskKeys: []이거나 미지정이면 페이지 URL을 마스킹하지 않는다', () => {
      const original = meta(SECRET_HREF);
      emitOnRecord([original]);
      const disabled = new ScreenRecorder('normal', { maskKeys: [] });
      const unset = new ScreenRecorder();
      disabled.start();
      unset.start();

      expect(disabled.getEvents()[0]).toBe(original);
      expect(unset.getEvents()[0]).toBe(original);
      expect(original.data.href).toBe(SECRET_HREF);
    });

    it('prependEvents()로 복원한 백업의 Meta href도 가린다 (마스킹 이전 버전이 저장한 백업 대비)', () => {
      const recorder = new ScreenRecorder('normal', { maskKeys: MASK_KEYS });
      recorder.start();
      const restoredMeta = meta(SECRET_HREF, Date.now() - 2000);
      recorder.prependEvents([restoredMeta, { type: 2, data: {}, timestamp: Date.now() - 1000 }]);

      const first = recorder.getEvents()[0] as typeof restoredMeta;
      expect(first.data.href).toBe(MASKED_HREF);
      expect(restoredMeta.data.href).toBe(SECRET_HREF);
    });
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

describe('ScreenRecorder 크기 제한 (maxReplaySize)', () => {
  type Emit = (event: unknown, isCheckout?: boolean) => void;
  let emit: Emit;
  let now = 0;

  /** JSON 문자 수가 대략 size인 incremental 이벤트 */
  const incremental = (size: number) => ({ type: 3, data: { pad: 'x'.repeat(size) }, timestamp: ++now });
  const types = (events: unknown[]) => events.map((e) => (e as { type: number }).type);
  const jsonSize = (events: unknown[]) => JSON.stringify(events).length;

  /**
   * record()는 Meta + FullSnapshot(크기 snapshotSize)을 emit하고, takeFullSnapshot(isCheckout)도
   * rrweb처럼 Meta(isCheckout 전달) + FullSnapshot을 emit하도록 설정
   */
  function mockRrweb(snapshotSize = 100) {
    const snapshot = () => {
      emit({ type: 4, data: {}, timestamp: ++now }, false);
      emit({ type: 2, data: { pad: 'x'.repeat(snapshotSize) }, timestamp: ++now });
    };
    mocks.record.mockImplementation(({ emit: e }: { emit: Emit }) => {
      emit = e;
      snapshot();
      return mocks.stopFn;
    });
    mocks.takeFullSnapshot.mockImplementation((isCheckout?: boolean) => {
      emit({ type: 4, data: {}, timestamp: ++now }, isCheckout);
      emit({ type: 2, data: { pad: 'x'.repeat(snapshotSize) }, timestamp: ++now });
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    now = 0;
  });

  afterEach(() => {
    mocks.takeFullSnapshot.mockReset();
  });

  it('지금 구간이 제한의 절반을 넘지 않으면 새 구간을 시작하지 않는다', () => {
    mockRrweb();
    const recorder = new ScreenRecorder('normal', {}, 10_000);
    recorder.start();
    for (let i = 0; i < 4; i++) emit(incremental(1_000));
    expect(mocks.takeFullSnapshot).not.toHaveBeenCalled();
  });

  it('지금 구간이 제한의 절반을 넘으면 takeFullSnapshot(true)로 새 구간을 시작하고, 이전 구간은 그대로 둔다', () => {
    mockRrweb();
    const recorder = new ScreenRecorder('normal', {}, 10_000);
    recorder.start();
    for (let i = 0; i < 3; i++) emit(incremental(2_000));

    expect(mocks.takeFullSnapshot).toHaveBeenCalledOnce();
    expect(mocks.takeFullSnapshot).toHaveBeenCalledWith(true);
    // [Meta, FullSnapshot, 변경 3개] + 새 구간 [Meta, FullSnapshot]
    expect(types(recorder.getEvents())).toEqual([4, 2, 3, 3, 3, 4, 2]);
    expect(types(recorder.getRecentEvents())).toEqual([4, 2]);
  });

  it('구간이 계속 넘어가도 보관하는 이벤트는 제한 근처로 유지되고, 항상 스냅샷부터 시작한다', () => {
    mockRrweb();
    const recorder = new ScreenRecorder('normal', {}, 10_000);
    recorder.start();
    for (let i = 0; i < 200; i++) emit(incremental(1_000));

    const events = recorder.getEvents();
    expect(mocks.takeFullSnapshot.mock.calls.length).toBeGreaterThan(10);
    // 두 구간이 각각 절반(5,000자)을 넘은 직후에 넘어가므로 이벤트 하나만큼 넘칠 수 있다
    expect(jsonSize(events)).toBeLessThan(10_000 + 2 * 1_100);
    expect(types(events).slice(0, 2)).toEqual([4, 2]);
  });

  it('스냅샷이 큰 페이지에서는 스냅샷 뒤의 변경분이 스냅샷보다 커질 때까지 새 구간을 시작하지 않는다', () => {
    // 스냅샷(약 6,000자) 하나가 제한의 절반(5,000자)보다 크다 — 확인 없이 넘기면 이벤트마다 스냅샷을 다시 찍는다
    mockRrweb(6_000);
    const recorder = new ScreenRecorder('normal', {}, 10_000);
    recorder.start();

    // 이벤트 하나는 JSON 껍데기를 포함해 약 1,040자 — 5개(약 5,200자)는 스냅샷(약 6,070자)보다 작다
    for (let i = 0; i < 5; i++) emit(incremental(1_000));
    expect(mocks.takeFullSnapshot).not.toHaveBeenCalled();

    emit(incremental(1_000)); // 6개(약 6,240자)로 스냅샷보다 커진다
    expect(mocks.takeFullSnapshot).toHaveBeenCalledOnce();

    // 새 구간도 같은 기준이 적용된다
    for (let i = 0; i < 5; i++) emit(incremental(1_000));
    expect(mocks.takeFullSnapshot).toHaveBeenCalledOnce();
  });

  it('stop() 뒤에 늦게 emit된 이벤트로는 스냅샷을 찍지 않는다', () => {
    mockRrweb();
    const recorder = new ScreenRecorder('normal', {}, 10_000);
    recorder.start();
    recorder.stop();

    emit(incremental(20_000));

    expect(mocks.takeFullSnapshot).not.toHaveBeenCalled();
  });

  it('clearBuffer() 뒤에는 크기를 처음부터 다시 센다', () => {
    mockRrweb();
    const recorder = new ScreenRecorder('normal', {}, 10_000);
    recorder.start();
    emit(incremental(4_000));

    recorder.clearBuffer(); // takeFullSnapshot() — 체크아웃 아님
    mocks.takeFullSnapshot.mockClear();
    // 새 스냅샷(약 130자) 뒤 약 4,540자 — 지우기 전부터 셌다면 구간이 약 8,800자로 절반을 넘고,
    // 스냅샷 크기도 약 4,300자로 잡혀 변경분이 더 커지므로 새 구간을 시작하게 된다
    emit(incremental(4_500));

    expect(mocks.takeFullSnapshot).not.toHaveBeenCalled();
  });

  it.each([
    ['미지정', undefined],
    ['Infinity', Infinity],
    ['0', 0],
    ['NaN', NaN],
  ])('maxReplaySize가 %s이면 크기와 상관없이 새 구간을 시작하지 않는다', (_, maxReplaySize) => {
    mockRrweb();
    const recorder = new ScreenRecorder('normal', {}, maxReplaySize);
    recorder.start();
    for (let i = 0; i < 10; i++) emit(incremental(100_000));
    expect(mocks.takeFullSnapshot).not.toHaveBeenCalled();
  });

  it('getRecentEvents()는 지금 구간만 반환하고, 녹화 전에는 에러를 던진다', () => {
    mockRrweb();
    const recorder = new ScreenRecorder();
    expect(() => recorder.getRecentEvents()).toThrow('No recording available');

    recorder.start();
    emit(incremental(10));
    emit({ type: 4, data: {}, timestamp: ++now }, true); // 시간 기준 체크아웃
    emit({ type: 2, data: {}, timestamp: ++now });
    emit(incremental(10));

    expect(types(recorder.getEvents())).toEqual([4, 2, 3, 4, 2, 3]);
    expect(types(recorder.getRecentEvents())).toEqual([4, 2, 3]);
  });
});
