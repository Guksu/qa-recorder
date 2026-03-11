# qa-recorder

A lightweight QA recording library for web applications. Capture network activity and screen video simultaneously, then download the results — making it easy to reproduce bugs and report issues.

[한국어](./README.ko.md)

---

## Why qa-recorder?

Reproducing bugs in web applications is hard. qa-recorder runs silently in the background, capturing the last 100 network requests and a continuous screen recording. When something goes wrong, your QA team hits one button — and everything is saved to their device.

## Features

- **Floating button** — always-visible trigger in the bottom-right corner
- **Network capture** — intercepts `fetch` and `XHR`, stores up to 100 entries in a circular buffer (HAR 1.2 format)
- **Screen recording** — continuous video capture via `MediaStream` (RecordRTC)
- **Sensitive data masking** — automatically redacts headers like `Authorization` and `Cookie`
- **Local download** — downloads `.webm` video + `.har` file directly to the user's machine
- **Shadow DOM isolation** — the UI never conflicts with the host application's styles
- **Zero backend required** — works entirely in the browser, no server setup needed

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

const recorder = new QARecorder();
await recorder.init();
// Clicking the button downloads .webm + .har files directly
```

### Script tag (auto-init)

```html
<script>
  window.__QA_RECORDER_CONFIG__ = {
    maxRequests: 100,
    maskHeaders: ['Authorization', 'Cookie'],
  };
</script>
<script type="module" src="https://unpkg.com/qa-recorder/dist/qa-recorder.esm.js"></script>
```

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
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
      └─ download .webm + .har
```

## Output Files

When the user clicks the button and confirms:

- **`qa-recording-{timestamp}.webm`** — screen recording video
- **`qa-network-{timestamp}.har`** — network activity in HAR 1.2 format

The `.har` file can be imported into Chrome DevTools (Network tab → Import) or any HAR viewer to inspect all captured requests.

## Project Structure

```
qa-recorder/
├── packages/
│   ├── sdk/        # Frontend library (this package)
│   └── shared/     # Shared TypeScript types (HAR)
```

## Development

```bash
# Install dependencies
pnpm install

# Run demo page
cd packages/sdk && pnpm demo

# Build
cd packages/sdk && pnpm build
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
