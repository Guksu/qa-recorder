# qa-recorder

[![npm version](https://img.shields.io/npm/v/qa-recorder?color=crimson)](https://www.npmjs.com/package/qa-recorder)
[![license](https://img.shields.io/npm/l/qa-recorder?color=blue)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![test](https://img.shields.io/badge/tests-102%20passing-brightgreen)](./packages/sdk)

**One-click QA recording for web apps — DOM session replay + network activity, all in the browser.**

[한국어](./README.ko.md)

---

## Why qa-recorder?

Reproducing bugs in web applications is hard. When a QA engineer clicks a button and an error appears, the developer needs two things to debug it: **what was on screen** and **what network requests were made**. A screenshot and a text description are rarely enough.

`qa-recorder` starts recording the moment the page loads — no interaction needed. It keeps a rolling 20-minute window in memory (no video files, no disk usage). When your QA team wants to capture a session, they click the floating button once to save the last 20 minutes, and four files are saved instantly:

- A **DOM session replay** of the entire interaction (rrweb format)
- A **standalone replay viewer** — open in any browser, no setup needed
- A **HAR network log** of the last 100 requests
- A **standalone HAR viewer** (Chrome DevTools-style UI, no server needed)

No backend required. No browser extension. No screen share permission. Just add one script tag.

---

## Features

| | Feature | Description |
|---|---|---|
| 🎥 | **DOM session replay** | Captures every DOM change via `MutationObserver` (rrweb). Works on mobile, WebView, and any browser — no `getDisplayMedia` needed. |
| 🌐 | **Network capture** | Intercepts `fetch` and `XHR`. Circular buffer, up to 100 entries in HAR 1.2 format. |
| ▶️ | **Replay viewer** | Self-contained HTML file with play/pause and 1x/2x speed controls. Open in any browser, no internet needed at record time. |
| 🔍 | **HAR viewer** | Self-contained HTML file with a Chrome DevTools-style network inspector. |
| 🔒 | **Header masking** | `Authorization`, `Cookie`, and custom headers are automatically redacted. |
| 📦 | **Local save** | Downloads 4 files directly — no backend needed. |
| ☁️ | **Remote upload** | Optionally POST files to your own server. Shows a share-link copy button on success. |
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

### ESM / npm

```ts
import { QARecorder } from 'qa-recorder';

const recorder = new QARecorder();
await recorder.init();
// Recording starts immediately — no permission prompt, no click needed.
// A red floating button appears in the bottom-right corner.
// The last 20 minutes are always available in memory.
// 1 click → confirm → four files download automatically → recording continues.
```

### Script tag

```html
<script>
  window.__QA_RECORDER_CONFIG__ = {
    maxRequests: 100,
    maskHeaders: ['Authorization', 'Cookie'],
  };
</script>
<script src="https://unpkg.com/qa-recorder/dist/qa-recorder.umd.js"></script>
```

---

## Save Modes

### Local (default)

When no `endpoint` is configured, four files are downloaded to the user's device:

| File | Contents |
|---|---|
| `qa-session-{timestamp}.rr.json` | DOM session replay (rrweb events) |
| `qa-session-{timestamp}.html` | Standalone replay viewer — open to play back the session |
| `qa-network-{timestamp}.har` | Network log (HAR 1.2) |
| `qa-network-{timestamp}.html` | Standalone HAR viewer (open in browser) |

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
  endpoint: '',           // Remote upload URL. Leave empty for local save (default).
  maxRequests: 100,       // Max network entries in the circular buffer (default: 100).
  maskHeaders: [          // Headers to redact before saving (default shown).
    'Authorization',
    'Cookie',
    'Set-Cookie',
  ],
};
```

| Option | Type | Default | Description |
|---|---|---|---|
| `endpoint` | `string` | `''` | Remote upload URL. Empty = local download. |
| `maxRequests` | `number` | `100` | Max network entries to keep. |
| `maskHeaders` | `string[]` | `['Authorization', 'Cookie', 'Set-Cookie']` | Headers to redact. |

---

## How It Works

```
Page load
  ├─ NetworkCapture.start()   → patches window.fetch + XHR (circular buffer)
  ├─ ScreenRecorder.start()   → rrweb.record() begins immediately (20-min rolling window)
  └─ FloatingButton.mount()   → injects button via Shadow DOM (recording state)

User clicks the button (save the last 20 minutes)
  └─ ConfirmModal             → "Save current session?"
  └─ [Confirm]
      ├─ ScreenRecorder.stop()
      ├─ NetworkCapture.snapshot()  → HAR 1.2 JSON
      ├─ MaskingFilter.apply()      → redact sensitive headers
      │
      ├─ [endpoint set]
      │   ├─ ProgressBar.show()     → "업로드 중..."
      │   ├─ RemoteDelivery.send()  → POST multipart/form-data
      │   ├─ ProgressBar.hide()
      │   └─ SharePanel.show(url)   → copy-link button (if server returns url)
      │
      └─ [no endpoint]
          └─ LocalStorage.save()    → downloads 4 files:
                                       qa-session-*.rr.json
                                       qa-session-*.html  ← replay viewer
                                       qa-network-*.har
                                       qa-network-*.html  ← HAR viewer
      │
      └─ ScreenRecorder.reset() + start()  → recording resumes immediately
         NetworkCapture.clearBuffer()      → network log reset
```

---

## Session Replay Viewer

The `qa-session-*.html` file downloaded with each local save is a fully self-contained replay viewer.

- **Play / Pause** button
- **1x / 2x** playback speed
- Mouse cursor and interaction replay
- No server, no extension, no additional software needed

> The viewer loads rrweb from CDN (`cdn.jsdelivr.net`) on open — an internet connection is required to play back sessions.

To replay without internet, use [rrweb-player](https://github.com/rrweb-io/rrweb/tree/master/packages/rrweb-player) with the `.rr.json` file directly.

---

## HAR Viewer

The `qa-network-*.html` file is a fully self-contained network inspector — no server, no extension, no internet connection needed.

- Request and response headers, body, status code
- Response time (ms) for each entry
- Masked headers shown as `[MASKED]`

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

pnpm -F qa-recorder test      # run 102 tests (Vitest + jsdom)
pnpm -F qa-recorder build     # build ESM + UMD to dist/
pnpm -F qa-recorder dev       # watch mode
pnpm -F qa-recorder demo      # local demo server (http://localhost:5173)
```

---

## License

MIT
