import { limitText } from '../network/bodyLimit.js';

export type ConsoleLevel = 'error' | 'warn' | 'log' | 'info';

/**
 * 콘솔 엔트리 하나의 message·stack 최대 글자 수. 큰 상태 객체를 자주 찍는 앱에서
 * 엔트리마다 수 MB 문자열이 maxEntries개까지 쌓이지 않도록 자른다.
 */
export const MAX_CONSOLE_TEXT_LENGTH = 10_000;

export interface ConsoleEntry {
  timestamp: string;
  level: ConsoleLevel;
  message: string;
  stack?: string;
  _offsetMs: number;
}

export class ConsoleCapture {
  private buffer: ConsoleEntry[] = [];
  private originalMethods: Partial<Record<ConsoleLevel, (...args: unknown[]) => void>> = {};
  private originalOnError: typeof window.onerror = null;
  private unhandledRejectionHandler: ((e: PromiseRejectionEvent) => void) | null = null;
  private recordingStartedAt: Date | null = null;

  constructor(
    private readonly maxEntries = 200,
    private readonly levels: ConsoleLevel[] = ['error', 'warn'],
  ) {}

  start(): void {
    this.recordingStartedAt = new Date();

    for (const level of this.levels) {
      this.originalMethods[level] = console[level] as (...args: unknown[]) => void;
      const original = this.originalMethods[level]!;
      const self = this;
      (console[level] as (...args: unknown[]) => void) = function (...args: unknown[]) {
        self.push(level, args);
        original.call(console, ...args);
      };
    }

    this.originalOnError = window.onerror;
    window.onerror = (message, source, lineno, colno, error) => {
      const parts = [
        `[Uncaught] ${message}`,
        source ? `at ${source}:${lineno}:${colno}` : '',
      ].filter(Boolean);
      this.push('error', parts, error?.stack);
      return typeof this.originalOnError === 'function'
        ? (this.originalOnError(message, source, lineno, colno, error) as boolean)
        : false;
    };

    this.unhandledRejectionHandler = (e: PromiseRejectionEvent) => {
      const msg = e.reason instanceof Error
        ? `[Unhandled Promise] ${e.reason.message}`
        : `[Unhandled Promise] ${String(e.reason)}`;
      this.push('error', [msg], e.reason instanceof Error ? e.reason.stack : undefined);
    };
    window.addEventListener('unhandledrejection', this.unhandledRejectionHandler);
  }

  stop(): void {
    for (const level of this.levels) {
      if (this.originalMethods[level]) {
        (console[level] as (...args: unknown[]) => void) = this.originalMethods[level]!;
        delete this.originalMethods[level];
      }
    }

    window.onerror = this.originalOnError;
    this.originalOnError = null;

    if (this.unhandledRejectionHandler) {
      window.removeEventListener('unhandledrejection', this.unhandledRejectionHandler);
      this.unhandledRejectionHandler = null;
    }

    this.recordingStartedAt = null;
  }

  clearBuffer(): void {
    this.buffer = [];
    this.recordingStartedAt = new Date();
  }

  snapshot(): ConsoleEntry[] {
    return [...this.buffer];
  }

  /** 백업에서 복원된 엔트리를 버퍼 앞에 추가 (maxEntries 초과분 앞에서 제거) */
  restoreEntries(entries: ConsoleEntry[]): void {
    this.buffer = [...entries, ...this.buffer].slice(-this.maxEntries);
  }

  private push(level: ConsoleLevel, args: unknown[], stack?: string): void {
    const fullMessage = args
      .map((a) => {
        if (a === null) return 'null';
        if (a === undefined) return 'undefined';
        try {
          // Error는 own enumerable 프로퍼티가 없어 JSON.stringify 시 "{}"가 되므로 별도 포맷
          if (isErrorLike(a)) return formatError(a);
          return typeof a === 'object' ? JSON.stringify(a, errorReplacer) : String(a);
        } catch {
          try { return String(a); } catch { return '[unserializable]'; }
        }
      })
      .join(' ');
    const message = limitText(fullMessage, MAX_CONSOLE_TEXT_LENGTH);

    // 명시적 stack(window.onerror 등)이 우선, 없으면 첫 번째 Error 인자의 stack 사용
    const fullStack = stack ?? findErrorStack(args);
    const entryStack = fullStack === undefined ? undefined : limitText(fullStack, MAX_CONSOLE_TEXT_LENGTH);

    const entry: ConsoleEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      _offsetMs: this.recordingStartedAt
        ? Date.now() - this.recordingStartedAt.getTime()
        : 0,
      ...(entryStack ? { stack: entryStack } : {}),
    };

