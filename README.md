# qa-recorder

[![npm version](https://img.shields.io/npm/v/qa-recorder?color=crimson)](https://www.npmjs.com/package/qa-recorder)
[![license](https://img.shields.io/npm/l/qa-recorder?color=blue)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
**One-click QA capture for web apps. Uses rrweb DOM serialization to collect session flow, network requests, and console errors — unified in a single self-contained report, no backend required.**

**[→ Live Demo](https://guksu.github.io/qa-recorder/)**

[한국어](./README.ko.md)

---

## Why qa-recorder?

Reproducing bugs in web applications is hard. When a QA engineer clicks a button and an error appears, the developer needs three things to debug it: **what was on screen**, **what network requests were made**, and **what errors were logged**. A screenshot and a text description are rarely enough.

`qa-recorder` uses **rrweb DOM serialization** — not video capture — to record every DOM mutation, user interaction, network request, and console error from the moment the SDK starts. Because rrweb serializes the DOM tree rather than recording a video stream, there are no large files, no screen-share permissions, and the capture works on mobile, WebView, and any browser.

By default it keeps the last 20–40 minutes in memory (less on very busy pages — see `mode` and `maxReplaySize`). When your QA team wants to capture a session, they click the floating button once, optionally add a bug memo, then save:

- A **DOM session replay** of the entire interaction (rrweb events — lightweight, no video)
- A **HAR network log** of the last 100 requests
- **Environment info** — browser, screen size, masked page URL and SDK version
- A **unified QA report** — session replay + network inspector + console errors time-synchronized in one self-contained HTML file

No backend required. No browser extension. No screen share permission. Just add one script tag.

---

## Features

| Feature | Description |
|---|---|
| **DOM session replay** | Captures every DOM change via `MutationObserver` (rrweb). Works on mobile, WebView, and any browser — no `getDisplayMedia` needed. |
| **Network capture** | Intercepts `fetch` and `XHR`. Circular buffer, up to 100 entries, exported as a standard HAR 1.2 file. Values a page cannot observe (HTTP version, header sizes, per-phase timings) are marked as unknown instead of being made up — see [HAR output](#har-output). |
| **Console capture** | Captures `console.error` and `console.warn` (add `log` and `info` with `consoleLevels`), uncaught errors and unhandled promise rejections. The app's own `window.onerror` is left untouched. |
| **Unified QA report** | Single self-contained HTML: session replay (left) + network inspector, console log and environment info (right). Time-synchronized — clicking a network row or console entry seeks to that exact moment. |
| **Network detail panel** | Click any request row to inspect Headers, Payload, Response, and Timing — Chrome DevTools style. |
| **Sensitive data masking** | Before anything is stored, the values of passwords, tokens, API keys and other sensitive keys (`maskKeys`) are redacted in request URLs (query and fragment), JSON and form request/response bodies, and the page URL recorded in the replay — along with `Authorization`, `Cookie` and other auth headers. Keys are matched by name only, so a token in a URL path or inside another key's value (a `?next=` redirect, a page URL sent to analytics) is not detected — see `maskKeys`. Text and links inside the page's DOM are not covered by `maskKeys`: `maskAllInputs` and `maskTextSelector` mask input values and text in the replay, and elements with the `rr-block` class are left out (see `blockSelector` for its limits). The SDK's own UI (button, save dialog with the bug memo) is never recorded into the replay. |
| **Local save** | Downloads a single ZIP file directly — no backend needed. Recording keeps running while the ZIP is created. |
| **Remote upload** | Optionally POST files to your own server, with a time limit (`uploadTimeout`). Shows a share-link copy button on success; falls back to a local ZIP on failure. Recording keeps running while the upload is in flight. |
| **Bug memo** | Optional text note added at save time — embedded in the unified HTML report and sent with remote uploads. |
| **Environment info** | Browser (user agent), language, time zone, viewport and screen size, device pixel ratio, the page URL (masked with `maskKeys`) and the SDK version are saved with every report — shown in the report's **Environment** tab, stored as `qa-env-*.json` and sent with remote uploads. Document title and referrer are not collected. |
| **Session continuity** | `enableBackup: true` auto-saves the session to sessionStorage on tab hide and silently restores it after a page refresh or navigation — no prompts. If the session is too large for sessionStorage, a smaller backup is kept (see `enableBackup`). (Note: data is cleared when the tab is closed.) |
| **Shadow DOM UI** | Floating button and modals are fully isolated from the host page's styles. Drag the button out of the way with a mouse, finger or pen. |

---

## Installation

```bash
npm install qa-recorder
# or
pnpm add qa-recorder
```

Or drop it in via `<script>` tag (UMD build, no bundler required):

```html
<script src="https://unpkg.com/qa-recorder@1/dist/qa-recorder.umd.js"></script>
```

`@1` loads the latest 1.x release, so a future major version with breaking changes is never picked up automatically. Pin an exact version (for example `@1.13.0`) if you need fully predictable builds.

---

## Quick Start

### Vanilla JS

```ts
import { QARecorder } from 'qa-recorder';

QARecorder.setup({
  enableBackup: true,
});
// Recording starts immediately — no permission prompt, no click needed.
// A dark floating button with a blinking red REC dot appears in the bottom-right corner.
// The last 20–40 minutes are kept in memory (less on very busy pages — see maxReplaySize).
// 1 click → confirm → one ZIP file downloads automatically → recording continues.
```

### React

Call `QARecorder.setup()` at the module level — outside any component or hook. This is safe even in React StrictMode since `setup()` is idempotent (subsequent calls are no-ops).

```ts
// main.tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QARecorder } from 'qa-recorder';
import App from './App';

QARecorder.setup({ enableBackup: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

### Vue

```ts
// main.ts
import { createApp } from 'vue';
import { QARecorder } from 'qa-recorder';
import App from './App.vue';

QARecorder.setup({ enableBackup: true });

createApp(App).mount('#app');
```

### Script tag

```html
<script>
  window.__QA_RECORDER_CONFIG__ = {
    enableBackup: true,
    maxRequests: 100,
  };
</script>
<script src="https://unpkg.com/qa-recorder@1/dist/qa-recorder.umd.js"></script>
```

---

## Save Modes

### Local (default)

When no `endpoint` is configured, a single ZIP file is downloaded to the user's device:

| File | Contents |
|---|---|
| `qa-report-{timestamp}.zip` | Contains the files below |
| `qa-session-{timestamp}.rr.json` | DOM session replay (rrweb events) |
| `qa-network-{timestamp}.har` | Network log (HAR 1.2) |
| `qa-env-{timestamp}.json` | Environment info (browser, language, time zone, viewport, masked page URL, SDK version) |
| `qa-report-{timestamp}.html` | Unified QA report — session replay + network + console in one file |

Recording does not stop while saving. Everything captured up to the click is saved; what happens on the page while the ZIP is being built (DOM changes, requests, console entries) is kept for the next save. After a successful save only the saved part is cleared, so consecutive saves never repeat or lose data. If saving fails, nothing is cleared: the next save includes the failed part as well, with no duplicates.

### Remote upload

Set an `endpoint` to POST files to your server instead. On success, if the server returns a `url` field, a share-link copy button is shown automatically. If the upload fails — an error response, a network error, or no answer within `uploadTimeout` (default 2 minutes) — the same data is downloaded as a local ZIP instead; if that also fails, the recording is kept so you can try again. As with local saves, recording continues while the upload is in flight.

Calling `destroy()` during an upload aborts the request. That is not treated as a failed upload: no ZIP is downloaded, no message is shown, and a late server response has no effect.

```ts
const recorder = new QARecorder({
  endpoint: 'https://your-server.com/upload',
});
await recorder.init();
```

Expected server response (optional):

```json
{ "url": "https://your-server.com/share/abc123" }
```

The files are sent as `multipart/form-data`:

```
POST /upload
  session  →  qa-session-{timestamp}.rr.json
  har      →  qa-network-{timestamp}.har     (standard HAR 1.2: { "log": { ... } })
  console  →  qa-console-{timestamp}.json   (console log entries)
  report   →  qa-report-{timestamp}.html    (unified QA report)
  env      →  qa-env-{timestamp}.json       (environment info)
  memo     →  (optional) bug memo text entered by the user
```

### HAR output

`qa-network-*.har` (in the ZIP and in the `har` upload field) is a standard HAR 1.2 document, validated in the test suite against the HAR 1.2 JSON schema, so it opens in Chrome DevTools, HAR analyzers and other HAR tools:

```json
{ "log": { "version": "1.2", "creator": { "name": "qa-recorder", "version": "…" }, "entries": [ … ], "comment": "…" } }
```

> **Changed:** earlier versions wrote the `log` object itself (`{ "version", "creator", "entries" }`) without the top-level `log` key. If your server reads the uploaded `har` field, read `har.log.entries` instead of `har.entries`.

The SDK captures requests from inside the page, where some details are not observable. Instead of filling them with plausible-looking values, they are marked as unknown:

| Field | Value | Why |
|---|---|---|
| `request/response.httpVersion` | `""` | `fetch`/XHR do not expose the protocol (HTTP/1.1, h2, h3). |
| `headersSize`, `response.bodySize` | `-1` | Header sizes and the transferred (possibly compressed) body size are not observable. |
| `response.content.size` | decoded size in bytes, or `-1` | Known only when the body was read in full; `-1` for binary bodies (not read) and bodies cut at `maxBodySize`. |
| `request.bodySize` | bytes sent, `0` with no body, or `-1` | `-1` for bodies whose size the page cannot know (e.g. `FormData`, streams). |
| `cookies` | `[]` | Cookies are not captured (`Cookie`/`Set-Cookie` are not readable by the page and are masked anyway). |
| `timings` | `send: 0`, `wait: time`, `receive: 0`, others `-1`, plus a `comment` | Only the total time is measured (fetch: until the response headers arrive; XHR: until `loadend`). HAR requires `send`/`wait`/`receive` to add up to `time`, so the total is reported as `wait` and the `comment` says the split was not measured. |

Bodies that were not captured have no `text` and carry a `comment` (binary content, non-text request bodies); a body cut at `maxBodySize` keeps the captured text and notes the cut in `comment`. Masked values appear as `[MASKED]` (percent-encoded as `%5BMASKED%5D` inside URLs, which must be valid URIs). Each entry also keeps a custom `_offsetMs` field (milliseconds since recording started), used by the report's timeline.

---

## Configuration

All options can be set via `window.__QA_RECORDER_CONFIG__` or passed to `QARecorder.setup()` (or the constructor). Options passed in code take precedence.

```ts
window.__QA_RECORDER_CONFIG__ = {
  endpoint: '',              // Remote upload URL. Leave empty for local save (default).
  uploadTimeout: 120000,     // Time limit for one upload in ms (default: 2 minutes). 0 or Infinity = no limit.
  maxRequests: 100,          // Max network entries in the circular buffer (default: 100).
  maxBodySize: 102400,       // Max characters kept per request/response body (default: 100K). 0 = no bodies.
  maskHeaders: [             // Headers to redact before saving (default shown).
    'Authorization',
    'Cookie',
    'Set-Cookie',
    'Proxy-Authorization',
    'X-API-Key',
    'X-Auth-Token',
    'X-CSRF-Token',
    'X-XSRF-Token',
  ],
  maskKeys: [                // Keys to redact in request URLs, bodies and the replay's page URL (default shown). [] disables.
    'password', 'passwd', 'pwd', 'passwordConfirm', 'passwordConfirmation', 'passphrase', 'passcode',
    'secret', 'secretKey', 'token', 'jwt', 'apiKey', 'accessKey', 'clientSecret', 'privateKey',
    'credential', 'authorization', 'sessionId', 'otp', 'otpCode', 'ssn', 'cardNumber', 'cvv', 'cvc',
  ],
  zIndex: 2147483647,        // z-index for all UI elements (default: max int).
  consoleLevels: ['error', 'warn'],  // Console levels to capture (default shown).
  maxConsoleEntries: 200,    // Max console entries in the circular buffer (default: 200).
  enableBackup: false,       // Auto-save session to sessionStorage on tab hide and restore after refresh (default: false). Cleared on tab close.
  mode: 'normal',            // Recording intensity preset: 'light' | 'normal' | 'heavy' (default: 'normal').
  maxReplaySize: 20971520,   // Approximate max characters of replay kept in memory (default: 20 MB). Infinity = no size limit.
  maskAllInputs: false,      // Mask every input/textarea/select value in the replay (default: false = passwords only).
  maskTextSelector: null,    // CSS selector for elements whose text is masked in the replay (default: null).
  blockSelector: null,       // CSS selector for elements left out of the replay; see limits below (default: null).
};
```

| Option | Type | Default | Description |
|---|---|---|---|
| `endpoint` | `string` | `''` | Remote upload URL. Empty = local download. |
| `uploadTimeout` | `number` | `120000` | Time limit in milliseconds for one upload to `endpoint`, from sending the request until the response body has been read. When it runs out the request is aborted and treated as a failed upload (local ZIP fallback). `0` or `Infinity` turns the limit off. `destroy()` always aborts an upload in flight, without the fallback. |
| `maxRequests` | `number` | `100` | Max network entries to keep. |
| `maxBodySize` | `number` | `102400` | Max characters kept for each request and response body (about the same in bytes for ASCII text). Longer bodies are cut and end with a `…[truncated by qa-recorder …]` note. fetch responses are read only up to this limit, so large downloads and never-ending streams (e.g. SSE) do not pile up in memory. Binary responses (images, audio, video, fonts, PDF, ZIP, octet-stream) are recorded as `"[binary]"` without being read. `maskKeys` masking runs before cutting; a cut response is masked key by key as far as it was read. `0` records no bodies; `Infinity` keeps whole bodies. |
| `maskHeaders` | `string[]` | `['Authorization', 'Cookie', 'Set-Cookie', 'Proxy-Authorization', 'X-API-Key', 'X-Auth-Token', 'X-CSRF-Token', 'X-XSRF-Token']` | Headers to redact (case-insensitive). Setting this replaces the default list. |
| `maskKeys` | `string[]` | `['password', 'passwd', 'pwd', 'passwordConfirm', 'passwordConfirmation', 'passphrase', 'passcode', 'secret', 'secretKey', 'token', 'jwt', 'apiKey', 'accessKey', 'clientSecret', 'privateKey', 'credential', 'authorization', 'sessionId', 'otp', 'otpCode', 'ssn', 'cardNumber', 'cvv', 'cvc']` | Keys whose values are replaced with `"[MASKED]"` before anything is stored, in: request URLs of captured requests — query parameters and a fragment that contains `=` (an OAuth `#access_token=…&token_type=bearer` fragment, or a hash-route query such as `#/reset?token=…`); JSON (searched recursively through nested objects and arrays) or `application/x-www-form-urlencoded` request/response bodies; and the page URL that rrweb records in the replay, with the same query and fragment rules — so a reset-password or magic-link `?token=` or an OAuth `#access_token=` is masked there when it is a top-level query or fragment parameter of the page URL. `maskKeys` matches key names only and never looks inside a string value, so the address-bar URL, and any token in it, can still reach the replay, the HTML report and the sessionStorage backup in ways it doesn't cover, for example: a token in the page URL's path or nested inside the value of a parameter whose key doesn't match, plain or percent-encoded (`/reset-password/{token}`, `?next=/reset?token=…`), stays in the recorded page URL; captured requests and responses that carry the page URL as the value of a key that doesn't match keep the token in it — analytics or error-reporting payloads (a `dl=` parameter, `context.page.url`, `request.url`), a `returnTo=` redirect, or the app's own logging requests; text and links inside the page's DOM keep it too (rrweb stores relative links such as `href="#main"` and SVG `<use href="#icon">` as absolute URLs that include the page's query string) — mask such text with `maskTextSelector`, and leave elements whose links carry a token out of the replay with the `rr-block` class; and so do console entries, such as the message and stack trace of an uncaught error thrown from an inline script. Keys are compared case-insensitively, ignoring `_`, `-`, `.` and other symbols; a key matches when it equals or ends with an entry, ignoring trailing digits, or when the whole key is the plural of an entry — so `access_token`, `x-api-key`, `newPassword`, `password2`, `tokens` and `apiKeys` all match (counters such as `max_tokens` don't). Trade-offs: non-secret keys with a matching suffix, such as a `nextPageToken` pagination cursor, are masked too, while secrets under names that contain no entry — such as the `access` / `refresh` pair some JWT libraries return, or the `oobCode` of a Firebase email-action link — are not detected; list such keys in `maskKeys` along with the defaults. `null` and empty values are kept. Setting this replaces the default list; `[]` turns off all of this masking (headers are controlled by `maskHeaders`). |
| `zIndex` | `number` | `2147483647` | z-index for all UI elements (button, progress bar, share panel). |
| `consoleLevels` | `string[]` | `['error', 'warn']` | Console levels to capture. Valid values: `'error'`, `'warn'`, `'log'`, `'info'`. |
| `maxConsoleEntries` | `number` | `200` | Max console entries to keep in the circular buffer. Each entry's message and stack trace is cut at 10,000 characters. |
| `enableBackup` | `boolean` | `false` | When `true`, auto-saves the current session to sessionStorage whenever the tab becomes hidden (refresh, navigate). On the next `init()`, the backup is silently restored into the current session buffers before recording continues. The rolling window matches `mode` (light: 30m / normal: 20m / heavy: 5m). sessionStorage holds a limited amount (5,242,880 characters per origin in Chromium, keys included): when the whole session doesn't fit, only the current checkout segment of the replay is backed up, and when that doesn't fit either, only the network and console logs are. Note: data is cleared when the tab is closed. |
| `mode` | `'light' \| 'normal' \| 'heavy'` | `'normal'` | Recording intensity preset that controls rrweb's checkout interval and event sampling to keep the in-memory buffer bounded. Use `'heavy'` for pages with frequent DOM mutations, animations, or long sessions — 5-minute checkout plus throttled `mousemove`/`scroll`/`input`. Use `'light'` for lightweight pages where you want a longer 30-minute history. A segment also ends early when it grows past half of `maxReplaySize`, so a busy page can keep less time than this. |
| `maxReplaySize` | `number` | `20971520` (20 MB) | Approximate upper limit, in characters of JSON (about the same in bytes for ASCII text), on the replay kept in memory. When the current checkout segment grows past half of this, a new segment starts right away with a fresh full snapshot and the oldest segment is dropped — the same thing `mode`'s timed checkout does — so the saved replay still plays from its start. Each new segment begins with a full snapshot, which pauses the page briefly (measured in Chromium: about 40 ms for 3,000 elements, 500 ms for 60,000). A segment only ends early once the changes recorded after its snapshot outgrow the snapshot itself, so on a page whose single snapshot is larger than a quarter of this limit, the kept replay can exceed it (up to about four snapshots' worth). `Infinity` turns the size limit off. |
| `maskAllInputs` | `boolean` | `false` | When `true`, the replay masks the values of every `<input>` (including hidden inputs and inputs without a `type` attribute), `<textarea>` and `<select>`; the checked state of checkboxes and radio buttons is still recorded. For a `<textarea>` this also covers its text content (text in the page markup, or written through `defaultValue` as React does for controlled textareas), whose non-whitespace characters become `*`. When `false`, only password inputs are masked (rrweb's default). |
| `maskTextSelector` | `string \| null` | `null` | CSS selector for elements whose text is masked in the replay (non-whitespace characters become `*`). Elements with the `rr-mask` class are always masked. |
| `blockSelector` | `string \| null` | `null` | CSS selector for elements left out of the replay: a matched element in a full snapshot is recorded as an empty placeholder of the same size. rrweb 1.1.3 checks the selector only against the element being serialized, so content added to or changed inside a matched element later (e.g. a region your SPA renders after recording starts) and values typed into its form fields are still recorded. For reliable exclusion of private or dynamic regions and form fields, add the `rr-block` class to the element instead. |

---

## Lifecycle and TypeScript

`QARecorder.setup()` creates a singleton; `new QARecorder(config)` + `init()` gives you an instance you control. `destroy()` stops recording and removes everything the instance added: the `fetch`/`XHR`/`console` patches (only where they are still the recorder's own — a wrapper another library installed on top is left in place), the `error`/`unhandledrejection`/`pagehide` listeners, the button, an open save dialog, the progress bar and the share panel. An upload or local save in flight is cancelled, and its late completion can no longer restart recording or show any UI. You can call `init()` again (or `setup()` after destroying the singleton) to start a fresh recording; nothing from the previous one leaks into it.

The package ships its own type declarations (no other packages needed). Besides `QARecorder` and `QARecorderConfig`, the HAR types (`HARDocument`, `HARLog`, `HAREntry`, …), `RecorderMode`, `ConsoleEntry` and `ConsoleLevel` are exported for typing `getNetworkEntries()` results and uploaded files. `rrweb` and `fflate` are bundled into the build, so the package has no runtime dependencies.

---

## How It Works

```
QARecorder.setup() / init()
  ├─ NetworkCapture.start()   → patches window.fetch + XHR; masks each request as it is captured (circular buffer)
  ├─ ScreenRecorder.start()   → rrweb.record() begins immediately (last two checkout segments — see mode, maxReplaySize)
  ├─ ConsoleCapture.start()   → patches console.error/warn, listens for uncaught errors and unhandled rejections (circular buffer)
  ├─ FloatingButton.mount()   → injects button via Shadow DOM (recording state)
  └─ [enableBackup]           → restores the sessionStorage backup, backs up again on pagehide

User clicks the button
  ├─ ConfirmModal.show()        → { confirmed, memo }
  │   └─ [cancelled or destroy()] → no-op
  ├─ cut for saving             → recording keeps running:
  │   ├─ ScreenRecorder.cutForSave()  → events so far; a new checkout segment (full snapshot) starts now
  │   ├─ NetworkCapture.snapshot()    → entries so far (new requests keep being captured)
  │   └─ ConsoleCapture.snapshot()    → entries so far
  ├─ HARBuilder.build()         → standard HAR 1.2 document
  ├─ collectEnvironment()       → browser, screen, masked page URL, SDK version
  ├─ ProgressBar.show()         → "Saving..."
  │
  ├─ [endpoint set]
  │   └─ RemoteDelivery.send()  → POST multipart/form-data (aborted after uploadTimeout or on destroy())
  │       └─ [upload fails or times out] → LocalStorage.save() instead
  │
  ├─ [no endpoint]
  │   └─ LocalStorage.save()    → downloads 1 ZIP file:
  │                                qa-report-*.zip
  │                                  ├─ qa-session-*.rr.json
  │                                  ├─ qa-network-*.har
  │                                  ├─ qa-env-*.json
  │                                  └─ qa-report-*.html  ← unified viewer
  │
  ├─ [destroy() meanwhile] → stop here: no buffer changes, no UI, no fallback download
  ├─ [saved]  drop only the saved part — what was captured during the save stays for the next save
  ├─ [failed] keep everything — the next save includes the failed part again (no duplicates)
  └─ ProgressBar hidden → SharePanel (upload with url) or an alert (fallback / failure)
```

---

## Unified QA Report Viewer

The `qa-report-{timestamp}.html` file is a fully self-contained QA report — no server, no extension, no additional software needed.

### Session Replay (left panel)

- **Play / Pause** button with timeline scrubber
- **1× / 2× / 4×** playback speed
- Mouse cursor and interaction replay
- Timeline markers for network requests and console errors/warnings (failed requests in red) — click a marker to jump to that moment

### Network Inspector (right panel — Network tab)

| Tab | Contents |
|---|---|
| **Headers** | General (URL, Method, Status) · Request Headers · Response Headers |
| **Payload** | Query String Parameters · Request Body (with JSON pretty-printing) |
| **Response** | Raw response body (with JSON pretty-printing) |
| **Timing** | Total time of the request. The per-phase split is not measured in the page, so it is not drawn (reports made by older versions still show their Send / Wait / Receive bars) |

- URL filter bar to narrow down requests
- Click any row to **jump to that exact moment** in the session replay
- Active requests highlighted during playback
- Failed requests (status 0: network error, CORS, aborted) shown as `failed` in red
- Bodies that were not captured (binary content, `FormData`) show the reason instead of a body

### Console Log (right panel — Console tab)

- Filter by Errors / Warnings / Logs (Logs also covers `info`)
- Click any entry to **jump to that moment** in the session replay
- Future entries fade out during playback, revealing the timeline progressively
- Expand `▶ stack` to see the stack trace of an error

### Environment (right panel — Environment tab)

- Browser (user agent), language, time zone, viewport and screen size, device pixel ratio, the page URL (masked with `maskKeys`) and the SDK version at the moment of saving

> The viewer loads rrweb from CDN (`cdn.jsdelivr.net`) on open, with a Subresource Integrity check — an internet connection is required to play back sessions. If the player cannot be loaded, the network and console panels still work.

---

## Browser Support

| Browser | Support |
|---|---|
| Chrome 72+ | Full support |
| Edge 79+ | Full support |
| Firefox 66+ | Full support |
| Safari 14+ | Full support |
| Mobile browsers | Full support |
| WebView (Android/iOS) | Full support |

> rrweb uses only `MutationObserver` and standard DOM APIs — no screen capture permission required, no platform restrictions.

---

## Development

```bash
pnpm install

pnpm build                            # build the SDK (ESM + UMD + type declarations to packages/sdk/dist/)
pnpm typecheck                        # type-check the SDK and the E2E tests
pnpm -F qa-recorder test              # unit tests (Vitest + jsdom)
pnpm -F qa-recorder dev               # watch mode
pnpm -F qa-recorder demo              # local demo server (http://localhost:5173)
pnpm -F qa-recorder verify:package    # after build: pack the SDK, install it into a standalone project
                                      # outside the repo and type-check it without skipLibCheck
pnpm -F qa-recorder test:e2e          # after build: browser E2E in Chromium (Playwright)
```

- **Demo:** `pnpm demo` runs the SDK from the current checkout (`packages/sdk/src`, through Vite), not the published npm package; the badge at the top of the page shows the version and commit. The [live demo](https://guksu.github.io/qa-recorder/) runs the SDK built from the commit it was deployed from (shown the same way), which may be ahead of the npm release.
- **E2E:** the tests run against a local fixture server (`packages/sdk/e2e/fixture-server.mjs`) that serves the built SDK, a small test app, local API endpoints and an upload endpoint with slow, failing and hanging modes — no external services. The report's rrweb script is answered from the npm package of the same version, and the browser still checks its integrity (SRI). Install the browser once with `pnpm -F qa-recorder exec playwright install chromium`.
- **CI** (`.github/workflows/ci.yml`) runs type checks, unit tests, the build, the packed-package check and the Chromium E2E tests on every pull request.

---

## License

MIT
