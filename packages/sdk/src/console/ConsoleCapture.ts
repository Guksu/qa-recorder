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
          return typeof a === 'object' ? JSON.stringify(a) : String(a);
        } catch {
          return '[unserializable]';
        }
      })
      .join(' ');

    const entry: ConsoleEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      _offsetMs: this.recordingStartedAt
        ? Date.now() - this.recordingStartedAt.getTime()
        : 0,
      ...(stack ? { stack } : {}),
    };

    if (this.buffer.length >= this.maxEntries) {
      this.buffer.shift();
    }
    this.buffer.push(entry);
  }
}