    if (this.buffer.length >= this.maxEntries) {
      this.buffer.shift();
    }
    this.buffer.push(entry);
  }
}

/**
 * Error 여부 판별. iframe 등 다른 realm의 Error는 instanceof가 false이므로 태그로도 확인.
 * DOMException은 환경에 따라 Error를 상속하지 않을 수 있어 태그를 별도로 허용.
 */
function isErrorLike(value: unknown): value is object {
  try {
    if (value instanceof Error) return true;
    if (value === null || typeof value !== 'object') return false;
    const tag = Object.prototype.toString.call(value);
    return tag === '[object Error]' || tag === '[object DOMException]';
  } catch {
    // revoked Proxy 등은 검사 자체가 throw
    return false;
  }
}

/**
 * `${name}: ${message}` 형태로 변환 (Error.prototype.toString과 동일하게 한쪽이 비어 있으면 나머지만).
 * message가 문자열이 아니면 String()으로 폴백.
 */
function formatError(err: object): string {
  const { name, message } = err as { name?: unknown; message?: unknown };
  if (typeof message !== 'string') return String(err);
  if (typeof name !== 'string' || !name) return message;
  return message ? `${name}: ${message}` : name;
}

/**
 * 객체/배열 안에 중첩된 Error를 { name, message }로 직렬화 (크기를 위해 stack은 제외).
 * JSON.stringify는 replacer보다 toJSON을 먼저 호출하므로, toJSON을 정의한 Error
 * (예: stack·요청 config를 노출하는 AxiosError)는 value만 보면 놓친다.
 * 그래서 holder(this)에 있는 toJSON 적용 전 원본 값도 확인한다 (readRawValue 참고).
 */
function errorReplacer(this: unknown, key: string, value: unknown): unknown {
  const raw = readRawValue(this, key, value);
  const err = raw !== value && isErrorLike(raw) ? raw : value;
  if (!isErrorLike(err)) return value;
  const { name, message } = err as { name?: unknown; message?: unknown };
  return { name, message };
}

/**
 * replacer가 받은 value의 toJSON 적용 전 원본 값 (알 수 없으면 value 그대로).
 * holder[key]로 다시 읽으면 getter·Proxy get trap이 한 번 더 실행되어 호스트 앱이 관찰하는
 * 부수효과(예: getter 안의 deprecation 경고가 두 번 기록됨)가 생기므로, 데이터 프로퍼티의
 * descriptor에서만 읽는다. 따라서 getter로 노출된 Error는 toJSON 결과 기준으로만 판별된다.
 * descriptor는 노드마다 할당되므로 value가 객체일 때만 조회한다. AxiosError처럼 stack·config를
 * 노출하는 toJSON은 객체를 반환하며, 원시값을 반환한 toJSON의 원본은 확인하지 않는다.
 */
function readRawValue(holder: unknown, key: string, value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  try {
    const desc = Object.getOwnPropertyDescriptor(holder, key);
    return desc && 'value' in desc ? desc.value : value;
  } catch {
    // holder 접근이 throw하면(revoked Proxy 등) toJSON 결과 기준으로만 판별
    return value;
  }
}

/** 인자 중 첫 번째 Error의 stack (없거나 읽을 수 없으면 undefined) */
function findErrorStack(args: unknown[]): string | undefined {
  const err = args.find(isErrorLike);
  if (!err) return undefined;
  try {
    const { stack } = err as { stack?: unknown };
    return typeof stack === 'string' && stack ? stack : undefined;
  } catch {
    return undefined;
  }
}
