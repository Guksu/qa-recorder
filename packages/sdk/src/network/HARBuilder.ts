import type {
  HARBodyStatus, HARContent, HARDocument, HAREntry, HARPostData, HARRequest, HARResponse,
} from '../types/har.js';
import { VERSION } from '../core/version.js';
import { BINARY_PLACEHOLDER } from './bodyLimit.js';

/** 내보내는 HAR 전체에 대한 설명 — 페이지 안에서 캡처해 알 수 없는 값을 어떻게 표현했는지 */
export const HAR_LOG_COMMENT =
  'Captured inside the page by qa-recorder (fetch/XHR interception). Values the page cannot observe are ' +
  'marked as unknown: httpVersion is "", headersSize and response bodySize are -1, content.size is -1 when the ' +
  'body was not read in full, and cookies are not captured (empty arrays). Only the total time of each request ' +
  'is measured; see timings.comment.';

/** timings.comment — send/wait/receive는 HAR에서 필수지만 qa-recorder는 단계별 시간을 측정하지 않는다 */
export const HAR_TIMINGS_COMMENT =
  'Not measured per phase: qa-recorder measures only the total time (fetch: until response headers; ' +
  'XHR: until loadend). The total is reported as "wait" so that the timings add up to "time"; send and ' +
  'receive are 0 and the other phases are -1 (unknown).';

/** 잘린 body 끝에 붙는 표시 (bodyLimit.truncationNote) */
const TRUNCATION_NOTE = /\n…\[truncated by qa-recorder: kept the first (\d+)(?: of (\d+))? characters\]$/;

const NOT_CAPTURED_BINARY = 'Body not captured: binary or non-text content.';

/** 본문 기록 상태별 설명 (complete·truncated·binary는 본문 텍스트로 따로 설명한다) */
const BODY_STATUS_COMMENTS: Partial<Record<HARBodyStatus, string>> = {
  pending: 'Body was still being received when this report was saved; text holds only what had arrived by then '
    + '(it may be cut mid-way). If the body finished later, the request is included again in the next report.',
  error: 'Body could not be read completely: the response stream failed. text holds what had arrived before the error, if anything.',
  aborted: 'Body capture stopped before the body was complete (recording stopped, the page was left, or the request '
    + 'was pushed out of the maxRequests buffer). text holds what had arrived, if anything.',
  omitted: 'Body not recorded: maxBodySize is 0.',
};

const ALSO_IN_EARLIER_REPORT = 'Also included in an earlier report, which was saved while this response body was still '
  + 'being received. Its startedDateTime may be before this report\'s replay starts.';

/**
 * 캡처 버퍼의 엔트리를 표준 HAR 1.2 문서(`{ log: { version, creator, entries } }`)로 만든다.
 *
 * - HAR 1.2의 필수 필드(cookies, cache, redirectURL 등)를 채운다.
 * - 측정하지 않은 값은 측정값처럼 보이지 않게 둔다: 크기는 -1, HTTP 버전은 '', 단계별 시간은 comment로 밝힌다.
 * - 캡처할 때 넣은 표시('[binary]', 잘림 표시)는 본문에서 빼고 comment로 옮긴다.
 * - 사용자 정의 필드 `_offsetMs`(뷰어 타임라인용)는 그대로 둔다 — HAR은 `_`로 시작하는 필드를 허용한다.
 *
 * 입력 엔트리는 바꾸지 않는다. 예전 버전이 sessionStorage에 남긴 백업 엔트리처럼 필드가 빠진 엔트리도 받는다.
 */
export class HARBuilder {
  static build(entries: HAREntry[]): HARDocument {
    return {
      log: {
        version: '1.2',
        creator: { name: 'qa-recorder', version: VERSION },
        entries: entries.map(toHarEntry),
        comment: HAR_LOG_COMMENT,
      },
    };
  }
}

function toHarEntry(entry: HAREntry): HAREntry {
  const time = nonNegative(entry.time);
  const out: HAREntry = {
    startedDateTime: entry.startedDateTime,
    time,
    request: toHarRequest(entry.request),
    response: toHarResponse(entry.response),
    cache: {},
    timings: { blocked: -1, dns: -1, connect: -1, ssl: -1, send: 0, wait: time, receive: 0, comment: HAR_TIMINGS_COMMENT },
  };
  if (entry.pageref !== undefined) out.pageref = entry.pageref;
  const comment = joinComments(entry.comment, entry._alsoInEarlierReport ? ALSO_IN_EARLIER_REPORT : undefined);
  if (comment) out.comment = comment;
  if (typeof entry._offsetMs === 'number' && Number.isFinite(entry._offsetMs)) out._offsetMs = entry._offsetMs;
  if (entry._alsoInEarlierReport) out._alsoInEarlierReport = true;
  return out;
}

