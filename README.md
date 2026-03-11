# qa-recorder

A lightweight QA recording library for web applications. Capture network activity and screen video simultaneously, then share or download the results — making it easy to reproduce bugs and report issues.

[한국어](./README.ko.md)

---

## Why qa-recorder?

Reproducing bugs in web applications is hard. qa-recorder runs silently in the background, capturing the last 100 network requests and a continuous screen recording. When something goes wrong, your QA team hits one button — and everything is saved.

## Features

- **Floating button** — always-visible trigger in the bottom-right corner
- **Network capture** — intercepts `fetch` and `XHR`, stores up to 100 entries in a circular buffer (HAR 1.2 format)
- **Screen recording** — continuous video capture via `MediaStream` (RecordRTC)
- **Sensitive data masking** — automatically redacts headers like `Authorization` and `Cookie`
- **Two storage modes**
  - `remote` — chunked upload to your own backend, generates a shareable link
  - `local` — downloads `.webm` video + `.har` file directly to the user's machine
- **Resume upload** — interrupted uploads are resumed from `localStorage` on the next attempt
- **Shadow DOM isolation** — the UI never conflicts with the host application's styles

## Installation

```bash
npm install qa-recorder
```

Or include directly via script tag (UMD build):

```html
<script src="https://unpkg.com/qa-recorder/dist/qa-recorder.umd.js"></script>
```

## Quick Start

### npm / ESM

```js
import { QARecorder } from 'qa-recorder';

const recorder = new QARecorder({
  endpoint: 'https://your-server.com',
  apiKey: 'your-api-key',
  storage: 'remote',
});

await recorder.init();
```

### Script tag (auto-init)

```html
<script>
  window.__QA_RECORDER_CONFIG__ = {
    endpoint: 'https://your-server.com',
    apiKey: 'your-api-key',
    storage: 'remote',
  };
</script>
<script type="module" src="https://unpkg.com/qa-recorder/dist/qa-recorder.esm.js"></script>
```

### Local mode (no server required)

```js
const recorder = new QARecorder({ storage: 'local' });
await recorder.init();
// Clicking the button downloads the files directly
```

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `endpoint` | `string` | `''` | Backend server URL (required for `remote` mode) |
| `apiKey` | `string` | `''` | API key sent as `Authorization: Bearer` |
| `storage` | `'remote' \| 'local'` | `'remote'` | Where to send recorded data |
| `maxRequests` | `number` | `100` | Maximum network entries to keep (circular buffer) |
| `maskHeaders` | `string[]` | `['Authorization', 'Cookie', 'Set-Cookie']` | Headers to redact before saving |

## How It Works

```
Page load
  └─ NetworkCapture.start()   → intercepts fetch / XHR (circular buffer, max 100)
  └─ ScreenRecorder.start()   → requests screen share permission, records continuously
  └─ FloatingButton.mount()   → injects button via Shadow DOM

User clicks button
  └─ ConfirmModal             → "Save current session?"
  └─ [Confirm]
      └─ ScreenRecorder.stop()
      └─ NetworkCapture.snapshot() → HAR 1.2 JSON
      └─ MaskingFilter.apply()     → redact sensitive headers

      [storage: local]
        └─ download .webm + .har

      [storage: remote]
        └─ POST /sessions          → get sessionId
        └─ POST /sessions/:id/har  → upload HAR
        └─ POST /upload/init       → S3 multipart init
        └─ POST /upload/chunk ×N   → chunked upload (3 parallel, auto-retry)
        └─ POST /upload/complete   → trigger FFmpeg transcoding
        └─ Poll /upload/status     → wait for 'done'
        └─ POST /sessions/:id/share → get shareable link
        └─ ShareLinkPanel          → copy to clipboard
```

## Backend (Self-Hosted)

qa-recorder is designed to work with its companion server (`apps/server`). See [apps/server](./apps/server) for setup instructions.

**Stack:** Node.js · Fastify · TypeScript · PostgreSQL · AWS S3 · FFmpeg

**Key endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/sessions` | Create a new session |
| `POST` | `/upload/init` | Initialize S3 multipart upload |
| `POST` | `/upload/chunk` | Upload a single chunk |
| `POST` | `/upload/complete` | Complete upload, start transcoding |
| `POST` | `/sessions/:id/har` | Upload HAR data |
| `GET` | `/upload/status/:id` | Poll transcoding status |
| `POST` | `/sessions/:id/share` | Generate shareable link |
| `GET` | `/s/:token` | Resolve short link (no auth) |
| `GET` | `/sessions/:id/timeline` | Synchronized video + network timeline |

## Project Structure

```
qa-recorder/
├── packages/
│   ├── sdk/        # Frontend library (this package)
│   └── shared/     # Shared TypeScript types
└── apps/
    └── server/     # Fastify backend
```

## Development

```bash
# Install dependencies
pnpm install

# Run demo page (SDK)
cd packages/sdk && pnpm demo

# Run backend in dev mode
cd apps/server && pnpm dev
```

## Browser Support

Requires browsers that support:
- `MediaDevices.getDisplayMedia` (screen capture)
- `MediaRecorder` API
- ES2017+

Chrome 72+, Edge 79+, Firefox 66+

> **Note:** Screen capture requires HTTPS in production.

## License

MIT
# qa-recorder
