# qa-recorder

웹 애플리케이션을 위한 경량 QA 녹화 라이브러리입니다. 네트워크 활동과 화면 녹화를 동시에 캡처하고, 결과물을 공유하거나 다운로드해 버그를 쉽게 재현하고 보고할 수 있습니다.

[English](./README.md)

---

## 왜 qa-recorder인가요?

웹 애플리케이션에서 버그를 재현하는 건 어렵습니다. qa-recorder는 백그라운드에서 조용히 실행되며 최근 100건의 네트워크 요청과 화면 녹화를 지속적으로 캡처합니다. 문제가 발생했을 때 QA 팀원이 버튼 하나만 누르면 — 모든 것이 저장됩니다.

## 주요 기능

- **플로팅 버튼** — 화면 우측 하단에 항상 표시되는 저장 트리거
- **네트워크 캡처** — `fetch`와 `XHR`을 인터셉트하여 최대 100건을 순환 버퍼에 저장 (HAR 1.2 포맷)
- **화면 녹화** — `MediaStream` 기반 연속 비디오 캡처 (RecordRTC 사용)
- **민감 데이터 마스킹** — `Authorization`, `Cookie` 등 지정된 헤더를 자동으로 마스킹
- **두 가지 저장 모드**
  - `remote` — 자체 백엔드에 청크 업로드 후 공유 링크 생성
  - `local` — `.webm` 비디오 + `.har` 파일을 사용자 기기에 직접 다운로드
- **업로드 재시도** — 업로드 중단 시 `localStorage`에 진행 상태 저장, 재접속 후 이어서 업로드
- **Shadow DOM 격리** — UI가 호스트 애플리케이션의 스타일에 영향을 주지 않음

## 설치

```bash
npm install qa-recorder
```

또는 script 태그로 직접 삽입 (UMD 빌드):

```html
<script src="https://unpkg.com/qa-recorder/dist/qa-recorder.umd.js"></script>
```

## 빠른 시작

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

### Script 태그 (자동 초기화)

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

### 로컬 모드 (서버 없이 사용)

```js
const recorder = new QARecorder({ storage: 'local' });
await recorder.init();
// 버튼 클릭 시 파일을 바로 다운로드
```

## 설정 옵션

| 옵션 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `endpoint` | `string` | `''` | 백엔드 서버 URL (`remote` 모드에서 필수) |
| `apiKey` | `string` | `''` | `Authorization: Bearer`로 전송되는 API 키 |
| `storage` | `'remote' \| 'local'` | `'remote'` | 녹화 데이터 저장 위치 |
| `maxRequests` | `number` | `100` | 순환 버퍼에 유지할 최대 네트워크 기록 수 |
| `maskHeaders` | `string[]` | `['Authorization', 'Cookie', 'Set-Cookie']` | 저장 전 마스킹할 헤더 이름 목록 |

## 동작 원리

```
페이지 로드
  └─ NetworkCapture.start()   → fetch / XHR 인터셉트 (순환 버퍼, 최대 100건)
  └─ ScreenRecorder.start()   → 화면 공유 권한 요청 후 연속 녹화 시작
  └─ FloatingButton.mount()   → Shadow DOM으로 버튼 삽입

사용자가 버튼 클릭
  └─ ConfirmModal             → "현재까지의 내용을 저장하시겠습니까?"
  └─ [확인]
      └─ ScreenRecorder.stop()
      └─ NetworkCapture.snapshot() → HAR 1.2 JSON 생성
      └─ MaskingFilter.apply()     → 민감 헤더 마스킹

      [storage: local]
        └─ .webm + .har 파일 다운로드

      [storage: remote]
        └─ POST /sessions          → sessionId 발급
        └─ POST /sessions/:id/har  → HAR 업로드
        └─ POST /upload/init       → S3 멀티파트 초기화
        └─ POST /upload/chunk ×N   → 청크 업로드 (3개 병렬, 자동 재시도)
        └─ POST /upload/complete   → FFmpeg 트랜스코딩 시작
        └─ Poll /upload/status     → 'done' 상태 대기
        └─ POST /sessions/:id/share → 공유 링크 생성
        └─ ShareLinkPanel          → 클립보드 복사 버튼 표시
```

## 백엔드 (자체 호스팅)

qa-recorder는 함께 제공되는 서버(`apps/server`)와 함께 사용하도록 설계되었습니다. 설정 방법은 [apps/server](./apps/server)를 참고하세요.

**기술 스택:** Node.js · Fastify · TypeScript · PostgreSQL · AWS S3 · FFmpeg

**주요 API 엔드포인트:**

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `POST` | `/sessions` | 새 세션 생성 |
| `POST` | `/upload/init` | S3 멀티파트 업로드 초기화 |
| `POST` | `/upload/chunk` | 청크 1개 업로드 |
| `POST` | `/upload/complete` | 업로드 완료 및 트랜스코딩 시작 |
| `POST` | `/sessions/:id/har` | HAR 데이터 업로드 |
| `GET` | `/upload/status/:id` | 트랜스코딩 상태 폴링 |
| `POST` | `/sessions/:id/share` | 공유 링크 생성 |
| `GET` | `/s/:token` | 단축 URL 해석 (인증 불필요) |
| `GET` | `/sessions/:id/timeline` | 비디오 + 네트워크 동기화 타임라인 |

## 프로젝트 구조

```
qa-recorder/
├── packages/
│   ├── sdk/        # 프론트엔드 라이브러리 (이 패키지)
│   └── shared/     # 공유 TypeScript 타입
└── apps/
    └── server/     # Fastify 백엔드
```

## 개발 환경 실행

```bash
# 의존성 설치
pnpm install

# SDK 데모 페이지 실행
cd packages/sdk && pnpm demo

# 백엔드 개발 서버 실행
cd apps/server && pnpm dev
```

## 브라우저 지원

다음 API를 지원하는 브라우저가 필요합니다:
- `MediaDevices.getDisplayMedia` (화면 캡처)
- `MediaRecorder` API
- ES2017+

Chrome 72+, Edge 79+, Firefox 66+

> **주의:** 프로덕션 환경에서 화면 캡처는 HTTPS가 필요합니다.

## 라이선스

MIT
