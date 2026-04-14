# qa-recorder

[![npm version](https://img.shields.io/npm/v/qa-recorder?color=crimson)](https://www.npmjs.com/package/qa-recorder)
[![license](https://img.shields.io/npm/l/qa-recorder?color=blue)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![test](https://img.shields.io/badge/tests-164%20passing-brightgreen)](./packages/sdk)

**One-click QA recording for web apps — DOM session replay + network activity + console errors, all in the browser.**

[한국어](./README.ko.md)

---

## Why qa-recorder?

Reproducing bugs in web applications is hard. When a QA engineer clicks a button and an error appears, the developer needs three things to debug it: **what was on screen**, **what network requests were made**, and **what errors were logged**. A screenshot and a text description are rarely enough.

`qa-recorder` starts recording the moment the page loads — no interaction needed. It keeps a rolling 20-minute window in memory (no video files, no disk usage). When your QA team wants to capture a session, they click the floating button once to save:

- A **DOM session replay** of the entire interaction (rrweb format)
- A **HAR network log** of the last 100 requests
- A **unified QA report** — session replay + network inspector + console errors in one self-contained HTML file

No backend required. No browser extension. No screen share permission. Just add one script tag.

---

## Features

| | Feature | Description |
|---|---|---|
| 🎥 | **DOM session replay** | Captures every DOM change via `MutationObserver` (rrweb). Works on mobile, WebView, and any browser — no `getDisplayMedia` needed. |
| 🌐 | **Network capture** | Intercepts `fetch` and `XHR`. Circular buffer, up to 100 entries in HAR 1.2 format. |
| 🖥️ | **Console capture** | Captures `console.error`, `console.warn`, `window.onerror`, and `unhandledrejection`. |
| 📋 | **Unified QA report** | Single self-contained HTML: session replay (left) + network inspector + console log (right). Time-synchronized — clicking a network row or console entry seeks to that exact moment. |
| 🔍 | **Network detail panel** | Click any request row to inspect Headers, Payload, Response, and Timing — Chrome DevTools style. |
| 🔒 | **Header masking** | `Authorization`, `Cookie`, and custom headers are automatically redacted. |
| 📦 | **Local save** | Downloads a single ZIP file directly — no backend needed. |
| ☁️ | **Remote upload** | Optionally POST files to your own server. Shows a share-link copy button on success. |
| 💾 | **Session continuity** | `enableBackup: true` auto-saves the session to IndexedDB on tab hide/close and silently restores it after a page refresh — no prompts, no data loss. |
| 🧩 | **Shadow DOM UI** | Floating button and modals are fully isolated from the host page's styles. |

---

## Installation

```bash
npm install qa-recorder
# or
pnpm add qa-recorder
```

Or drop it in via `<script>` tag (UMD build, no bundler required):

```html
<script src="https://unpkg.com/qa-recorder/dist/qa-recorder.umd.js"></script>
```

---

## Quick Start

### Vanilla JS

```ts
import { QARecorder } from 'qa-recorder';

QARecorder.setup({
  enableBackup: true,
});
// Recording starts immediately — no permission prompt, no click needed.
// A red floating button appears in the bottom-right corner.
// The last 20 minutes are always available in memory.
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
    maskHeaders: ['Authorization', 'Cookie'],
  };
</script>
<script src="https://unpkg.com/qa-recorder/dist/qa-recorder.umd.js"></script>
```

---

## Save Modes

### Local (default)

When no `endpoint` is configured, a single ZIP file is downloaded to the user's device:

| File | Contents |
|---|---|
| `qa-report-{timestamp}.zip` | Contains all three files below |
| `qa-session-{timestamp}.rr.json` | DOM session replay (rrweb events) |
| `qa-network-{timestamp}.har` | Network log (HAR 1.2) |
| `qa-report-{timestamp}.html` | Unified QA report — session replay + network + console in one file |

### Remote upload

Set an `endpoint` to POST files to your server instead. On success, if the server returns a `url` field, a share-link copy button is shown automatically.

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
  har      →  qa-network-{timestamp}.har
```

---

## Configuration

All options can be set via `window.__QA_RECORDER_CONFIG__` or passed as constructor arguments. Constructor arguments take precedence.

```ts
window.__QA_RECORDER_CONFIG__ = {
  endpoint: '',              // Remote upload URL. Leave empty for local save (default).
  maxRequests: 100,          // Max network entries in the circular buffer (default: 100).
  maskHeaders: [             // Headers to redact before saving (default shown).
    'Authorization',
    'Cookie',
    'Set-Cookie',
  ],
  zIndex: 2147483647,        // z-index for all UI elements (default: max int).
  consoleLevels: ['error', 'warn'],  // Console levels to capture (default shown).
  maxConsoleEntries: 200,    // Max console entries in the circular buffer (default: 200).
  enableBackup: false,       // Auto-save session to IndexedDB on tab hide/close and restore after refresh (default: false).
};
```

| Option | Type | Default | Description |
|---|---|---|---|
| `endpoint` | `string` | `''` | Remote upload URL. Empty = local download. |
| `maxRequests` | `number` | `100` | Max network entries to keep. |
| `maskHeaders` | `string[]` | `['Authorization', 'Cookie', 'Set-Cookie']` | Headers to redact. |
| `zIndex` | `number` | `2147483647` | z-index for all UI elements (button, progress bar, share panel). |
| `consoleLevels` | `string[]` | `['error', 'warn']` | Console levels to capture. Valid values: `'error'`, `'warn'`, `'log'`, `'info'`. |
| `maxConsoleEntries` | `number` | `200` | Max console entries to keep in the circular buffer. |
| `enableBackup` | `boolean` | `false` | When `true`, auto-saves the current session to IndexedDB whenever the tab becomes hidden (refresh, close, navigate). On the next `init()`, the backup is silently restored into the current session buffers before recording continues. The 20-minute rolling window is always respected. |

---

## How It Works

```
Page load
  ├─ NetworkCapture.start()   → patches window.fetch + XHR (circular buffer)
  ├─ ScreenRecorder.start()   → rrweb.record() begins immediately (20-min rolling window)
  ├─ ConsoleCapture.start()   → patches console.error/warn + window.onerror (circular buffer)
  └─ FloatingButton.mount()   → injects button via Shadow DOM (recording state)

User clicks the button (save the last 20 minutes)
  ├─ ScreenRecorder.stop()
  ├─ NetworkCapture.snapshot()  → HAR 1.2 JSON
  ├─ ConsoleCapture.snapshot()  → console entries array
  ├─ MaskingFilter.apply()      → redact sensitive headers
  ├─ ProgressBar.show()         → "Saving..."
  │
  ├─ [endpoint set]
  │   ├─ RemoteDelivery.send()  → POST multipart/form-data
  │   ├─ ProgressBar.hide()
  │   └─ SharePanel.show(url)   → copy-link button (if server returns url)
  │
  └─ [no endpoint]
      └─ LocalStorage.save()    → downloads 1 ZIP file:
                                   qa-report-*.zip
                                     ├─ qa-session-*.rr.json
                                     ├─ qa-network-*.har
                                     └─ qa-report-*.html  ← unified viewer

  └─ ScreenRecorder.reset() + start()   → recording resumes immediately
     NetworkCapture.clearBuffer()       → network log reset
     ConsoleCapture.clearBuffer()       → console log reset
```

---

## Unified QA Report Viewer

The `qa-report-{timestamp}.html` file is a fully self-contained QA report — no server, no extension, no additional software needed.

### Session Replay (left panel)

- **Play / Pause** button with timeline scrubber
- **1× / 2× / 4×** playback speed
- Mouse cursor and interaction replay
- Timeline markers for network requests and console errors

### Network Inspector (right panel — Network tab)

| Tab | Contents |
|---|---|
| **Headers** | General (URL, Method, Status) · Request Headers · Response Headers |
| **Payload** | Query String Parameters · Request Body (with JSON pretty-printing) |
| **Response** | Raw response body (with JSON pretty-printing) |
| **Timing** | Send / Wait (TTFB) / Receive breakdown with bar chart |

- URL filter bar to narrow down requests
- Click any row to **jump to that exact moment** in the session replay
- Active requests highlighted during playback

### Console Log (right panel — Console tab)

- Filter by Error / Warning / Log level
- Click any entry to **jump to that moment** in the session replay
- Future entries fade out during playback, revealing the timeline progressively

> The viewer loads rrweb from CDN (`cdn.jsdelivr.net`) on open — an internet connection is required to play back sessions.

---

## Browser Support

| Browser | Support |
|---|---|
| Chrome 72+ | ✅ Full support |
| Edge 79+ | ✅ Full support |
| Firefox 66+ | ✅ Full support |
| Safari 14+ | ✅ Full support |
| Mobile browsers | ✅ Full support |
| WebView (Android/iOS) | ✅ Full support |

> rrweb uses only `MutationObserver` and standard DOM APIs — no screen capture permission required, no platform restrictions.

---

## Development

```bash
pnpm install

pnpm -F qa-recorder test      # run 164 tests (Vitest + jsdom)
pnpm -F qa-recorder build     # build ESM + UMD to dist/
pnpm -F qa-recorder dev       # watch mode
pnpm -F qa-recorder demo      # local demo server (http://localhost:5173)
```

---

## License

MIT
