/**
 * qa-recorder가 쓰는 HAR 타입. SDK의 공개 타입이므로 패키지 안에서 정의한다
 * (배포된 .d.ts가 비공개 workspace 패키지를 참조하면 소비자의 타입 검사가 TS2307로 실패한다).
 *
 * - 캡처 버퍼(`getNetworkEntries()`, sessionStorage 백업)는 `HAREntry`를 그대로 담는다.
 *   HAR 1.2에서 필수인 cookies·cache·redirectURL 등은 캡처 시점에 알 수 없거나 의미가 없어 선택 필드로 두고,
 *   내보낼 때(HARBuilder.build) 채운다.
 * - 내보내는 `.har` 파일과 업로드되는 `har` 필드는 `HARDocument`(`{ log: HARLog }`) — 표준 HAR 1.2 구조다.
 */

export interface HARNameValue {
  name: string;
  value: string;
  comment?: string;
}

export interface HARCookie {
  name: string;
  value: string;
  path?: string;
  domain?: string;
  expires?: string | null;
  httpOnly?: boolean;
  secure?: boolean;
  comment?: string;
}

export interface HARPostData {
  mimeType: string;
  /** 보낸 본문 텍스트. 텍스트로 읽을 수 없는 본문(FormData, Blob 등)은 내보낼 때 생략하고 comment로 알린다 */
  text?: string;
  params?: { name: string; value?: string; fileName?: string; contentType?: string; comment?: string }[];
  comment?: string;
}

export interface HARRequest {
  method: string;
  url: string;
  /** 페이지의 fetch/XHR에서는 알 수 없어 '' (알 수 없음)으로 기록한다 */
  httpVersion: string;
  cookies?: HARCookie[];
  headers: HARNameValue[];
  queryString: HARNameValue[];
  postData?: HARPostData;
  /** 바이트 단위. 알 수 없으면 -1 */
  headersSize: number;
  /** 보낸 본문의 바이트 수. 본문이 없으면 0, 알 수 없으면 -1 */
  bodySize: number;
  comment?: string;
}

export interface HARContent {
  /** 디코딩된 본문의 바이트 수. 알 수 없으면 -1 */
  size: number;
  compression?: number;
  mimeType: string;
  text?: string;
  encoding?: string;
  comment?: string;
}

export interface HARResponse {
  status: number;
  statusText: string;
  /** 페이지의 fetch/XHR에서는 알 수 없어 '' (알 수 없음)으로 기록한다 */
  httpVersion: string;
  cookies?: HARCookie[];
  headers: HARNameValue[];
  content: HARContent;
  redirectURL?: string;
  /** 바이트 단위. 알 수 없으면 -1 */
  headersSize: number;
  /** 네트워크로 받은(압축된) 본문의 바이트 수. 페이지에서는 알 수 없어 -1 */
  bodySize: number;
  comment?: string;
}

/**
 * HAR 1.2에서 send·wait·receive는 필수이고 0 이상이어야 하며, 엔트리의 time은 -1이 아닌 값의 합이어야 한다.
 * qa-recorder는 전체 소요 시간만 측정하므로 내보낼 때 전체를 wait에 넣고 comment로 단계별 값이 측정값이 아님을 밝힌다.
 */
export interface HARTimings {
  blocked?: number;
  dns?: number;
  connect?: number;
  send: number;
  wait: number;
  receive: number;
  ssl?: number;
  comment?: string;
}

export interface HAREntry {
  pageref?: string;
  /** 요청을 시작한 시각 (ISO 8601) */
  startedDateTime: string;
  /** 전체 소요 시간(ms). fetch는 응답 헤더를 받을 때까지, XHR은 loadend까지 */
  time: number;
  request: HARRequest;
  response: HARResponse;
  cache?: Record<string, unknown>;
  timings: HARTimings;
  comment?: string;
  /** 녹화 시작 시점으로부터 경과한 ms (뷰어 타임라인 동기화용, HAR 사용자 정의 필드) */
  _offsetMs?: number;
}

export interface HARCreator {
  name: string;
  version: string;
  comment?: string;
}

/** HAR 1.2의 log 객체 */
export interface HARLog {
  version: string;
  creator: HARCreator;
  entries: HAREntry[];
  comment?: string;
}

/** 표준 HAR 1.2 파일의 최상위 구조 — `.har` 파일과 업로드되는 `har` 필드의 내용 */
export interface HARDocument {
  log: HARLog;
}
