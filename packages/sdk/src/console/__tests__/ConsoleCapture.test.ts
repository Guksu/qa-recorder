import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

  it('null/undefined 인자는 문자열로 기록된다', () => {
    capture.start();
    console.error(null, undefined);
    expect(capture.snapshot()[0].message).toBe('null undefined');
  });

  it('일반 객체는 JSON 문자열로 기록된다', () => {
    capture.start();
    console.error({ a: 1, b: [2, 'x'] });
    expect(capture.snapshot()[0].message).toBe('{"a":1,"b":[2,"x"]}');
  });

  describe('Error 인자', () => {
    it('Error 인자는 "{}"가 아니라 name: message로 기록된다', () => {
      capture.start();
      console.error(new Error('boom'));
      expect(capture.snapshot()[0].message).toBe('Error: boom');
    });

    it('문자열 뒤에 오는 Error 인자도 name: message로 기록된다', () => {
      capture.start();
      console.error('ctx', new Error('boom'));
      expect(capture.snapshot()[0].message).toBe('ctx Error: boom');
    });

    it('TypeError는 TypeError 이름으로 기록된다', () => {
      capture.start();
      console.error(new TypeError('bad type'));
      expect(capture.snapshot()[0].message).toBe('TypeError: bad type');
    });

    it('커스텀 name을 가진 Error 서브클래스는 해당 name으로 기록된다', () => {
      class ValidationError extends Error {
        constructor(message: string) {
          super(message);
          this.name = 'ValidationError';
        }
      }
      capture.start();
      console.error(new ValidationError('invalid input'));
      expect(capture.snapshot()[0].message).toBe('ValidationError: invalid input');
    });

    it('name이 비어 있으면 message만 기록된다', () => {
      const err = new Error('no name');
      err.name = '';
      capture.start();
      console.error(err);
      expect(capture.snapshot()[0].message).toBe('no name');
    });

    it('DOMException도 name: message로 기록된다', () => {
      capture.start();
      console.error(new DOMException('node missing', 'NotFoundError'));
      expect(capture.snapshot()[0].message).toBe('NotFoundError: node missing');
    });

    it('객체 안에 중첩된 Error는 stack 없이 { name, message }로 기록된다', () => {
      capture.start();
      console.error({ err: new Error('boom') });
      const msg = capture.snapshot()[0].message;
      expect(msg).toBe('{"err":{"name":"Error","message":"boom"}}');
      expect(msg).not.toContain('stack');
    });

    it('배열 안에 중첩된 Error도 { name, message }로 기록된다', () => {
      capture.start();
      console.error([new RangeError('out of range')]);
      expect(capture.snapshot()[0].message).toBe('[{"name":"RangeError","message":"out of range"}]');
    });

    it('toJSON을 정의한 중첩 Error도 toJSON 결과 대신 { name, message }로 기록된다', () => {
      // AxiosError처럼 toJSON이 stack/config(요청 헤더 포함)를 노출하는 경우
      class HttpError extends Error {
        config = { headers: { Authorization: 'Bearer SECRET' } };
        constructor(message: string) {
          super(message);
          this.name = 'HttpError';
        }
        toJSON() {
          return { name: this.name, message: this.message, stack: this.stack, config: this.config };
        }
      }
      const err = new HttpError('Request failed');
      capture.start();
      console.error('ctx', { error: err }, [err]);
      const msg = capture.snapshot()[0].message;
      expect(msg).toBe(
        'ctx {"error":{"name":"HttpError","message":"Request failed"}} [{"name":"HttpError","message":"Request failed"}]',
      );
      expect(msg).not.toContain('SECRET');
      expect(msg).not.toContain('stack');
    });

    it('toJSON이 Error를 반환하는 객체도 { name, message }로 기록된다', () => {
      const wrapper = { toJSON: () => new TypeError('from toJSON') };
      capture.start();
      console.error({ wrapped: wrapper });
      expect(capture.snapshot()[0].message).toBe(
        '{"wrapped":{"name":"TypeError","message":"from toJSON"}}',
      );
    });

    it('Error 인자의 stack이 엔트리 stack으로 기록된다', () => {
      const err = new Error('with stack');
      capture.start();
      console.error('ctx', err);
      expect(err.stack).toBeTruthy();
      expect(capture.snapshot()[0].stack).toBe(err.stack);
    });

    it('Error 인자가 여러 개면 첫 번째 Error의 stack이 기록된다', () => {
      const first = new Error('first');
      const second = new Error('second');
      first.stack = 'Error: first\n    at first.js:1:1';
      second.stack = 'Error: second\n    at second.js:1:1';
      capture.start();
      console.error(first, second);
      expect(capture.snapshot()[0].stack).toBe(first.stack);
    });

    it('Error 인자가 없으면 stack이 기록되지 않는다', () => {
      capture.start();
      console.error('plain', { err: new Error('nested') });
      expect(capture.snapshot()[0].stack).toBeUndefined();
    });

    it('window.onerror 경로는 전달받은 error의 stack을 그대로 사용한다', () => {
      const err = new Error('Uncaught TypeError');
      err.stack = 'TypeError: explicit\n    at app.js:10:5';
      capture.start();
      window.onerror?.('Uncaught TypeError', 'app.js', 10, 5, err);
      const entry = capture.snapshot()[0];
      expect(entry.message).toBe('[Uncaught] Uncaught TypeError at app.js:10:5');
      expect(entry.stack).toBe('TypeError: explicit\n    at app.js:10:5');
    });

    it('window.onerror에 error 객체가 없으면 stack이 기록되지 않는다', () => {
      capture.start();
      window.onerror?.('Script error.', '', 0, 0, undefined);
      const entry = capture.snapshot()[0];
      expect(entry.message).toBe('[Uncaught] Script error.');
      expect(entry.stack).toBeUndefined();
    });

    it('다른 realm의 Error처럼 instanceof가 false여도 태그가 Error면 Error로 처리된다', () => {
      const foreign = {
        name: 'RangeError',
        message: 'from iframe',
        stack: 'RangeError: from iframe\n    at frame.js:3:7',
        [Symbol.toStringTag]: 'Error',
      };
      expect(foreign instanceof Error).toBe(false);
      capture.start();
      console.error(foreign);
      const entry = capture.snapshot()[0];
      expect(entry.message).toBe('RangeError: from iframe');
      expect(entry.stack).toBe('RangeError: from iframe\n    at frame.js:3:7');
    });
  });

  describe('직렬화가 호스트 객체에 주는 부수효과', () => {
    /**
     * 원본 console 출력이 getter·trap 호출 수에 섞이지 않도록 capture 시작 전에 무음 처리하고,
     * 콜백이 끝나면 capture를 멈춘 뒤 원래 console로 되돌린다.
     */
    function captureSilently(run: () => void): void {
      const spies = [
        vi.spyOn(console, 'error').mockImplementation(() => {}),
        vi.spyOn(console, 'warn').mockImplementation(() => {}),
      ];
      try {
        capture.start();
        run();
      } finally {
        capture.stop();
        spies.forEach((spy) => spy.mockRestore());
      }
    }

    it('중첩 객체의 getter는 한 번만 호출된다', () => {
      let reads = 0;
      const payload = {
        get detail() {
          reads++;
          return { code: 42 };
        },
      };
      captureSilently(() => console.error('ctx', payload));
      expect(reads).toBe(1);
      expect(capture.snapshot()[0].message).toBe('ctx {"detail":{"code":42}}');
    });

    it('getter 안에서 남긴 경고가 버퍼에 중복 기록되지 않는다', () => {
      captureSilently(() =>
        console.error('save failed', {
          id: 1,
          get oldField() {
            console.warn('oldField is deprecated');
            return 'x';
          },
        }),
      );
      expect(capture.snapshot().map((e) => `${e.level}:${e.message}`)).toEqual([
        'warn:oldField is deprecated',
        'error:save failed {"id":1,"oldField":"x"}',
      ]);
    });

    it('Proxy의 get trap을 JSON.stringify보다 더 호출하지 않고, 안의 toJSON Error도 { name, message }로 기록된다', () => {
      class HttpError extends Error {
        config = { headers: { Authorization: 'Bearer SECRET' } };
        constructor(message: string) {
          super(message);
          this.name = 'HttpError';
        }
        toJSON() {
          return { name: this.name, message: this.message, stack: this.stack, config: this.config };
        }
      }
      const err = new HttpError('Request failed');
      const makeState = (onGet: () => void) =>
        new Proxy({ a: 1, b: { c: 2 }, error: err }, {
          get(target, key, receiver) {
            if (typeof key === 'string') onGet();
            return Reflect.get(target, key, receiver);
          },
        });

      let baselineGets = 0;
      JSON.stringify({ state: makeState(() => baselineGets++) });
      expect(baselineGets).toBeGreaterThan(0);

      let gets = 0;
      captureSilently(() => console.error({ state: makeState(() => gets++) }));

      expect(gets).toBe(baselineGets);
      const msg = capture.snapshot()[0].message;
      expect(msg).toBe(
        '{"state":{"a":1,"b":{"c":2},"error":{"name":"HttpError","message":"Request failed"}}}',
      );
      expect(msg).not.toContain('SECRET');
    });
  });

  describe('검사·직렬화 중 throw하는 인자', () => {
    /**
     * findErrorStack은 push()의 인자별 try/catch 밖에서 실행되므로, 호스트의 console 호출이 throw하지
     * 않는 것은 isErrorLike·findErrorStack 안의 try/catch에만 달려 있다.
     * 원본 console.error를 무음 spy로 바꾸고(capture가 spy를 감싸도록 start() 전에) console.error(...args)를
     * 호출해, throw하지 않는지와 인자가 그대로 원본에 전달됐는지 확인한다.
     * hostile 인자는 동등성 비교(toHaveBeenCalledWith) 중에도 throw할 수 있어 동일성만 비교한다.
     */
    function expectForwardedWithoutThrow(args: unknown[]): void {
      const originalError = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        capture.start();
        expect(() => console.error(...args)).not.toThrow();
        expect(originalError).toHaveBeenCalledTimes(1);
        const forwarded = originalError.mock.calls[0];
        expect(forwarded.length).toBe(args.length);
        args.forEach((arg, i) => expect(forwarded[i]).toBe(arg));
      } finally {
        capture.stop();
        originalError.mockRestore();
      }
    }

    it('revoked Proxy 인자가 있어도 호출이 throw하지 않고 [unserializable]로 기록된다', () => {
      const { proxy, revoke } = Proxy.revocable({}, {});
      revoke();
      expectForwardedWithoutThrow(['ctx', proxy]);
      expect(capture.snapshot().map((e) => e.message)).toEqual(['ctx [unserializable]']);
    });

    it('stack getter가 throw하는 Error 인자는 호출이 throw하지 않고 stack 없이 name: message로 기록된다', () => {
      const err = new Error('y');
      Object.defineProperty(err, 'stack', {
        get() {
          throw new Error('stack unavailable');
        },
      });
      expectForwardedWithoutThrow(['ctx', err]);
      const entries = capture.snapshot();
      expect(entries.map((e) => e.message)).toEqual(['ctx Error: y']);
      expect(entries[0].stack).toBeUndefined();
    });

    it('getPrototypeOf trap이 throw하는 Proxy 인자도 호출이 throw하지 않고 {}로 기록된다', () => {
      const hostile = new Proxy({}, {
        getPrototypeOf() {
          throw new Error('getPrototypeOf trap');
        },
      });
      expectForwardedWithoutThrow(['ctx', hostile]);
      expect(capture.snapshot().map((e) => e.message)).toEqual(['ctx {}']);
    });

    it('없는 키를 읽으면 get trap이 throw하는 Proxy 인자도 호출이 throw하지 않고 [unserializable]로 기록된다', () => {
      // instanceof는 throw 없이 false이고, Object.prototype.toString이 Symbol.toStringTag를 읽을 때 throw
      // (JSON.stringify는 toJSON, String()은 Symbol.toPrimitive를 읽다가 throw)
      const strict = new Proxy({ a: 1 }, {
        get(target, key, receiver) {
          if (!(key in target)) throw new Error(`unknown key ${String(key)}`);
          return Reflect.get(target, key, receiver);
        },
      });
      expectForwardedWithoutThrow(['ctx', strict]);
      expect(capture.snapshot().map((e) => e.message)).toEqual(['ctx [unserializable]']);
    });

    it('Symbol.toStringTag getter가 throw하는 인자도 호출이 throw하지 않고 {}로 기록된다', () => {
      // instanceof는 false이고, Object.prototype.toString이 태그를 읽을 때 getter가 throw.
      // JSON.stringify는 심볼 키를 무시하므로 {}로 직렬화된다
      const tagged = {
        get [Symbol.toStringTag]() {
          throw new Error('tag getter');
        },
      };
      expectForwardedWithoutThrow(['ctx', tagged]);
      expect(capture.snapshot().map((e) => e.message)).toEqual(['ctx {}']);
    });

    it('JSON.stringify와 String()이 모두 throw하는 인자는 [unserializable]로 남고 나머지 인자는 그대로 기록된다', () => {
      // 순환 참조라 JSON.stringify가 throw하고, null 프로토타입이라 toString이 없어 String()도 throw
      const bag: Record<string, unknown> = Object.create(null);
      bag.self = bag;
      expectForwardedWithoutThrow(['ctx', bag, 'tail']);
      expect(capture.snapshot().map((e) => e.message)).toEqual(['ctx [unserializable] tail']);
    });
  });
});
