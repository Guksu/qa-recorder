import type { ConsoleLevel } from '../console/ConsoleCapture.js';

export interface QARecorderConfig {
  /**
   * Remote upload URL. When set, recorded files are POSTed as `multipart/form-data`
   * instead of being downloaded locally. If the server returns `{ url: "..." }`,
   * a share-link copy button is shown automatically.
   *
   * @default '' (local download)
   */
  endpoint?: string;

  /**
   * Maximum number of network entries to keep in the circular buffer.
   * Older entries are evicted as new ones arrive.
   *
   * @default 100
   */
  maxRequests?: number;

  /**
   * HTTP header names to redact before saving. Values are replaced with `"[MASKED]"`.
   * Matching is case-insensitive.
   *
   * @default ['Authorization', 'Cookie', 'Set-Cookie']
   */
  maskHeaders?: string[];

  /**
   * CSS `z-index` applied to all UI elements (floating button, progress bar, share panel).
   *
   * @default 2147483647
   */
  zIndex?: number;

  /**
   * Console levels to capture. Valid values: `'error'`, `'warn'`, `'log'`, `'info'`.
   *
   * @default ['error', 'warn']
   */
  consoleLevels?: ConsoleLevel[];

  /**
   * Maximum number of console entries to keep in the circular buffer.
   * Older entries are evicted as new ones arrive.
   *
   * @default 200
   */
  maxConsoleEntries?: number;

  /**
   * When `true`, the current session is automatically saved to IndexedDB whenever
   * the tab becomes hidden (refresh, close, navigate). On the next `init()`, the
   * backup is silently restored into the current session buffers before recording
   * continues. The 20-minute rolling window is always respected.
   *
   * @default false
   */
  enableBackup?: boolean;
}

const DEFAULT_CONFIG: Required<QARecorderConfig> = {
  endpoint: '',
  maxRequests: 100,
  maskHeaders: ['Authorization', 'Cookie', 'Set-Cookie'],
  zIndex: 2147483647,
  consoleLevels: ['error', 'warn'],
  maxConsoleEntries: 200,
  enableBackup: false,
};

export function resolveConfig(overrides?: QARecorderConfig): Required<QARecorderConfig> {
  const fromWindow = (window as Window & { __QA_RECORDER_CONFIG__?: QARecorderConfig })
    .__QA_RECORDER_CONFIG__ ?? {};
  return { ...DEFAULT_CONFIG, ...fromWindow, ...overrides };
}
