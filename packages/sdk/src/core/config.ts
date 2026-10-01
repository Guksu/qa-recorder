import type { ConsoleLevel } from '../console/ConsoleCapture.js';

export type RecorderMode = 'light' | 'normal' | 'heavy';

export interface QARecorderConfig {
  /**
   * Remote upload URL. When set, recorded files are POSTed as `multipart/form-data`
   * instead of being downloaded locally. If the server returns `{ url: "..." }`,
   * a share-link copy button is shown automatically. If the upload fails, the same data
   * is downloaded as a local ZIP instead; if that also fails, the recording is kept so
   * the user can try again.
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
   * Keys whose values are redacted (replaced with `"[MASKED]"`) before anything is stored, in:
   *
   * - Request URLs of captured `fetch` / XHR calls: query parameters (also in the HAR
   *   `queryString`) and a fragment that contains `=` — an OAuth implicit-flow fragment such as
   *   `#access_token=…&token_type=bearer`, or the query of a hash route such as `#/reset?token=…`.
   * - JSON or `application/x-www-form-urlencoded` request and response bodies. JSON bodies are
   *   searched recursively through nested objects and arrays; a matching key's whole value is
   *   masked, even if it is an object.
   * - The page URL that rrweb records in the replay (the `href` of the Meta event it emits with
   *   each full snapshot), with the same query and fragment rules — so a reset-password or
   *   magic-link `?token=` or an OAuth `#access_token=` is masked there when it is a top-level
   *   query or fragment parameter of the page URL.
   *
   * `null` and empty-string values are kept as-is.
   *
   * `maskKeys` matches key names only and never looks inside a string value, so the address-bar
   * URL, and any token in it, can still reach the replay, the HTML report and the sessionStorage
   * backup in ways it does not cover — for example:
   *
   * - A token in the page URL's path, or nested inside the value of a parameter whose key does
   *   not match (plain or percent-encoded), such as `/reset-password/{token}` or
   *   `?next=/reset?token=…`, stays in the recorded page URL.
   * - Captured requests and responses that carry the page URL as the value of a key that does
   *   not match keep the token in it: analytics or error-reporting payloads (a `dl=` parameter,
   *   `context.page.url`, `request.url`), a `returnTo=` redirect, or the app's own logging
   *   requests.
   * - Text and links inside the page's DOM. rrweb stores relative links such as `href="#main"`
   *   and SVG `<use href="#icon">` as absolute URLs that include the page's query string. Mask
   *   such text with `maskTextSelector`, and leave elements whose links carry a token out of the
   *   replay with the `rr-block` class.
   * - Console entries, such as the message and stack trace of an uncaught error thrown from an
   *   inline script, which include the page URL.
   *
   * Matching: the key and each entry are lowercased and stripped of ASCII non-alphanumeric
   * characters (`_`, `-`, `.`, spaces, …). A key matches when it equals or ends with an entry,
   * ignoring trailing digits, or when the whole key is the plural of an entry — so
   * `access_token`, `x-api-key`, `newPassword`, `refreshToken`, `password2`, `tokens` and
   * `apiKeys` all match. Plurals only count as the whole key, so counters such as `max_tokens`
   * are not masked.
   *
   * Trade-offs: non-secret keys with a matching suffix are masked too (e.g. a pagination cursor
   * named `nextPageToken`). Secrets under names that contain no entry — such as the
   * `access` / `refresh` pair some JWT libraries return, or the `oobCode` of a Firebase
   * email-action link — are not detected; add those keys to the list if your app uses them.
   *
   * Setting this replaces the default list; `[]` turns off all of the masking above (header
   * masking is controlled separately by `maskHeaders`).
   *
   * @default ['password', 'passwd', 'pwd', 'passwordConfirm', 'passwordConfirmation', 'passphrase', 'passcode', 'secret', 'secretKey', 'token', 'jwt', 'apiKey', 'accessKey', 'clientSecret', 'privateKey', 'credential', 'authorization', 'sessionId', 'otp', 'otpCode', 'ssn', 'cardNumber', 'cvv', 'cvc']
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
   * history (and at most two). After a failed save, the kept recording is retained until
   * the next checkout (counted from when recording resumed), so a later save may include
   * more than two intervals.
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
   * When `true`, the replay masks the values of every `<input>` (including hidden inputs and
   * inputs without a `type` attribute), `<textarea>` and `<select>`; the checked state of
   * checkboxes and radio buttons is still recorded. For a `<textarea>` this also covers its text
   * content (text in the page markup, or written through `defaultValue` as React does for
   * controlled textareas), whose non-whitespace characters become `*`. When `false`, only
   * password inputs are masked (rrweb's default).
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
   * CSS selector for elements to leave out of the replay — a matched element present in a full
   * snapshot is recorded as an empty placeholder of the same size. rrweb (1.1.3) checks this
   * selector only against the element being serialized, so content added to or changed inside a
   * matched element after the snapshot (e.g. a region your SPA renders later) and values typed
   * into its form fields are still recorded. For reliable exclusion of private or dynamic
   * regions and form fields, add the `rr-block` class to the element instead (rrweb honours it
   * for the element's whole subtree, including later mutations and input events).
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
    'password', 'passwd', 'pwd', 'passwordConfirm', 'passwordConfirmation', 'passphrase', 'passcode',
    'secret', 'secretKey', 'token', 'jwt', 'apiKey', 'accessKey', 'clientSecret', 'privateKey',
    'credential', 'authorization', 'sessionId', 'otp', 'otpCode', 'ssn', 'cardNumber', 'cvv', 'cvc',
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
  // Object.fromEntries는 Chrome 73부터라 README의 지원 범위(Chrome 72+)에 맞춰 직접 만든다
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (value !== undefined) result[key] = value;
  }
  return result as QARecorderConfig;
}

export function resolveConfig(overrides?: QARecorderConfig): Required<QARecorderConfig> {
  const fromWindow = (window as Window & { __QA_RECORDER_CONFIG__?: QARecorderConfig })
    .__QA_RECORDER_CONFIG__ ?? {};
  return { ...DEFAULT_CONFIG, ...stripUndefined(fromWindow), ...stripUndefined(overrides ?? {}) };
}
