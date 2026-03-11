export interface HARLog {
  version: string;
  creator: { name: string; version: string };
  entries: HAREntry[];
}

export interface HAREntry {
  startedDateTime: string;
  time: number;
  request: HARRequest;
  response: HARResponse;
  timings: HARTimings;
  /** 녹화 시작 시점으로부터 경과한 ms (뷰어 타임라인 동기화용) */
  _offsetMs?: number;
}

export interface HARRequest {
  method: string;
  url: string;
  httpVersion: string;
  headers: HARNameValue[];
  queryString: HARNameValue[];
  postData?: { mimeType: string; text: string };
  bodySize: number;
  headersSize: number;
}

export interface HARResponse {
  status: number;
  statusText: string;
  httpVersion: string;
  headers: HARNameValue[];
  content: { size: number; mimeType: string; text?: string };
  bodySize: number;
  headersSize: number;
}

export interface HARTimings {
  send: number;
  wait: number;
  receive: number;
}

export interface HARNameValue {
  name: string;
  value: string;
}
