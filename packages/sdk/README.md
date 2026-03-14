# qa-recorder

[![npm version](https://img.shields.io/npm/v/qa-recorder?color=crimson)](https://www.npmjs.com/package/qa-recorder)
[![license](https://img.shields.io/npm/l/qa-recorder?color=blue)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![test](https://img.shields.io/badge/tests-72%20passing-brightgreen)](./packages/sdk)

**One-click QA recording for web apps — screen video + network activity, all in the browser.**

[한국어](./README.ko.md)

---

## Why qa-recorder?

Reproducing bugs in web applications is hard. When a QA engineer clicks a button and an error appears, the developer needs two things to debug it: **what was on screen** and **what network requests were made**. A screenshot and a text description are rarely enough.

`qa-recorder` runs silently in the background from the moment the page loads. When something goes wrong, your QA team clicks one floating button — and three files are saved instantly:

- A **screen recording** of the session
- A **HAR network log** of the last 100 requests
- A **standalone HTML viewer** (Chrome DevTools-style UI, no server needed)

No backend required. No browser extension. Just add one script tag.

---

## Features

| | Feature | Description |
|---|---|---|
| 🎥 | **Screen recording** | Continuous capture via `MediaStream` (RecordRTC). Starts automatically on page load. |
| 🌐 | **Network capture** | Intercepts `fetch` and `XHR`. Circular buffer, up to 100 entries in HAR 1.2 format. |
| 🔍 | **HAR viewer** | Self-contained HTML file with a Chrome DevTools-style network inspector. |
| 🔒 | **Header masking** | `Authorization`, `Cookie`, and custom headers are automatically redacted. |
| 📦 | **Local save** | Downloads `.webm` + `.har` + `.html` directly — no backend needed. |
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
// A red floating button appears in the bottom-right corner.
// Click it → confirm → three files download automatically.
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

When no `endpoint` is configured, three files are downloaded to the user's device:

| File | Contents |
|---|---|
| `qa-recording-{timestamp}.webm` | Screen recording video |
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
  video  →  qa-recording-{timestamp}.webm
  har    →  qa-network-{timestamp}.har
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
  ├─ ScreenRecorder.start()   → requests getDisplayMedia, starts recording
  └─ FloatingButton.mount()   → injects button via Shadow DOM

User clicks the floating button
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
          └─ LocalStorage.save()    → downloads .webm + .har + .html
```

---

## HAR Viewer

The `.html` file downloaded with each local save is a fully self-contained network inspector — no server, no extension, no internet connection needed.

- Request and response headers, body, status code
- Response time (ms) for each entry
- Masked headers shown as `[MASKED]`

---

## Browser Support

| Browser | Support |
|---|---|
| Chrome 72+ | ✅ Full support |
| Edge 79+ | ✅ Full support |
| Firefox 66+ | ⚠️ Screen share permission prompt required |
| Safari | ❌ `MediaRecorder` not fully supported |

> Screen capture requires **HTTPS** in production. `localhost` works over HTTP.

---

## Development

```bash
pnpm install

pnpm -F qa-recorder test      # run 72 tests (Vitest + jsdom)
pnpm -F qa-recorder build     # build ESM + UMD to dist/
pnpm -F qa-recorder dev       # watch mode
```

---

## License

MIT
