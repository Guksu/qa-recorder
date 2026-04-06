# qa-recorder

[![npm version](https://img.shields.io/npm/v/qa-recorder?color=crimson)](https://www.npmjs.com/package/qa-recorder)
[![license](https://img.shields.io/npm/l/qa-recorder?color=blue)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![test](https://img.shields.io/badge/tests-109%20passing-brightgreen)](./packages/sdk)

**버튼 하나로 DOM 세션 리플레이 + 네트워크 기록을 저장하는 웹 QA 라이브러리**

[English](./README.md)

---

## 왜 qa-recorder인가요?

웹 QA를 하다 보면 이런 상황을 자주 마주칩니다.

> "방금 버튼을 클릭했더니 오류가 났는데, 다시 해보니까 재현이 안 돼요."

개발자가 버그를 찾으려면 두 가지가 필요합니다: **그 순간의 화면**과 **그 순간의 네트워크 요청**. 스크린샷 한 장과 텍스트 재현 절차로는 충분하지 않은 경우가 많습니다.

`qa-recorder`는 페이지 로드 시점에 즉시 녹화를 시작합니다 — 별도 클릭 불필요. 최근 20분 분량을 메모리에 유지합니다 (영상 파일 없음, 디스크 용량 부담 없음). QA 담당자가 플로팅 버튼을 클릭하면 최근 20분이 저장되며, 네 가지 파일이 즉시 생성됩니다:

- **DOM 세션 리플레이** 원본 (rrweb 이벤트 스트림)
- **독립 실행형 리플레이 뷰어** — 브라우저에서 바로 재생
- **네트워크 요청 로그** (.har)
- **독립 실행형 HAR 뷰어** (Chrome 개발자도구 스타일)

백엔드 불필요. 브라우저 확장 프로그램 불필요. 화면 공유 권한 불필요. script 태그 하나만 추가하면 됩니다.

---

## 주요 기능

| | 기능 | 설명 |
|---|---|---|
| 🎥 | **DOM 세션 리플레이** | `MutationObserver` 기반 DOM 변화 캡처 (rrweb). 모바일, WebView, 모든 브라우저 지원 — `getDisplayMedia` 불필요. |
| 🌐 | **네트워크 캡처** | `fetch`와 `XHR` 인터셉트. 최대 100건 순환 버퍼, HAR 1.2 포맷. |
| ▶️ | **리플레이 뷰어** | 재생/일시정지, 1×/2×/4× 속도 버튼이 포함된 독립 실행형 HTML 뷰어. |
| 🔍 | **HAR 뷰어** | Chrome 개발자도구 스타일의 독립 HTML 뷰어 — Headers, Payload, Response, Timing 탭 제공. |
| 🔒 | **헤더 마스킹** | `Authorization`, `Cookie` 등 민감 헤더 자동 마스킹. |
| 📦 | **로컬 저장** | 파일 4종을 로컬에 다운로드 — 백엔드 불필요. |
| ☁️ | **원격 업로드** | 서버 endpoint 설정 시 POST 업로드. 응답 URL이 있으면 링크 복사 버튼 노출. |
| 🧩 | **Shadow DOM UI** | 플로팅 버튼과 팝업이 호스트 페이지 스타일과 완전히 격리. |

---

## 설치

```bash
npm install qa-recorder
# or
pnpm add qa-recorder
```

또는 script 태그로 직접 삽입 (UMD 빌드, 번들러 불필요):

```html
<script src="https://unpkg.com/qa-recorder/dist/qa-recorder.umd.js"></script>
```

---

## 빠른 시작

### ESM / npm

```ts
import { QARecorder } from 'qa-recorder';

const recorder = new QARecorder();
await recorder.init();
// 권한 요청 없이 즉시 녹화 시작 — 최근 20분을 항상 메모리에 유지.
// 화면 우측 하단에 빨간 플로팅 버튼이 나타납니다.
// 1번 클릭 → 확인 → 파일 4종이 자동 다운로드됩니다.
// 저장 후 녹화가 자동으로 재시작됩니다.
```

### Script 태그

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

## 저장 방식

### 로컬 저장 (기본)

`endpoint`를 설정하지 않으면 사용자 기기에 파일 4종을 다운로드합니다:

| 파일 | 내용 |
|---|---|
| `qa-session-{timestamp}.rr.json` | DOM 세션 리플레이 (rrweb 이벤트 원본) |
| `qa-session-{timestamp}.html` | 독립 실행형 리플레이 뷰어 — 열면 바로 재생 가능 |
| `qa-network-{timestamp}.har` | 네트워크 로그 (HAR 1.2) |
| `qa-network-{timestamp}.html` | 독립 실행형 HAR 뷰어 |

### 원격 업로드

`endpoint`를 설정하면 파일을 서버로 전송합니다. 서버가 `url` 필드를 응답하면 링크 복사 버튼이 자동으로 표시됩니다.

```ts
const recorder = new QARecorder({
  endpoint: 'https://your-server.com/upload',
});
await recorder.init();
```

서버 응답 형식 (선택):

```json
{ "url": "https://your-server.com/share/abc123" }
```

파일은 `multipart/form-data`로 전송됩니다:

```
POST /upload
  session  →  qa-session-{timestamp}.rr.json
  har      →  qa-network-{timestamp}.har
```

> **HTML 뷰어 파일은 왜 전송하지 않나요?** 독립 실행형 HTML 뷰어는 원본 데이터로 언제든 재생성할 수 있는 파생 파일입니다. 원격 업로드에서는 서버가 원본 데이터(`.rr.json`, `.har`)를 받아 자체 뷰어 페이지를 렌더링합니다. 필요하다면 이 패키지의 `SessionViewer.generate()`와 `HARViewer.generate()`를 서버에서도 그대로 사용할 수 있습니다. 이미 생성된 HTML을 함께 전송하는 것은 중복이며 업로드 용량만 늘어납니다.

---

## 설정 옵션

모든 옵션은 `window.__QA_RECORDER_CONFIG__`으로 설정하거나 생성자 인수로 전달할 수 있습니다. 생성자 인수가 우선합니다.

```ts
window.__QA_RECORDER_CONFIG__ = {
  endpoint: '',           // 원격 업로드 URL. 비워두면 로컬 저장 (기본값).
  maxRequests: 100,       // 순환 버퍼 최대 기록 수 (기본값: 100).
  maskHeaders: [          // 저장 전 마스킹할 헤더 (기본값 표시).
    'Authorization',
    'Cookie',
    'Set-Cookie',
  ],
  zIndex: 2147483647,     // UI 요소의 z-index (기본값: 최대 정수).
};
```

| 옵션 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `endpoint` | `string` | `''` | 원격 업로드 URL. 비어있으면 로컬 다운로드. |
| `maxRequests` | `number` | `100` | 순환 버퍼에 유지할 최대 기록 수. |
| `maskHeaders` | `string[]` | `['Authorization', 'Cookie', 'Set-Cookie']` | 마스킹할 헤더 이름 목록. |
| `zIndex` | `number` | `2147483647` | UI 요소(버튼, 프로그레스 바, 공유 패널)의 z-index. |

---

## 동작 원리

```
페이지 로드
  ├─ NetworkCapture.start()   → window.fetch + XHR 패치 (순환 버퍼)
  ├─ ScreenRecorder.start()   → rrweb.record() 즉시 시작 (최근 20분 유지)
  └─ FloatingButton.mount()   → Shadow DOM으로 버튼 삽입 (recording 상태)

플로팅 버튼 클릭 (최근 20분 저장)
  ├─ ScreenRecorder.stop()
  ├─ NetworkCapture.snapshot()  → HAR 1.2 JSON 생성
  ├─ MaskingFilter.apply()      → 민감 헤더 마스킹
  ├─ ProgressBar.show()         → "Saving..."
  │
  ├─ [endpoint 설정된 경우]
  │   ├─ RemoteDelivery.send()  → POST multipart/form-data
      │   ├─ ProgressBar.hide()
      │   └─ SharePanel.show(url)  → 링크 복사 버튼 (서버가 url 반환 시)
      │
      └─ [endpoint 없는 경우]
          └─ LocalStorage.save()    → 파일 4종 다운로드:
                                       qa-session-*.rr.json
                                       qa-session-*.html  ← 리플레이 뷰어
                                       qa-network-*.har
                                       qa-network-*.html  ← HAR 뷰어
      │
      └─ ScreenRecorder.reset() + start()  → 녹화 자동 재시작
         NetworkCapture.clearBuffer()      → 네트워크 로그 초기화
```

---

## 세션 리플레이 뷰어

로컬 저장 시 함께 다운로드되는 `qa-session-*.html`을 브라우저에서 열면 됩니다.

- **재생 / 일시정지** 버튼
- **1× / 2× / 4×** 배속 전환
- 마우스 커서 및 인터랙션 재현
- 서버, 확장 프로그램, 별도 소프트웨어 불필요

> 뷰어는 재생 시 CDN(`cdn.jsdelivr.net`)에서 rrweb을 로드합니다. 재생에는 인터넷 연결이 필요합니다.

인터넷 없이 재생하려면 `.rr.json` 파일을 [rrweb-player](https://github.com/rrweb-io/rrweb/tree/master/packages/rrweb-player)와 함께 직접 사용하세요.

---

## HAR 뷰어

로컬 저장 시 함께 다운로드되는 `qa-network-*.html`은 완전히 독립 실행형입니다. 서버, 확장 프로그램, 인터넷 연결 없이 브라우저에서 바로 열 수 있습니다.

| 탭 | 내용 |
|---|---|
| **Headers** | General (URL, 메서드, 상태) · 요청 헤더 · 응답 헤더 |
| **Payload** | Query String 파라미터 · 요청 본문 |
| **Response** | 응답 본문 (JSON pretty-print 포함) |
| **Timing** | Wait(TTFB) / Content Download 시간 차트 |

- URL 필터 검색으로 요청 빠르게 찾기
- 요청별 Waterfall 바 시각화
- 마스킹된 헤더는 `[MASKED]`로 표시

---

## 브라우저 지원

| 브라우저 | 지원 여부 |
|---|---|
| Chrome 72+ | ✅ 완전 지원 |
| Edge 79+ | ✅ 완전 지원 |
| Firefox 66+ | ✅ 완전 지원 |
| Safari 14+ | ✅ 완전 지원 |
| 모바일 브라우저 | ✅ 완전 지원 |
| WebView (Android/iOS) | ✅ 완전 지원 |

> rrweb은 `MutationObserver`와 표준 DOM API만 사용합니다. 화면 캡처 권한 불필요, 플랫폼 제약 없음.

---

## 개발

```bash
pnpm install

pnpm -F qa-recorder test      # 테스트 실행 (Vitest + jsdom, 109개)
pnpm -F qa-recorder build     # ESM + UMD 빌드
pnpm -F qa-recorder dev       # watch 모드
pnpm -F qa-recorder demo      # 로컬 데모 서버 (http://localhost:5173)
```

---

## 라이선스

MIT
