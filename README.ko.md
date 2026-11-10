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

`qa-recorder`는 **rrweb DOM 직렬화** 방식 — 영상 캡처가 아닌 — 으로 SDK가 시작된 시점부터 모든 DOM 변화, 사용자 인터랙션, 네트워크 요청, 콘솔 에러를 통합 수집합니다. rrweb이 영상 스트림 대신 DOM 트리를 직렬화하기 때문에 대용량 파일도, 화면 공유 권한도, 플랫폼 제약도 없습니다.

기본으로 최근 20~40분을 메모리에 유지합니다 (변화가 아주 많은 페이지는 더 짧음 — `mode`, `maxReplaySize` 참고). QA 담당자가 플로팅 버튼을 클릭하고 버그 메모를 입력(선택)하면 저장됩니다:

- **DOM 세션 리플레이** 원본 (rrweb 이벤트 — 경량, 영상 없음)
- **네트워크 요청 로그** (HAR 1.2)
- **환경 정보** — 브라우저, 화면 크기, 마스킹된 페이지 URL, SDK 버전
- **통합 QA 리포트** — 세션 리플레이 + 네트워크 인스펙터 + 콘솔 에러가 시간 동기화된 하나의 HTML 파일로

백엔드 불필요. 브라우저 확장 프로그램 불필요. 화면 공유 권한 불필요. script 태그 하나만 추가하면 됩니다.

---

## 주요 기능

