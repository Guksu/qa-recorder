import type { ConsoleLevel } from '../console/ConsoleCapture.js';

export type RecorderMode = 'light' | 'normal' | 'heavy';

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
   * Matching is case-insensitive. Setting this replaces the default list.
   *
   * @default ['Authorization', 'Cookie', 'Set-Cookie', 'Proxy-Authorization', 'X-API-Key', 'X-Auth-Token', 'X-CSRF-Token', 'X-XSRF-Token']
   */
  maskHeaders?: string[];

  /**
   * Keys whose values are redacted (replaced with `"[MASKED]"`) in URL query parameters and in
   * JSON or `application/x-www-form-urlencoded` request/response bodies. JSON bodies are
   * searched recursively through nested objects and arrays; a matching key's whole value is
   * masked, even if it is an object. `null` and empty-string values are kept as-is.
   *
   * Matching: the key and each entry are lowercased and stripped of ASCII non-alphanumeric
   * characters (`_`, `-`, `.`, spaces, …). A key matches when it equals or ends with an entry,
   * ignoring trailing digits — so `access_token`, `x-api-key`, `newPassword`, `refreshToken`
   * and `password2` all match. Trade-off: non-secret keys with a matching suffix are masked too
   * (e.g. a pagination cursor named `nextPageToken`).
   *
   * Setting this replaces the default list; `[]` disables body and query-string masking
   * (header masking is controlled separately by `maskHeaders`).
   *
   * @default ['password', 'passwd', 'pwd', 'passwordConfirm', 'passwordConfirmation', 'secret', 'token', 'apiKey', 'clientSecret', 'privateKey', 'authorization', 'sessionId', 'otp', 'ssn', 'cardNumber', 'cvv', 'cvc']
   */
  maskKeys?: string[];

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
   * When `true`, the current session is automatically saved to sessionStorage whenever
   * the tab is hidden (refresh, navigate). On the next `init()` within the same tab
   * session, the backup is silently restored into the current buffers before recording
   * continues. Note: sessionStorage is cleared when the tab is closed, so this only
   * survives page refreshes and navigations — not full tab/browser closes.
   *
   * @default false
   */
  enableBackup?: boolean;

  /**
   * Recording intensity preset. Controls rrweb's checkout interval and event sampling
   * to keep the in-memory buffer bounded on long or heavy pages. The last two checkout
   * segments are retained, so a save always includes at least one full interval of
   * history (and at most two).
   *
   * - `'light'`: 30-minute checkout, no sampling — retains the last 30–60 minutes
   * - `'normal'`: 20-minute checkout, no sampling — retains the last 20–40 minutes (default)
   * - `'heavy'`: 5-minute checkout, throttled mousemove/scroll/input — retains the last
   *   5–10 minutes (heavy pages with frequent DOM mutations, animations, or long sessions)
   *
   * @default 'normal'
   */
  mode?: RecorderMode;

  /**
   * When `true`, the replay masks the values of every `<input>`, `<textarea>` and `<select>`.
   * When `false`, only password inputs are masked (rrweb's default).
   *
   * @default false
   */
  maskAllInputs?: boolean;

  /**
   * CSS selector for elements whose text is masked in the replay (non-whitespace characters
   * become `*`).
   * Elements with the `rr-mask` class are always masked.
   *
   * @default null
   */
  maskTextSelector?: string | null;

  /**
   * CSS selector for elements to leave out of the replay — they are recorded as an empty
   * placeholder of the same size. rrweb applies this selector only when serializing the DOM,
   * so values typed into form fields inside a matched element are still captured; for those,
   * use the `rr-block` class (which rrweb also honours for input and interaction events) or
   * `maskAllInputs`.
   *
   * @default null
   */
  blockSelector?: string | null;
}

const DEFAULT_CONFIG: Required<QARecorderConfig> = {
  endpoint: '',
  maxRequests: 100,
  maskHeaders: [
    'Authorization', 'Cookie', 'Set-Cookie',
    'Proxy-Authorization', 'X-API-Key', 'X-Auth-Token', 'X-CSRF-Token', 'X-XSRF-Token',
  ],
  maskKeys: [
    'password', 'passwd', 'pwd', 'passwordConfirm', 'passwordConfirmation',
    'secret', 'token', 'apiKey', 'clientSecret', 'privateKey', 'authorization',
    'sessionId', 'otp', 'ssn', 'cardNumber', 'cvv', 'cvc',
  ],
  zIndex: 2147483647,
  consoleLevels: ['error', 'warn'],
  maxConsoleEntries: 200,
  enableBackup: false,
  mode: 'normal',
  maskAllInputs: false,
  maskTextSelector: null,
  blockSelector: null,
};

/** 명시적으로 undefined가 담긴 키가 기본값을 덮어쓰지 않도록 제거 */
function stripUndefined(config: QARecorderConfig): QARecorderConfig {
  return Object.fromEntries(
    Object.entries(config).filter(([, value]) => value !== undefined),
  ) as QARecorderConfig;
}

export function resolveConfig(overrides?: QARecorderConfig): Required<QARecorderConfig> {
  const fromWindow = (window as Window & { __QA_RECORDER_CONFIG__?: QARecorderConfig })
    .__QA_RECORDER_CONFIG__ ?? {};
  return { ...DEFAULT_CONFIG, ...stripUndefined(fromWindow), ...stripUndefined(overrides ?? {}) };
}
