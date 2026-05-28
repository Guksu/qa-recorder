# qa-recorder

[![npm version](https://img.shields.io/npm/v/qa-recorder?color=crimson)](https://www.npmjs.com/package/qa-recorder)
[![license](https://img.shields.io/npm/l/qa-recorder?color=blue)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
**rrweb DOM 직렬화 방식으로 세션 흐름, 네트워크 요청, 콘솔 에러를 통합 수집해 리포트 하나로 만드는 웹 QA 라이브러리 — 버튼 하나, 백엔드 불필요**

**[→ 라이브 데모](https://guksu.github.io/qa-recorder/)**

[English](./README.md)

---

## 왜 qa-recorder인가요?

웹 QA를 하다 보면 이런 상황을 자주 마주칩니다.

> "방금 버튼을 클릭했더니 오류가 났는데, 다시 해보니까 재현이 안 돼요."

개발자가 버그를 찾으려면 세 가지가 필요합니다: **그 순간의 화면**, **그 순간의 네트워크 요청**, 그리고 **그 순간의 콘솔 에러**. 스크린샷 한 장과 텍스트 재현 절차로는 충분하지 않은 경우가 많습니다.

`qa-recorder`는 **rrweb DOM 직렬화** 방식 — 영상 캡처가 아닌 — 으로 페이지 로드 시점부터 모든 DOM 변화, 사용자 인터랙션, 네트워크 요청, 콘솔 에러를 통합 수집합니다. rrweb이 영상 스트림 대신 DOM 트리를 직렬화하기 때문에 대용량 파일도, 화면 공유 권한도, 플랫폼 제약도 없습니다.

최근 20분 분량을 메모리에 유지합니다. QA 담당자가 플로팅 버튼을 클릭하고 버그 메모를 입력(선택)하면 저장됩니다:

- **DOM 세션 리플레이** 원본 (rrweb 이벤트 — 경량, 영상 없음)
- **네트워크 요청 로그** (HAR 1.2)
- **통합 QA 리포트** — 세션 리플레이 + 네트워크 인스펙터 + 콘솔 에러가 시간 동기화된 하나의 HTML 파일로

백엔드 불필요. 브라우저 확장 프로그램 불필요. 화면 공유 권한 불필요. script 태그 하나만 추가하면 됩니다.

---

## 주요 기능

| | 기능 | 설명 |
|---|---|---|
| 🎥 | **DOM 세션 리플레이** | `MutationObserver` 기반 DOM 변화 캡처 (rrweb). 모바일, WebView, 모든 브라우저 지원 — `getDisplayMedia` 불필요. |
| 🌐 | **네트워크 캡처** | `fetch`와 `XHR` 인터셉트. 최대 100건 순환 버퍼, HAR 1.2 포맷. |
| 🖥️ | **콘솔 캡처** | `console.error`, `console.warn`, `window.onerror`, `unhandledrejection` 자동 수집. |
| 📋 | **통합 QA 리포트** | 하나의 HTML 파일: 세션 리플레이(좌) + 네트워크 인스펙터 + 콘솔 로그(우). 시간 동기화 — 네트워크 행이나 콘솔 항목 클릭 시 해당 시점으로 즉시 이동. |
| 🔍 | **네트워크 상세 패널** | 요청 행 클릭 시 Headers, Payload, Response, Timing 탭 — Chrome 개발자도구 스타일. |
| 🔒 | **헤더 마스킹** | `Authorization`, `Cookie` 등 민감 헤더 자동 마스킹. |
| 📦 | **로컬 저장** | 파일 3종을 로컬에 다운로드 — 백엔드 불필요. |
| ☁️ | **원격 업로드** | 서버 endpoint 설정 시 POST 업로드. 응답 URL이 있으면 링크 복사 버튼 노출. |
| 📝 | **버그 메모** | 저장 시 입력하는 선택적 텍스트 메모 — 통합 HTML 리포트에 포함되고 원격 업로드 시 함께 전송. |
| 💾 | **세션 연속성** | `enableBackup: true` 설정 시 탭 숨김 시 세션을 sessionStorage에 자동 저장하고 새로고침 후 조용히 복원 — 팝업 없음, 데이터 손실 없음. (탭을 닫으면 데이터가 삭제됩니다.) |
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
// 1번 클릭 → 확인 → 파일 3종이 자동 다운로드됩니다.
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

`endpoint`를 설정하지 않으면 사용자 기기에 ZIP 파일 1개를 다운로드합니다:

| 파일 | 내용 |
|---|---|
| `qa-report-{timestamp}.zip` | 아래 3개 파일을 포함한 ZIP |
| `qa-session-{timestamp}.rr.json` | DOM 세션 리플레이 (rrweb 이벤트 원본) |
| `qa-network-{timestamp}.har` | 네트워크 로그 (HAR 1.2) |
| `qa-report-{timestamp}.html` | 통합 QA 리포트 — 세션 리플레이 + 네트워크 + 콘솔을 하나의 파일로 |

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
  memo     →  (선택) 사용자가 입력한 버그 메모 텍스트
```

---

## 설정 옵션

모든 옵션은 `window.__QA_RECORDER_CONFIG__`으로 설정하거나 생성자 인수로 전달할 수 있습니다. 생성자 인수가 우선합니다.

```ts
window.__QA_RECORDER_CONFIG__ = {
  endpoint: '',              // 원격 업로드 URL. 비워두면 로컬 저장 (기본값).
  maxRequests: 100,          // 순환 버퍼 최대 기록 수 (기본값: 100).
  maskHeaders: [             // 저장 전 마스킹할 헤더 (기본값 표시).
    'Authorization',
    'Cookie',
    'Set-Cookie',
  ],
  zIndex: 2147483647,        // UI 요소의 z-index (기본값: 최대 정수).
  consoleLevels: ['error', 'warn'],  // 캡처할 콘솔 레벨 (기본값 표시).
  maxConsoleEntries: 200,    // 순환 버퍼 최대 콘솔 기록 수 (기본값: 200).
  enableBackup: false,       // 탭 숨김 시 세션을 sessionStorage에 자동 저장하고 새로고침 후 복원 (기본값: false). 탭 닫기 시 삭제됨.
  mode: 'normal',            // 녹화 강도 프리셋: 'light' | 'normal' | 'heavy' (기본값: 'normal').
};
```

| 옵션 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `endpoint` | `string` | `''` | 원격 업로드 URL. 비어있으면 로컬 다운로드. |
| `maxRequests` | `number` | `100` | 순환 버퍼에 유지할 최대 네트워크 기록 수. |
| `maskHeaders` | `string[]` | `['Authorization', 'Cookie', 'Set-Cookie']` | 마스킹할 헤더 이름 목록. |
| `zIndex` | `number` | `2147483647` | UI 요소(버튼, 프로그레스 바, 공유 패널)의 z-index. |
| `consoleLevels` | `string[]` | `['error', 'warn']` | 캡처할 콘솔 레벨. 유효값: `'error'`, `'warn'`, `'log'`, `'info'`. |
| `maxConsoleEntries` | `number` | `200` | 순환 버퍼에 유지할 최대 콘솔 기록 수. |
| `enableBackup` | `boolean` | `false` | `true`로 설정 시, 탭이 숨겨질 때(새로고침·이동) 현재 세션을 sessionStorage에 자동 저장. 다음 `init()` 호출 시 팝업 없이 현재 세션 버퍼에 조용히 복원. 롤링 윈도우는 `mode` 값에 따름 (light: 30분 / normal: 20분 / heavy: 5분). 탭 닫기 시 데이터 삭제. |
| `mode` | `'light' \| 'normal' \| 'heavy'` | `'normal'` | rrweb의 checkout 주기와 이벤트 샘플링을 조정하는 녹화 강도 프리셋. 메모리 버퍼를 일정 수준으로 유지함. DOM 변화가 잦거나 애니메이션이 많은 페이지, 장시간 세션에는 `'heavy'` 사용 — 5분 checkout + `mousemove`/`scroll`/`input` 스로틀. 가벼운 페이지에서 더 긴 30분 이력을 원하면 `'light'`. |

---

## 동작 원리

```
페이지 로드
  ├─ NetworkCapture.start()   → window.fetch + XHR 패치 (순환 버퍼)
  ├─ ScreenRecorder.start()   → rrweb.record() 즉시 시작 (최근 20분 유지)
  ├─ ConsoleCapture.start()   → console.error/warn + window.onerror 패치 (순환 버퍼)
  └─ FloatingButton.mount()   → Shadow DOM으로 버튼 삽입 (recording 상태)

플로팅 버튼 클릭
  ├─ ConfirmModal.show()            → { confirmed, memo }
  │   └─ [취소] → no-op
  ├─ ScreenRecorder.stop()
  ├─ NetworkCapture.snapshot()  → HAR 1.2 JSON 생성
  ├─ ConsoleCapture.snapshot()  → 콘솔 엔트리 배열 생성
  ├─ MaskingFilter.apply()      → 민감 헤더 마스킹
  ├─ ProgressBar.show()         → "Saving..."
  │
  ├─ [endpoint 설정된 경우]
  │   ├─ RemoteDelivery.send()  → POST multipart/form-data
  │   ├─ ProgressBar.hide()
  │   └─ SharePanel.show(url)   → 링크 복사 버튼 (서버가 url 반환 시)
  │
  └─ [endpoint 없는 경우]
      └─ LocalStorage.save()    → ZIP 파일 1개 다운로드:
                                   qa-report-*.zip
                                     ├─ qa-session-*.rr.json
                                     ├─ qa-network-*.har
                                     └─ qa-report-*.html  ← 통합 QA 리포트

  └─ ScreenRecorder.reset() + start()   → 녹화 자동 재시작
     NetworkCapture.clearBuffer()       → 네트워크 로그 초기화
     ConsoleCapture.clearBuffer()       → 콘솔 로그 초기화
```

---

## 통합 QA 리포트 뷰어

로컬 저장 시 함께 다운로드되는 `qa-report-{timestamp}.html`을 브라우저에서 열면 됩니다. 서버, 확장 프로그램, 별도 소프트웨어 불필요.

### 세션 리플레이 (왼쪽 패널)

- **재생 / 일시정지** 버튼과 타임라인 스크러버
- **1× / 2× / 4×** 배속 전환
- 마우스 커서 및 인터랙션 재현
- 타임라인에 네트워크 요청 / 콘솔 에러 마커 표시

### 네트워크 인스펙터 (오른쪽 패널 — Network 탭)

| 탭 | 내용 |
|---|---|
| **Headers** | General (URL, 메서드, 상태) · 요청 헤더 · 응답 헤더 |
| **Payload** | Query String 파라미터 · 요청 본문 (JSON pretty-print 포함) |
| **Response** | 응답 본문 (JSON pretty-print 포함) |
| **Timing** | Send / Wait(TTFB) / Receive 막대 차트 |

- URL 필터 검색으로 요청 빠르게 찾기
- 행 클릭 시 **해당 시점으로 즉시 이동**
- 재생 중 현재 활성 요청 강조 표시

### 콘솔 로그 (오른쪽 패널 — Console 탭)

- Error / Warning / Log 레벨별 필터
- 항목 클릭 시 **해당 시점으로 즉시 이동**
- 재생 중 미래 항목 흐리게 표시 (타임라인 점진적 노출)

> 뷰어는 재생 시 CDN(`cdn.jsdelivr.net`)에서 rrweb을 로드합니다. 재생에는 인터넷 연결이 필요합니다.

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

pnpm -F qa-recorder test      # 테스트 실행 (Vitest + jsdom, 164개)
pnpm -F qa-recorder build     # ESM + UMD 빌드
pnpm -F qa-recorder dev       # watch 모드
pnpm -F qa-recorder demo      # 로컬 데모 서버 (http://localhost:5173)
```

---

## 라이선스

MIT