| 기능 | 설명 |
|---|---|
| **DOM 세션 리플레이** | `MutationObserver` 기반 DOM 변화 캡처 (rrweb). 모바일, WebView, 모든 브라우저 지원 — `getDisplayMedia` 불필요. |
| **네트워크 캡처** | `fetch`와 `XHR` 인터셉트. 최대 100건 순환 버퍼, 표준 HAR 1.2 파일로 내보냄. 페이지에서 알 수 없는 값(HTTP 버전, 헤더 크기, 단계별 시간)은 그럴듯한 값으로 채우지 않고 알 수 없음으로 표시 — [HAR 출력](#har-출력) 참고. |
| **콘솔 캡처** | `console.error`, `console.warn`(`consoleLevels`로 `log`, `info` 추가 가능), 잡히지 않은 에러, 처리되지 않은 Promise 거부를 자동 수집. 앱의 `window.onerror`는 건드리지 않음. |
| **통합 QA 리포트** | 하나의 HTML 파일: 세션 리플레이(좌) + 네트워크 인스펙터, 콘솔 로그, 환경 정보(우). 시간 동기화 — 네트워크 행이나 콘솔 항목 클릭 시 해당 시점으로 즉시 이동. |
| **네트워크 상세 패널** | 요청 행 클릭 시 Headers, Payload, Response, Timing 탭 — Chrome 개발자도구 스타일. |
| **민감 정보 마스킹** | 비밀번호·토큰·API 키 등 민감 키(`maskKeys`)의 값을 요청 URL(쿼리와 fragment), JSON·form 요청/응답 body, 리플레이에 기록되는 페이지 URL에서 저장 전에 자동 마스킹하고, `Authorization`, `Cookie` 등 인증 헤더도 가림. 키 이름으로만 판별하므로 URL 경로나 다른 키의 값 안에 담긴 토큰(`?next=` 리다이렉트, 분석 도구로 보내는 페이지 URL 등)은 감지하지 못함 (`maskKeys` 참고). 페이지 DOM 안의 텍스트와 링크는 `maskKeys` 대상이 아니며, `maskAllInputs`·`maskTextSelector`로 리플레이의 입력값·텍스트를 가리고 `rr-block` 클래스를 붙인 요소는 리플레이에서 제외 (`blockSelector`는 아래 제약 참고). SDK 자체 UI(버튼, 버그 메모 입력 창 등)는 리플레이에 녹화되지 않음. |
| **로컬 저장** | 리포트 파일을 ZIP 하나로 로컬에 다운로드 — 백엔드 불필요. ZIP을 만드는 동안에도 녹화는 이어짐. |
| **원격 업로드** | 서버 endpoint 설정 시 제한 시간(`uploadTimeout`) 안에 POST 업로드. 응답 URL이 있으면 링크 복사 버튼 노출, 실패하면 로컬 ZIP으로 대체 저장. 업로드하는 동안에도 녹화는 이어짐. |
| **버그 메모** | 저장 시 입력하는 선택적 텍스트 메모 — 통합 HTML 리포트에 포함되고 원격 업로드 시 함께 전송. |
| **환경 정보** | 브라우저(user agent), 언어, 시간대, 창·화면 크기, 기기 픽셀 비율, 페이지 URL(`maskKeys`로 마스킹), SDK 버전을 리포트마다 저장 — 리포트의 **Environment** 탭에 표시되고 `qa-env-*.json`으로 저장되며 원격 업로드 시 함께 전송. 문서 제목과 referrer는 수집하지 않음. |
| **세션 연속성** | `enableBackup: true` 설정 시 탭 숨김 시 세션을 sessionStorage에 자동 저장하고 새로고침 후 조용히 복원 — 팝업 없음. 세션이 sessionStorage에 다 들어가지 않으면 더 작게 줄여서 백업 (`enableBackup` 참고). (탭을 닫으면 데이터가 삭제됩니다.) |
| **Shadow DOM UI** | 플로팅 버튼과 팝업이 호스트 페이지 스타일과 완전히 격리. 버튼은 마우스·손가락·펜으로 끌어 옮길 수 있음. |

---

## 설치

```bash
npm install qa-recorder
# or
pnpm add qa-recorder
```

또는 script 태그로 직접 삽입 (UMD 빌드, 번들러 불필요):

```html
<script src="https://unpkg.com/qa-recorder@2/dist/qa-recorder.umd.js"></script>
```

`@2`는 2.x 중 최신 버전을 불러옵니다. 그래서 호환성이 깨질 수 있는 다음 큰 버전(3.0 등)은 자동으로 받지 않습니다. 빌드를 완전히 고정하려면 `@2.0.0`처럼 정확한 버전을 적으세요. 1.x에서 올린다면 [1.x에서 올리기](#1x에서-올리기)를 보세요.

---

## 빠른 시작

### Vanilla JS

```ts
import { QARecorder } from 'qa-recorder';

QARecorder.setup({
  enableBackup: true,
});
// 권한 요청이나 클릭 없이 바로 녹화가 시작됩니다.
// 화면 오른쪽 아래에 깜빡이는 빨간 REC 점이 있는 어두운 플로팅 버튼이 나타납니다.
// 최근 20~40분을 메모리에 유지합니다 (변화가 아주 많은 페이지는 더 짧음 — maxReplaySize 참고).
// 1번 클릭 → 확인 → ZIP 파일 1개 자동 다운로드 → 녹화는 계속됩니다.
```

### React

`QARecorder.setup()`은 컴포넌트나 훅 밖, 모듈 최상단에서 호출하세요. `setup()`은 두 번째 호출부터 아무 일도 하지 않으므로 React StrictMode에서도 안전합니다.

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

### Script 태그

```html
<script>
  window.__QA_RECORDER_CONFIG__ = {
    enableBackup: true,
    maxRequests: 100,
  };
</script>
<script src="https://unpkg.com/qa-recorder@2/dist/qa-recorder.umd.js"></script>
```

---

## 저장 방식

### 로컬 저장 (기본)

`endpoint`를 설정하지 않으면 사용자 기기에 ZIP 파일 1개를 다운로드합니다:

| 파일 | 내용 |
|---|---|
| `qa-report-{timestamp}.zip` | 아래 파일들을 포함한 ZIP |
| `qa-session-{timestamp}.rr.json` | DOM 세션 리플레이 (rrweb 이벤트 원본) |
| `qa-network-{timestamp}.har` | 네트워크 로그 (HAR 1.2) |
| `qa-env-{timestamp}.json` | 환경 정보 (브라우저, 언어, 시간대, 창 크기, 마스킹된 페이지 URL, SDK 버전) |
| `qa-report-{timestamp}.html` | 통합 QA 리포트 — 세션 리플레이 + 네트워크 + 콘솔을 하나의 파일로 |

저장하는 동안에도 녹화는 멈추지 않습니다. 버튼을 누른 시점까지의 기록을 저장하고, ZIP을 만드는 동안 페이지에서 일어난 일(DOM 변화, 요청, 콘솔 기록)은 다음 저장을 위해 남겨 둡니다. 저장에 성공하면 저장한 부분만 지우므로 연속으로 저장해도 기록이 겹치거나 빠지지 않습니다 (예외는 응답 본문을 아직 받는 중이던 요청 — [저장할 때 아직 받는 중인 응답 본문](#저장할-때-아직-받는-중인-응답-본문) 참고). 저장에 실패하면 아무것도 지우지 않고, 다음 저장에 실패한 부분이 중복 없이 함께 들어갑니다. 다만 메모리 제한 안에서만 남깁니다:

- 다시 시도해도 리플레이에 페이지 전체 스냅샷이 쌓이지 않습니다. 저장을 나누려고 찍은 스냅샷은 저장에 실패하면 다시 빼므로, 정적인 페이지에서 10번 실패해도 스냅샷은 11개가 아니라 1개입니다.
- 재시도를 위해 남기는 리플레이는 `maxReplaySize` 안에 들어가야 합니다. 저장에 실패하는 동안 페이지가 계속 바뀌어 이 값을 넘게 되면 (마지막 두 구간보다) 오래된 구간을 바로 통째로 버리므로, 남은 리플레이는 여전히 전체 스냅샷부터 시작합니다.
- 네트워크·콘솔 기록은 `maxRequests`, `maxConsoleEntries` 안에서만 남습니다. 저장하는 동안 새 기록에 밀려난 항목은 남지 않습니다.
- 이렇게 실패한 저장의 일부를 버렸으면 안내 문구도 "The recording was kept"가 아니라 그렇게 알립니다 ("…except for its oldest part, which no longer fit within the memory limits … and was dropped: N replay events, M network requests …").

### 원격 업로드

`endpoint`를 설정하면 파일을 서버로 전송합니다. 서버가 `url` 필드를 응답하면 링크 복사 버튼이 자동으로 표시됩니다. 업로드에 실패하면 — 오류 응답, 네트워크 오류, 또는 `uploadTimeout`(기본 2분) 안에 응답이 없을 때 — 같은 데이터를 로컬 ZIP으로 대신 다운로드하고, 이마저 실패하면 녹화 내용을 (위의 메모리 제한 안에서) 유지해 다시 시도할 수 있습니다. 로컬 저장과 마찬가지로 업로드하는 동안에도 녹화는 이어집니다.

업로드 중에 `destroy()`를 호출하면 요청을 취소합니다. 이는 업로드 실패로 다루지 않으므로 ZIP을 내려받지 않고 안내도 띄우지 않으며, 서버의 늦은 응답도 아무 영향을 주지 않습니다.

**저장 취소:** 저장하는 동안 보이는 진행 막대에 **Cancel** 버튼이 있습니다. 누르면 저장을 멈춥니다 — 업로드 요청을 끊고, 아직 받는 중인 응답 본문을 더 기다리지 않으며, 아직 내려받지 않은 로컬 ZIP은 내려받지 않습니다. 저장하려던 기록은 저장에 실패했을 때와 같이 (같은 메모리 제한 안에서) 다음 저장을 위해 남기고, 녹화는 계속됩니다. 대체 ZIP을 내려받지 않고 안내도 띄우지 않습니다 — 다만 메모리 제한 때문에 기록 일부를 버렸다면 알립니다. ZIP을 이미 내려받았거나 업로드가 끝난 뒤에 누른 취소는 늦었으므로 그 저장은 끝난 것으로 다룹니다.

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
  har      →  qa-network-{timestamp}.har     (표준 HAR 1.2: { "log": { ... } })
  console  →  qa-console-{timestamp}.json   (콘솔 로그)
  report   →  qa-report-{timestamp}.html    (통합 QA 리포트)
  env      →  qa-env-{timestamp}.json       (환경 정보)
  memo     →  (선택) 사용자가 입력한 버그 메모 텍스트
```

### HAR 출력

`qa-network-*.har`(ZIP 안의 파일과 업로드의 `har` 필드)는 표준 HAR 1.2 문서입니다. 테스트에서 HAR 1.2 JSON 스키마로 검증하므로 Chrome 개발자도구, HAR 분석기 등 HAR 도구에서 열 수 있습니다:

```json
{ "log": { "version": "1.2", "creator": { "name": "qa-recorder", "version": "…" }, "entries": [ … ], "comment": "…" } }
```

> **변경:** 이전 버전은 최상위 `log` 키 없이 log 객체(`{ "version", "creator", "entries" }`)를 그대로 저장했습니다. 서버에서 업로드된 `har` 필드를 읽는다면 `har.entries` 대신 `har.log.entries`를 읽으세요.

SDK는 페이지 안에서 요청을 캡처하므로 알 수 없는 정보가 있습니다. 이런 값은 그럴듯한 값으로 채우지 않고 알 수 없음으로 표시합니다:

| 필드 | 값 | 이유 |
|---|---|---|
| `request/response.httpVersion` | `""` | `fetch`/XHR는 프로토콜(HTTP/1.1, h2, h3)을 알려 주지 않습니다. |
| `headersSize`, `response.bodySize` | `-1` | 헤더 크기와 전송된(압축됐을 수 있는) 본문 크기는 페이지에서 알 수 없습니다. |
| `response.content.size` | 디코딩한 본문의 바이트 수 또는 `-1` | 본문을 끝까지 읽었을 때만 압니다. 읽지 않은 바이너리 본문과 `maxBodySize`에서 잘린 본문은 `-1`. |
| `request.bodySize` | 보낸 바이트 수, 본문이 없으면 `0`, 또는 `-1` | 페이지가 크기를 알 수 없는 본문(`FormData`, 스트림 등)은 `-1`. |
| `cookies` | `[]` | 쿠키는 캡처하지 않습니다 (`Cookie`/`Set-Cookie`는 페이지에서 읽을 수 없고 어차피 마스킹 대상). |
| `timings` | `send: 0`, `wait: time`, `receive: 0`, 나머지 `-1`, 그리고 `comment` | 전체 시간만 측정합니다 (fetch: 응답 헤더를 받을 때까지, XHR: `loadend`까지). HAR은 `send`/`wait`/`receive`의 합이 `time`이어야 하므로 전체를 `wait`에 넣고, `comment`로 단계별 값을 측정하지 않았음을 밝힙니다. |

기록하지 않은 본문(바이너리, 텍스트가 아닌 요청 본문)은 `text` 없이 `comment`로 이유를 알리고, `maxBodySize`에서 잘린 본문은 캡처한 텍스트를 담고 잘렸음을 `comment`에 적습니다. 가린 값은 `[MASKED]`로 표시합니다 (URL은 유효한 URI여야 하므로 URL 안에서는 `%5BMASKED%5D`로 인코딩). 각 엔트리에는 리포트 타임라인용 사용자 정의 필드 `_offsetMs`(녹화 시작부터 지난 ms)도 남습니다. 각 응답에는 본문을 어디까지 기록했는지 알려 주는 사용자 정의 필드 `_bodyStatus`도 있습니다:

| `_bodyStatus` | 뜻 |
|---|---|
| `complete` | 본문을 끝까지 읽었습니다. |
| `pending` | 리포트를 저장할 때 본문을 아직 받는 중이었습니다. `text`는 그때까지 받은 부분입니다 (`size`는 `-1`). |
| `truncated` | `maxBodySize`에서 잘랐습니다. |
| `error` | 본문을 읽다가 실패했습니다 (응답 스트림 오류). `text`는 그때까지 받은 부분입니다 (있다면). |
| `aborted` | 본문을 다 받기 전에 기록이 끝났습니다: `destroy()`, 페이지 이동(복원한 백업), 또는 `maxRequests` 버퍼에서 밀려남. |
| `cancelled` | 본문이 끝나기 전에 앱이 응답 스트림을 취소했습니다 (`reader.cancel()`, `body.cancel()`). `text`는 그때까지 받은 부분입니다. |
| `binary` | 바이너리라 읽지 않았습니다. |
| `omitted` | `maxBodySize`가 `0`이라 기록하지 않았습니다. |

이전 버전이 만든 리포트에는 `_bodyStatus`가 없습니다.

#### 저장할 때 아직 받는 중인 응답 본문

`fetch()`는 응답 헤더를 받으면 바로 끝나므로, 본문을 아직 받는 중인 요청도 버퍼에 들어 있을 수 있습니다. 저장하면:

1. 그런 본문을 최대 `pendingBodyTimeout`(기본 2초, 진행 막대 표시) 동안 기다립니다. 그 안에 다 받은 본문은 전부 저장합니다.
2. 그 뒤에도 다 받지 못한 본문 — 느린 다운로드나 SSE(Server-Sent Events)처럼 끝나지 않는 스트림 — 은 받은 부분만 다른 본문처럼 마스킹해 저장하고, `_bodyStatus: "pending"`과 `comment`로 표시합니다. 리포트 뷰어에도 같은 안내가 나옵니다. `pendingBodyTimeout`보다 오래 기다리지는 않습니다.
3. 저장에 성공해도 그런 요청은 버퍼에서 빼지 **않습니다**. 다음 리포트에 그때까지 받은 내용(다 받았다면 전체 본문)으로 다시 들어가며, `_alsoInEarlierReport: true`와 `comment`로 표시됩니다. 그래서 같은 요청이 연속한 두 리포트(계속 열려 있는 스트림이라면 그 이상)에 들어갈 수 있습니다. 그 요청의 `startedDateTime`은 다음 리포트의 리플레이 시작보다 앞서므로 리포트 타임라인의 맨 앞에 표시됩니다. 다 받은 본문이 리포트에 들어가면 그다음부터는 평소처럼 버퍼에서 빠집니다.
4. 녹화기는 앱의 스트림이 아니라 응답 사본(`response.clone()`)을 읽고, `destroy()`하면 사본 읽기만 멈춥니다 (`_bodyStatus: "aborted"`). 앱의 스트림에는 영향이 없습니다.

저장할 때 아직 응답 헤더도 받지 못한 요청은 그 리포트에 들어가지 않고, 응답이 오면 기록되어 다음 리포트에 들어갑니다.

스트림 취소: 사본은 앱의 스트림과 같은 연결을 나눠 쓰고, 브라우저는 둘 다 취소돼야 연결을 닫습니다. 그래서 녹화기가 본문을 아직 읽는 동안에는 그 응답의 `response.body`를 원본 스트림을 그대로 넘겨주는 얇은 스트림으로 바꿉니다. 앱이 읽는 만큼만 읽고, 브라우저가 바이트 스트림을 지원하면 BYOB reader도 쓸 수 있으며, 앱이 취소하면(`reader.cancel()`, `body.cancel()`, 취소된 `pipeTo`) 녹화기가 먼저 사본 읽기를 멈추므로 녹화기가 없을 때와 같이 연결이 닫힙니다 (`_bodyStatus: "cancelled"`). `text()`, `json()` 등으로 읽는 응답에는 영향이 없습니다. `AbortSignal`로 요청을 중단하는 경우는 이 변경 전에도 연결이 닫혔습니다.

---

## 설정 옵션

모든 옵션은 `window.__QA_RECORDER_CONFIG__`으로 설정하거나 `QARecorder.setup()`(또는 생성자)에 전달할 수 있습니다. 코드에서 전달한 값이 우선합니다.

```ts
window.__QA_RECORDER_CONFIG__ = {
  endpoint: '',              // 원격 업로드 URL. 비워두면 로컬 저장 (기본값).
  uploadTimeout: 120000,     // 업로드 한 번의 제한 시간(ms) (기본값: 2분). 0 또는 Infinity면 제한 없음.
  pendingBodyTimeout: 2000,  // 저장할 때 아직 받는 중인 응답 본문을 기다리는 시간(ms) (기본값: 2초). 0이면 기다리지 않음.
  maxRequests: 100,          // 순환 버퍼 최대 기록 수 (기본값: 100).
  maxBodySize: 102400,       // 요청/응답 body 하나에 저장할 최대 글자 수 (기본값: 약 100K). 0이면 body 저장 안 함.
  maskHeaders: [             // 저장 전 마스킹할 헤더 (기본값 표시).
    'Authorization',
    'Cookie',
    'Set-Cookie',
    'Proxy-Authorization',
    'X-API-Key',
    'X-Auth-Token',
    'X-CSRF-Token',
    'X-XSRF-Token',
  ],
  maskKeys: [                // 요청 URL·body·리플레이 페이지 URL에서 저장 전 마스킹할 키 (기본값 표시). []이면 비활성.
    'password', 'passwd', 'pwd', 'passwordConfirm', 'passwordConfirmation', 'passphrase', 'passcode',
    'secret', 'secretKey', 'token', 'jwt', 'apiKey', 'accessKey', 'clientSecret', 'privateKey',
    'credential', 'authorization', 'sessionId', 'otp', 'otpCode', 'ssn', 'cardNumber', 'cvv', 'cvc',
  ],
  zIndex: 2147483647,        // UI 요소의 z-index (기본값: 최대 정수).
  consoleLevels: ['error', 'warn'],  // 캡처할 콘솔 레벨 (기본값 표시).
  maxConsoleEntries: 200,    // 순환 버퍼 최대 콘솔 기록 수 (기본값: 200).
  enableBackup: false,       // 탭 숨김 시 세션을 sessionStorage에 자동 저장하고 새로고침 후 복원 (기본값: false). 탭 닫기 시 삭제됨.
  mode: 'normal',            // 녹화 강도 프리셋: 'light' | 'normal' | 'heavy' (기본값: 'normal').
  maxReplaySize: 20971520,   // 메모리에 보관할 리플레이의 대략적인 최대 글자 수 (기본값: 20MB). Infinity면 크기 제한 없음.
  maskAllInputs: false,      // 리플레이에서 모든 input/textarea/select 값 마스킹 (기본값: false = 비밀번호만).
  maskTextSelector: null,    // 리플레이에서 텍스트를 마스킹할 요소의 CSS 셀렉터 (기본값: null).
  blockSelector: null,       // 리플레이에서 제외할 요소의 CSS 셀렉터 — 제약은 아래 표 참고 (기본값: null).
};
```

| 옵션 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `endpoint` | `string` | `''` | 원격 업로드 URL. 비어있으면 로컬 다운로드. |
| `pendingBodyTimeout` | `number` | `2000` | 저장할 때 응답 헤더는 받았지만 본문을 아직 받는 중인 fetch 요청을 기다리는 시간(ms). 그 안에 다 받은 본문은 전부 저장하고, 나머지는 받은 부분만 `_bodyStatus: "pending"`으로 저장한 뒤 다음 리포트에 다시 넣습니다 — [저장할 때 아직 받는 중인 응답 본문](#저장할-때-아직-받는-중인-응답-본문) 참고. 끝나지 않는 스트림(SSE)이 있어도 이보다 오래 기다리지 않습니다. `0`이면 바로 저장합니다. |
| `uploadTimeout` | `number` | `120000` | `endpoint`로 업로드 한 번에 허용하는 시간(ms) — 요청을 보낸 뒤 응답 본문을 다 읽을 때까지. 넘기면 요청을 취소하고 업로드 실패로 다룹니다 (로컬 ZIP으로 대체 저장). `0` 또는 `Infinity`면 제한하지 않습니다. 진행 중인 업로드는 `destroy()`하면 대체 저장 없이 항상 취소됩니다. |
| `maxRequests` | `number` | `100` | 순환 버퍼에 유지할 최대 네트워크 기록 수. |
| `maxBodySize` | `number` | `102400` | 요청/응답 body 하나에 저장할 최대 글자 수 (ASCII 텍스트면 바이트 수와 거의 같음). 넘으면 앞부분만 저장하고 끝에 `…[truncated by qa-recorder …]`를 붙임. fetch 응답은 이 길이까지만 읽으므로 큰 다운로드나 끝나지 않는 스트림(SSE 등)이 메모리에 쌓이지 않음. 바이너리 응답(이미지, 오디오, 영상, 폰트, PDF, ZIP, octet-stream)은 읽지 않고 `"[binary]"`로 기록. `maskKeys` 마스킹은 자르기 전에 적용하며, 잘린 응답은 읽은 데까지 키 단위로 마스킹. `0`이면 body를 저장하지 않고, `Infinity`면 자르지 않음. |
| `maskHeaders` | `string[]` | `['Authorization', 'Cookie', 'Set-Cookie', 'Proxy-Authorization', 'X-API-Key', 'X-Auth-Token', 'X-CSRF-Token', 'X-XSRF-Token']` | 마스킹할 헤더 이름 목록 (대소문자 무시). 지정하면 기본 목록을 대체. |
| `maskKeys` | `string[]` | `['password', 'passwd', 'pwd', 'passwordConfirm', 'passwordConfirmation', 'passphrase', 'passcode', 'secret', 'secretKey', 'token', 'jwt', 'apiKey', 'accessKey', 'clientSecret', 'privateKey', 'credential', 'authorization', 'sessionId', 'otp', 'otpCode', 'ssn', 'cardNumber', 'cvv', 'cvc']` | 저장 전에 값을 `"[MASKED]"`로 바꿀 키 목록. 적용 대상: 캡처한 요청의 URL — 쿼리 파라미터와 `=`를 포함한 fragment(OAuth `#access_token=…&token_type=bearer`, `#/reset?token=…` 같은 해시 라우트의 쿼리), 요청/응답 body(JSON은 중첩 객체·배열까지 재귀 탐색, `application/x-www-form-urlencoded`는 필드 단위), 그리고 rrweb이 리플레이에 기록하는 페이지 URL(쿼리·fragment 규칙 동일) — 비밀번호 재설정·매직 링크의 `?token=`이나 OAuth `#access_token=`이 페이지 URL의 최상위 쿼리·fragment 파라미터이면 리플레이에 기록되는 페이지 URL에서 가려짐. 단, `maskKeys`는 키 이름만 비교하고 문자열 값 안은 검사하지 않으므로, 주소창 URL과 그 안의 토큰은 이 옵션이 다루지 않는 경로로 리플레이·HTML 리포트·sessionStorage 백업에 남을 수 있음. 예: 페이지 URL의 경로에 있거나 매칭되지 않는 키의 파라미터 값 안에 중첩된 토큰(`/reset-password/{token}`, `?next=/reset?token=…`, 퍼센트 인코딩된 경우 포함)은 기록되는 페이지 URL에 그대로 남음. 매칭되지 않는 키의 값으로 페이지 URL을 담은 캡처 요청·응답 — `dl=` 파라미터, `context.page.url`, `request.url` 같은 분석·에러 리포팅 페이로드, `returnTo=` 리다이렉트, 앱 자체의 로그 전송 요청 — 에도 토큰이 그대로 남음. 페이지 DOM 안의 텍스트와 링크(rrweb은 `href="#main"` 같은 상대 링크와 SVG `<use href="#icon">`을 페이지 쿼리가 포함된 절대 URL로 기록함)에도 남음 — 이런 텍스트는 `maskTextSelector`로 가리고, 토큰이 담긴 링크가 있는 요소는 `rr-block` 클래스를 붙여 리플레이에서 제외할 것. 콘솔 기록(인라인 스크립트에서 발생한 에러의 메시지와 스택 트레이스 등)에도 남음. 대소문자와 `_`, `-`, `.` 등 기호를 무시하고 비교하며, 키가 항목과 같거나 항목으로 끝나면(끝의 숫자는 무시), 또는 키 전체가 항목의 복수형이면 매칭 — `access_token`, `x-api-key`, `newPassword`, `password2`, `tokens`, `apiKeys` 모두 매칭 (`max_tokens` 같은 카운터는 제외). 트레이드오프: 페이지네이션 커서 `nextPageToken`처럼 접미사가 같은 비민감 키도 마스킹되고, 일부 JWT 라이브러리가 반환하는 `access`/`refresh`나 Firebase 이메일 액션 링크의 `oobCode`처럼 항목을 포함하지 않는 이름의 비밀 값은 감지되지 않음 — 이런 키는 기본 목록과 함께 `maskKeys`에 직접 지정. `null`과 빈 값은 유지. 지정하면 기본 목록을 대체하며, `[]`이면 이 마스킹을 모두 비활성 (헤더는 `maskHeaders`로 별도 설정). |
| `zIndex` | `number` | `2147483647` | UI 요소(버튼, 프로그레스 바, 공유 패널)의 z-index. |
| `consoleLevels` | `string[]` | `['error', 'warn']` | 캡처할 콘솔 레벨. 유효값: `'error'`, `'warn'`, `'log'`, `'info'`. |
| `maxConsoleEntries` | `number` | `200` | 순환 버퍼에 유지할 최대 콘솔 기록 수. 기록 하나의 메시지와 stack trace는 각각 10,000자에서 자름. |
| `enableBackup` | `boolean` | `false` | `true`로 설정 시, 탭이 숨겨질 때(새로고침·이동) 현재 세션을 sessionStorage에 자동 저장. 다음 `init()` 호출 시 팝업 없이 현재 세션 버퍼에 조용히 복원. 롤링 윈도우는 `mode` 값에 따름 (light: 30분 / normal: 20분 / heavy: 5분). sessionStorage는 저장량이 정해져 있음 (Chromium은 origin마다 키 포함 5,242,880자). 세션 전체가 들어가지 않으면 리플레이는 지금 checkout 구간만 백업하고, 그것도 들어가지 않으면 네트워크·콘솔 기록만 백업. 탭 닫기 시 데이터 삭제. |
| `mode` | `'light' \| 'normal' \| 'heavy'` | `'normal'` | rrweb의 checkout 주기와 이벤트 샘플링을 조정하는 녹화 강도 프리셋. 메모리 버퍼를 일정 수준으로 유지함. DOM 변화가 잦거나 애니메이션이 많은 페이지, 장시간 세션에는 `'heavy'` 사용 — 5분 checkout + `mousemove`/`scroll`/`input` 스로틀. 가벼운 페이지에서 더 긴 30분 이력을 원하면 `'light'`. 구간이 `maxReplaySize`의 절반을 넘으면 시간이 되기 전에 다음 구간으로 넘어가므로, 변화가 많은 페이지에서는 보관 시간이 더 짧을 수 있음. 저장에 실패하면 저장하지 못한 부분은 이보다 오래됐어도 `maxReplaySize` 안에서 다음 시도를 위해 남김 ([저장 방식](#저장-방식) 참고). |
| `maxReplaySize` | `number` | `20971520` (20MB) | 메모리에 보관할 리플레이의 대략적인 최대 크기 (JSON 글자 수, ASCII 텍스트면 바이트 수와 거의 같음). 지금 checkout 구간이 이 값의 절반을 넘으면 바로 새 전체 스냅샷으로 다음 구간을 시작하고 가장 오래된 구간을 버림 — `mode`의 시간 기준 checkout과 같은 방식이라 저장한 리플레이는 처음부터 재생됨. 새 구간은 전체 스냅샷으로 시작하므로 그때 페이지가 잠깐 멈춤 (Chromium 측정: 요소 3,000개에 약 40ms, 60,000개에 500ms). 스냅샷 뒤에 쌓인 변경분이 스냅샷보다 커져야 다음 구간으로 넘어가므로, 스냅샷 하나가 이 값의 4분의 1보다 큰 페이지에서는 보관량이 이 값을 넘을 수 있음 (최대 스냅샷 약 4개 분량) — 마지막 두 구간은 크기와 상관없이 남김. 저장에 실패해 재시도를 위해 남기는 녹화도 이 값 안에서만 남기며, 넘으면 오래된 구간부터 바로 버리고 실패 안내에도 그렇게 알림 ([저장 방식](#저장-방식) 참고). `Infinity`면 크기 제한 없음. |
| `maskAllInputs` | `boolean` | `false` | `true`면 리플레이에서 모든 `<input>`(hidden input과 `type` 속성이 없는 input 포함), `<textarea>`, `<select>` 값을 마스킹. 체크박스·라디오 버튼의 선택 상태는 기록됨. `<textarea>`는 텍스트 콘텐츠(마크업에 담긴 초기값, React 제어 컴포넌트처럼 `defaultValue`로 쓰인 값)도 마스킹되며 공백 외 문자가 `*`로 표시됨. `false`면 비밀번호 입력만 마스킹 (rrweb 기본값). |
| `maskTextSelector` | `string \| null` | `null` | 리플레이에서 텍스트를 마스킹할 요소의 CSS 셀렉터 (공백 외 문자가 `*`로 표시됨). `rr-mask` 클래스가 붙은 요소는 항상 마스킹. |
| `blockSelector` | `string \| null` | `null` | 리플레이에서 제외할 요소의 CSS 셀렉터 — 전체 스냅샷에 포함된 요소는 같은 크기의 빈 placeholder로만 기록. rrweb 1.1.3은 이 셀렉터를 직렬화되는 요소 자신에만 검사하므로, 이후 해당 요소 안에 추가·변경된 콘텐츠(예: 녹화 시작 후 SPA가 렌더링한 영역)와 입력 필드에 입력한 값은 여전히 기록됨. 민감하거나 동적으로 바뀌는 영역과 입력 필드를 확실히 제외하려면 요소에 `rr-block` 클래스를 붙일 것. |

---

## 수명 주기와 TypeScript

`QARecorder.setup()`은 싱글톤을 만들고, `new QARecorder(config)` + `init()`은 직접 관리하는 인스턴스를 만듭니다. `destroy()`는 녹화를 끝내고 인스턴스가 추가한 것을 모두 정리합니다: `fetch`/`XHR`/`console` 패치(아직 녹화기의 패치일 때만 — 그 위에 다른 라이브러리가 감싼 패치는 남겨 둠), `error`/`unhandledrejection`/`pagehide` 리스너, 버튼, 열려 있는 저장 확인창, 진행 막대, 공유 패널. 진행 중인 업로드나 로컬 저장은 취소되고, 그 늦은 완료가 녹화를 다시 시작하거나 UI를 띄우지 않습니다. 그 뒤 `init()`(싱글톤이면 `setup()`)을 다시 호출하면 새 녹화가 시작되며, 이전 녹화의 기록은 섞이지 않습니다.

패키지는 자체 타입 선언을 포함합니다 (다른 패키지 불필요). `QARecorder`, `QARecorderConfig` 외에 HAR 타입(`HARDocument`, `HARLog`, `HAREntry` …), `RecorderMode`, `ConsoleEntry`, `ConsoleLevel`을 export하므로 `getNetworkEntries()` 결과나 업로드된 파일의 타입으로 쓸 수 있습니다. `rrweb`과 `fflate`는 빌드에 포함되어 있어 런타임 의존성이 없습니다.

---

## 동작 원리

```
QARecorder.setup() / init()
  ├─ NetworkCapture.start()   → window.fetch + XHR 패치, 요청을 잡을 때마다 바로 마스킹 (순환 버퍼)
  ├─ ScreenRecorder.start()   → rrweb.record() 즉시 시작 (마지막 두 구간 보관 — mode, maxReplaySize 참고)
  ├─ ConsoleCapture.start()   → console.error/warn 패치, 잡히지 않은 에러·Promise 거부 수신 (순환 버퍼)
  ├─ FloatingButton.mount()   → Shadow DOM으로 버튼 삽입 (recording 상태)
  └─ [enableBackup]           → sessionStorage 백업 복원, pagehide 때 다시 백업

플로팅 버튼 클릭
  ├─ ConfirmModal.show()        → { confirmed, memo }
  │   └─ [취소 또는 destroy()] → no-op
  ├─ 저장할 데이터 잘라 내기       → 녹화는 계속된다:
  │   ├─ ScreenRecorder.cutForSave()  → 지금까지의 이벤트, 지금부터 새 구간(전체 스냅샷) 시작
  │   ├─ NetworkCapture.snapshot()    → 지금까지의 엔트리 (새 요청은 계속 기록)
  │   │   └─ waitForBodies()          → 아직 받는 중인 본문을 pendingBodyTimeout까지 기다림
  │   └─ ConsoleCapture.snapshot()    → 지금까지의 엔트리
  ├─ HARBuilder.build()         → 표준 HAR 1.2 문서
  ├─ collectEnvironment()       → 브라우저, 화면, 마스킹된 페이지 URL, SDK 버전
  ├─ ProgressBar.show()         → "Saving..." + Cancel 버튼
  │
  ├─ [endpoint 설정된 경우]
  │   └─ RemoteDelivery.send()  → POST multipart/form-data (uploadTimeout이 지나거나 destroy()하면 취소)
  │       └─ [업로드 실패·시간 초과] → 대신 LocalStorage.save()
  │
  ├─ [endpoint 없는 경우]
  │   └─ LocalStorage.save()    → ZIP 파일 1개 다운로드:
  │                                qa-report-*.zip
  │                                  ├─ qa-session-*.rr.json
  │                                  ├─ qa-network-*.har
  │                                  ├─ qa-env-*.json
  │                                  └─ qa-report-*.html  ← 통합 QA 리포트
  │
  ├─ [그 사이 destroy()] → 여기서 끝: 버퍼·UI를 건드리지 않고 대체 다운로드도 없음
  ├─ [저장 성공] 저장한 부분만 지움 — 저장하는 동안 기록된 것은 다음 저장을 위해 남김
  │             (본문을 받는 중에 저장된 요청도 다음 리포트를 위해 남김)
  ├─ [저장 실패] 실패한 부분을 재시도를 위해 남김 (중복·추가 스냅샷 없이) — maxReplaySize / maxRequests /
  │             maxConsoleEntries 안에서만, 일부를 버렸으면 안내에 그렇게 알림
  ├─ [Cancel을 누름] 잘라 낸 부분을 실패 때처럼 다음 저장을 위해 남김 (안내 없음)
  └─ 진행 막대 숨김 → SharePanel(업로드 응답에 url이 있을 때) 또는 alert(대체 저장·실패)
```

---

## 통합 QA 리포트 뷰어

로컬 저장 ZIP에 들어 있거나 원격 업로드로 전송된 `qa-report-{timestamp}.html`을 브라우저에서 열면 됩니다. 서버, 확장 프로그램, 별도 소프트웨어 불필요.

### 세션 리플레이 (왼쪽 패널)

- **재생 / 일시정지** 버튼과 타임라인 스크러버
- **1× / 2× / 4×** 배속 전환
- 마우스 커서 및 인터랙션 재현
- 타임라인에 네트워크 요청 / 콘솔 에러·경고 마커 표시 (실패한 요청은 빨간색) — 마커 클릭 시 해당 시점으로 이동

### 네트워크 인스펙터 (오른쪽 패널 — Network 탭)

| 탭 | 내용 |
|---|---|
| **Headers** | General (URL, 메서드, 상태) · 요청 헤더 · 응답 헤더 |
| **Payload** | Query String 파라미터 · 요청 본문 (JSON pretty-print 포함) |
| **Response** | 응답 본문 (JSON pretty-print 포함) |
| **Timing** | 요청의 전체 시간. 단계별 시간은 페이지에서 측정하지 않으므로 그리지 않음 (이전 버전이 만든 리포트는 기존처럼 Send / Wait / Receive 막대를 표시) |

- URL 필터 검색으로 요청 빠르게 찾기
- 행 클릭 시 **해당 시점으로 즉시 이동**
- 재생 중 현재 활성 요청 강조 표시
- 실패한 요청(status 0: 네트워크 오류, CORS, 중단)은 빨간색 `failed`로 표시
- 기록하지 않은 본문(바이너리, `FormData`)은 본문 대신 그 이유를 표시

### 콘솔 로그 (오른쪽 패널 — Console 탭)

- Errors / Warnings / Logs 필터 (Logs에는 `info`도 포함)
- 항목 클릭 시 **해당 시점으로 즉시 이동**
- 재생 중 미래 항목 흐리게 표시 (타임라인 점진적 노출)
- 에러의 stack trace는 `▶ stack`을 눌러 펼쳐 보기

### 환경 정보 (오른쪽 패널 — Environment 탭)

- 저장 시점의 브라우저(user agent), 언어, 시간대, 창·화면 크기, 기기 픽셀 비율, 페이지 URL(`maskKeys`로 마스킹), SDK 버전

> 뷰어는 재생 시 CDN(`cdn.jsdelivr.net`)에서 rrweb을 로드하며, 무결성 검사(SRI)를 거칩니다. 재생에는 인터넷 연결이 필요합니다. 재생기를 불러오지 못해도 네트워크·콘솔 패널은 동작합니다.

---

## 브라우저 지원

| 브라우저 | 지원 여부 |
|---|---|
| Chrome 72+ | 완전 지원 |
| Edge 79+ | 완전 지원 |
| Firefox 66+ | 완전 지원 |
| Safari 14+ | 완전 지원 |
| 모바일 브라우저 | 완전 지원 |
| WebView (Android/iOS) | 완전 지원 |

> rrweb은 `MutationObserver`와 표준 DOM API만 사용합니다. 화면 캡처 권한 불필요, 플랫폼 제약 없음.

---

## 1.x에서 올리기

2.0은 HAR 출력과 몇 가지 동작이 바뀌었습니다. 확인할 것:

- **HAR 파일이 표준 HAR 1.2입니다.** `qa-network-*.har`와 업로드되는 `har` 필드는 `{ "log": { "version", "creator", "entries", … } }`입니다. 1.x는 최상위 `log` 키 없이 log 객체를 저장했습니다. 업로드를 읽는 서버는 `har.entries` 대신 `har.log.entries`를 읽어야 합니다.
- **페이지에서 측정할 수 없는 HAR 값은 채우지 않고 알 수 없음으로 표시합니다:** `httpVersion`은 `""`, 헤더 크기와 `response.bodySize`는 `-1`이고, 단계별 시간은 `timings.comment`로 설명합니다 ([HAR 출력](#har-출력) 참고). XHR URL은 절대 URL로 기록하고, URL 안의 `[MASKED]`는 퍼센트 인코딩하며, 응답마다 `_bodyStatus` 필드가 있습니다.
- **`rrweb`과 `fflate`는 더 이상 패키지 의존성이 아닙니다** — 원래부터 빌드에 포함돼 있었습니다. 앱에서 `rrweb`을 직접 import한다면 앱의 의존성에 추가하세요.
- **저장해도 녹화가 멈추지 않습니다.** 응답 본문을 받는 중이던 요청은 연속한 두 리포트에 들어갈 수 있습니다 ([저장 방식](#저장-방식) 참고). 저장 실패 안내가 메모리 제한 때문에 일부를 버렸다고 알릴 수 있습니다.
- **`destroy()`는** 열려 있는 저장 확인창과 진행 중인 업로드·로컬 저장을 취소하고, 진행 막대와 공유 패널을 닫습니다. 그 뒤 같은 인스턴스에서 `init()`하면 리플레이처럼 네트워크·콘솔 기록도 비운 채 시작합니다.

2.0에 새로 추가된 것: 진행 막대의 취소 버튼, `uploadTimeout`, `pendingBodyTimeout` 옵션과 TypeScript 타입 export(`HARDocument`, `HAREntry`, `HARBodyStatus`, `ConsoleEntry` …).

---

## 개발

```bash
pnpm install

pnpm build                            # SDK 빌드 (ESM + UMD + 타입 선언 → packages/sdk/dist/)
pnpm typecheck                        # SDK와 E2E 테스트 타입 검사
pnpm -F qa-recorder test              # 단위 테스트 (Vitest + jsdom)
pnpm -F qa-recorder dev               # watch 모드
pnpm -F qa-recorder demo              # 로컬 데모 서버 (http://localhost:5173)
pnpm -F qa-recorder verify:package    # 빌드 후: SDK를 패키징해 저장소 밖 독립 프로젝트에 설치하고
                                      # skipLibCheck 없이 타입 검사
pnpm -F qa-recorder test:e2e          # 빌드 후: Chromium·Firefox·WebKit 브라우저 E2E (Playwright)
```

- **데모:** `pnpm demo`는 npm 배포본이 아니라 현재 체크아웃의 SDK(`packages/sdk/src`, Vite 경유)를 씁니다. 페이지 상단 배지에 버전과 커밋이 표시됩니다. [라이브 데모](https://guksu.github.io/qa-recorder/)는 배포한 커밋에서 빌드한 SDK를 쓰며(같은 방식으로 표시), npm 릴리스보다 앞설 수 있습니다.
- **E2E:** 빌드한 SDK, 작은 테스트 앱, 로컬 API, 느림·실패·무응답 모드가 있는 업로드 endpoint를 제공하는 로컬 fixture 서버(`packages/sdk/e2e/fixture-server.mjs`)로 실행합니다 — 외부 서비스에 의존하지 않습니다. 리포트의 rrweb 스크립트는 같은 버전의 npm 파일로 응답하고, 브라우저는 그대로 무결성(SRI)을 검사합니다. 브라우저는 처음에 `pnpm -F qa-recorder exec playwright install chromium firefox webkit`으로 설치합니다. 일부만 실행하려면 `--project=chromium`이나 `E2E_BROWSERS=chromium,firefox`를 씁니다.
- **CI**(`.github/workflows/ci.yml`)는 풀 리퀘스트마다 타입 검사, 단위 테스트, 빌드, 패키지 검증, Chromium·Firefox·WebKit E2E(브라우저마다 job 하나)를 실행합니다.

---

## 라이선스

MIT
