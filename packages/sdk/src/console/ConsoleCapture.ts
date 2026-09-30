export type ConsoleLevel = 'error' | 'warn' | 'log' | 'info';

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
    const message = args
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

    // 명시적 stack(window.onerror 등)이 우선, 없으면 첫 번째 Error 인자의 stack 사용
    const entryStack = stack ?? findErrorStack(args);

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
 * 그래서 holder(this)에서 toJSON 적용 전 원본 값을 다시 읽어 판별한다.
 */
function errorReplacer(this: unknown, key: string, value: unknown): unknown {
  let raw: unknown = value;
  try {
    raw = (this as Record<string, unknown>)[key];
  } catch {
    // holder 접근이 throw하면(revoked Proxy 등) toJSON 결과 기준으로만 판별
  }
  const err = isErrorLike(raw) ? raw : value;
  if (!isErrorLike(err)) return value;
  const { name, message } = err as { name?: unknown; message?: unknown };
  return { name, message };
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