function toHarRequest(request: HARRequest): HARRequest {
  const out: HARRequest = {
    method: request.method ?? '',
    url: toUriReference(request.url ?? ''),
    httpVersion: request.httpVersion ?? '',
    cookies: request.cookies ?? [],
    headers: request.headers ?? [],
    queryString: request.queryString ?? [],
    headersSize: integerOrUnknown(request.headersSize),
    bodySize: integerOrUnknown(request.bodySize),
  };
  if (request.postData) out.postData = toHarPostData(request.postData);
  if (request.comment !== undefined) out.comment = request.comment;
  return out;
}

function toHarPostData(postData: HARPostData): HARPostData {
  const out: HARPostData = { mimeType: postData.mimeType ?? '' };
  const body = splitBody(postData.text);
  if (body.text !== undefined) out.text = body.text;
  if (postData.params) out.params = postData.params;
  const comment = joinComments(postData.comment, body.comment);
  if (comment) out.comment = comment;
  return out;
}

function toHarResponse(response: HARResponse): HARResponse {
  const out: HARResponse = {
    status: Number.isInteger(response.status) ? response.status : 0,
    statusText: response.statusText ?? '',
    httpVersion: response.httpVersion ?? '',
    cookies: response.cookies ?? [],
    headers: response.headers ?? [],
    content: toHarContent(response.content),
    redirectURL: response.redirectURL ?? headerValue(response.headers, 'location') ?? '',
    headersSize: integerOrUnknown(response.headersSize),
    bodySize: integerOrUnknown(response.bodySize),
  };
  if (response.status === 0) {
    out.comment = joinComments(response.comment, 'No response: the request failed or was blocked before a response arrived.');
  } else if (response.comment !== undefined) {
    out.comment = response.comment;
  }
  return out;
}

function toHarContent(content: HARContent | undefined): HARContent {
  const body = splitBody(content?.text);
  const status = content?._bodyStatus;
  const out: HARContent = {
    // 다 받지 못한 본문의 크기는 알 수 없다
    size: status === 'pending' || status === 'aborted' || status === 'error' ? -1 : integerOrUnknown(content?.size),
    mimeType: content?.mimeType ?? '',
  };
  if (body.text !== undefined) out.text = body.text;
  if (content?.encoding !== undefined) out.encoding = content.encoding;
  if (content?.compression !== undefined) out.compression = content.compression;
  const comment = joinComments(content?.comment, status ? BODY_STATUS_COMMENTS[status] : undefined, body.comment);
  if (comment) out.comment = comment;
  if (status) out._bodyStatus = status;
  return out;
}

/**
 * 캡처한 본문 텍스트를 HAR의 text와 comment로 나눈다.
 * '[binary]'는 실제 본문이 아니므로 text를 생략하고, 잘림 표시는 text에서 떼어 comment로 옮긴다.
 * 빈 문자열은 본문이 없거나 기록하지 않은 경우이므로 text를 생략한다 (크기는 size·bodySize로 알 수 있다).
 */
function splitBody(text: string | undefined): { text?: string; comment?: string } {
  if (text === undefined || text === '') return {};
  if (text === BINARY_PLACEHOLDER) return { comment: NOT_CAPTURED_BINARY };
  const match = TRUNCATION_NOTE.exec(text);
  if (!match) return { text };
  const total = match[2] ? ` of ${match[2]}` : '';
  return {
    text: text.slice(0, match.index),
    comment: `Truncated by qa-recorder: kept the first ${match[1]}${total} characters (maxBodySize).`,
  };
}

/**
 * HAR의 url은 URI여야 한다. 마스킹이 넣은 `[MASKED]`의 대괄호는 경로·쿼리·fragment에서 쓸 수 없는 문자라
 * 엄격한 HAR 도구가 거부하므로 퍼센트 인코딩한다 (호스트의 IPv6 주소 `[::1]`은 그대로 둔다).
 * 브라우저가 정규화한 URL에는 그 밖에 인코딩되지 않은 문자가 남지 않는다.
 */
function toUriReference(url: string): string {
  const match = /^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/?#]*)([\s\S]*)$/.exec(url);
  const [authority, rest] = match ? [match[1], match[2]] : ['', url];
  return authority + rest.replace(/\[/g, '%5B').replace(/\]/g, '%5D');
}

function headerValue(headers: { name: string; value: string }[] | undefined, name: string): string | undefined {
  return headers?.find((h) => h.name.toLowerCase() === name)?.value;
}

function joinComments(...comments: (string | undefined)[]): string | undefined {
  const parts = comments.filter((c): c is string => typeof c === 'string' && c !== '');
  return parts.length ? parts.join(' ') : undefined;
}

/** HAR 크기 필드: 0 이상의 정수, 알 수 없으면 -1 */
function integerOrUnknown(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : -1;
}

function nonNegative(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}
