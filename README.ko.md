# qa-recorder

[![npm version](https://img.shields.io/npm/v/qa-recorder?color=crimson)](https://www.npmjs.com/package/qa-recorder)
[![license](https://img.shields.io/npm/l/qa-recorder?color=blue)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![test](https://img.shields.io/badge/tests-72%20passing-brightgreen)](./packages/sdk)

**버튼 하나로 화면 녹화 + 네트워크 기록을 저장하는 웹 QA 라이브러리**

[English](./README.md)

---

## 왜 qa-recorder인가요?

웹 QA를 하다 보면 이런 상황을 자주 마주칩니다.

> "방금 버튼을 클릭했더니 오류가 났는데, 다시 해보니까 재현이 안 돼요."

개발자가 버그를 찾으려면 두 가지가 필요합니다: **그 순간의 화면**과 **그 순간의 네트워크 요청**. 스크린샷 한 장과 텍스트 재현 절차로는 충분하지 않은 경우가 많습니다.

`qa-recorder`는 페이지 로드 시점부터 백그라운드에서 조용히 동작합니다. 문제가 발생했을 때 QA 담당자가 플로팅 버튼을 클릭하면, 세 가지 파일이 즉시 저장됩니다:

- **화면 녹화 영상** (.webm)
- **네트워크 요청 로그** (.har)
- **독립 실행형 HAR 뷰어 HTML** (서버 없이 브라우저에서 바로 열람)

백엔드 불필요. 브라우저 확장 프로그램 불필요. script 태그 하나만 추가하면 됩니다.

---

## 주요 기능

| | 기능 | 설명 |
|---|---|---|
| 🎥 | **화면 녹화** | `MediaStream` 기반 연속 캡처 (RecordRTC). 페이지 로드 시 자동 시작. |
| 🌐 | **네트워크 캡처** | `fetch`와 `XHR` 인터셉트. 최대 100건 순환 버퍼, HAR 1.2 포맷. |
| 🔍 | **HAR 뷰어** | Chrome 개발자도구 스타일의 독립 HTML 뷰어 자동 생성. |
| 🔒 | **헤더 마스킹** | `Authorization`, `Cookie` 등 민감 헤더 자동 마스킹. |
| 📦 | **로컬 저장** | `.webm` + `.har` + `.html` 3종 파일을 로컬에 다운로드. |
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
// 화면 우측 하단에 빨간 플로팅 버튼이 나타납니다.
// 클릭 → 확인 → 파일 3종이 자동 다운로드됩니다.
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

`endpoint`를 설정하지 않으면 사용자 기기에 파일 3종을 다운로드합니다:

| 파일 | 내용 |
|---|---|
| `qa-recording-{timestamp}.webm` | 화면 녹화 영상 |
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
  video  →  qa-recording-{timestamp}.webm
  har    →  qa-network-{timestamp}.har
```

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
};
```

| 옵션 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `endpoint` | `string` | `''` | 원격 업로드 URL. 비어있으면 로컬 다운로드. |
| `maxRequests` | `number` | `100` | 순환 버퍼에 유지할 최대 기록 수. |
| `maskHeaders` | `string[]` | `['Authorization', 'Cookie', 'Set-Cookie']` | 마스킹할 헤더 이름 목록. |

---

## 동작 원리

```
페이지 로드
  ├─ NetworkCapture.start()   → window.fetch + XHR 패치 (순환 버퍼)
  ├─ ScreenRecorder.start()   → getDisplayMedia 권한 요청 후 녹화 시작
  └─ FloatingButton.mount()   → Shadow DOM으로 버튼 삽입

플로팅 버튼 클릭
  └─ ConfirmModal             → "현재까지의 내용을 저장하시겠습니까?"
  └─ [확인]
      ├─ ScreenRecorder.stop()
      ├─ NetworkCapture.snapshot()  → HAR 1.2 JSON 생성
      ├─ MaskingFilter.apply()      → 민감 헤더 마스킹
      │
      ├─ [endpoint 설정된 경우]
      │   ├─ ProgressBar.show()     → "업로드 중..."
      │   ├─ RemoteDelivery.send()  → POST multipart/form-data
      │   ├─ ProgressBar.hide()
      │   └─ SharePanel.show(url)   → 링크 복사 버튼 (서버가 url 반환 시)
      │
      └─ [endpoint 없는 경우]
          └─ LocalStorage.save()    → .webm + .har + .html 다운로드
```

---

## HAR 뷰어

로컬 저장 시 함께 다운로드되는 `.html` 파일은 완전히 독립 실행형입니다. 서버, 확장 프로그램, 인터넷 연결 없이 브라우저에서 바로 열 수 있습니다.

- 요청/응답 헤더, 바디, 상태 코드 확인
- 각 항목의 응답 시간(ms) 확인
- 마스킹된 헤더는 `[MASKED]`로 표시

---

## 브라우저 지원

| 브라우저 | 지원 여부 |
|---|---|
| Chrome 72+ | ✅ 완전 지원 |
| Edge 79+ | ✅ 완전 지원 |
| Firefox 66+ | ⚠️ 화면 공유 허용 필요 |
| Safari | ❌ `MediaRecorder` 미지원 |

> 프로덕션 환경에서 화면 캡처는 **HTTPS**가 필요합니다. `localhost`는 HTTP에서도 동작합니다.

---

## 개발

```bash
pnpm install

pnpm -F qa-recorder test      # 테스트 실행 (Vitest + jsdom, 72개)
pnpm -F qa-recorder build     # ESM + UMD 빌드
pnpm -F qa-recorder dev       # watch 모드
```

---

## 라이선스

MIT
