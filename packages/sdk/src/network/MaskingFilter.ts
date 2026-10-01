import type { HAREntry, HARNameValue } from '@qa-recorder/shared';

const MASKED = '[MASKED]';

/** body·URL(쿼리·fragment)의 키가 민감 정보인지 판별하는 함수 — MaskingFilter.createKeyMatcher()로 생성 */
export type KeyMatcher = (key: string) => boolean;

export class MaskingFilter {
  /**
   * maskKeys로 민감 키 판별 함수를 만든다. 호출자가 한 번만 생성해 재사용할 것.
   * 키와 목록 항목을 모두 정규화한 뒤, 키가 항목과 같거나 항목으로 끝나면 매칭한다
   * (access_token, x-api-key, newPassword, refreshToken → 매칭). 키 끝의 숫자는 무시한다
   * (Django 회원가입 폼의 password1/password2).
   * 키 전체가 항목의 복수형이어도 매칭한다 (tokens, passwords, apiKeys, credentials — 하위 키가
   * access/refresh처럼 일반적인 이름이라 래퍼 키에서 가려야 하는 경우). 복수형은 접미사로 보지 않아
   * max_tokens, total_tokens 같은 카운터는 매칭하지 않는다.
   * 유효한 항목이 없으면 null — body·요청 URL·페이지 URL 마스킹 비활성.
   */
  static createKeyMatcher(maskKeys: string[]): KeyMatcher | null {
    const entries = Array.from(new Set(maskKeys.map(normalizeKey).filter(Boolean)));
    if (entries.length === 0) return null;
    const entrySet = new Set(entries);
    return (key) => {
      const normalized = normalizeKey(key);
      if (!normalized) return false;
      const withoutDigits = normalized.replace(/\d+$/, '');
      if (withoutDigits.endsWith('s') && entrySet.has(withoutDigits.slice(0, -1))) return true;
      return entries.some((e) => normalized.endsWith(e) || withoutDigits.endsWith(e));
    };
  }

  /**
   * 헤더(maskSet)와 URL 쿼리·fragment, 요청/응답 body의 민감 키(isSensitiveKey) 값을 [MASKED]로 바꾼 사본을 반환.
   * maskSet은 호출자가 한 번만 생성해 재사용할 것 (lowercase 처리된 Set<string>).
   * 앱의 fetch/XHR 경로에서 호출되므로 throw하지 않는다.
   */
  static apply(entry: HAREntry, maskSet: Set<string>, isSensitiveKey: KeyMatcher | null): HAREntry {
    const maskHeaderList = (headers: { name: string; value: string }[]) =>
      headers.map((h) => ({
        name: h.name,
        value: maskSet.has(h.name.toLowerCase()) ? MASKED : h.value,
      }));

    const { request, response } = entry;
    const masked: HAREntry = {
      ...entry,
      request: {
        ...request,
        url: MaskingFilter.maskUrl(request.url, isSensitiveKey),
        headers: maskHeaderList(request.headers),
        queryString: maskNameValues(request.queryString, isSensitiveKey),
      },
      response: {
        ...response,
        headers: maskHeaderList(response.headers),
        content: { ...response.content },
      },
    };
    if (request.postData) {
      masked.request.postData = {
        ...request.postData,
        text: MaskingFilter.maskBody(request.postData.text, request.postData.mimeType, isSensitiveKey),
      };
    }
    if (response.content.text !== undefined) {
      masked.response.content.text =
        MaskingFilter.maskBody(response.content.text, response.content.mimeType, isSensitiveKey);
    }
    return masked;
  }

  /**
   * body 텍스트에서 민감 키의 값을 마스킹. fetch 응답처럼 엔트리 기록 후 비동기로 채워지는 body에도 사용.
   * - 객체/배열로 파싱되는 JSON (mimeType 무관): 중첩 객체·배열을 재귀 순회하며 키 단위 마스킹
   * - application/x-www-form-urlencoded: 필드 단위 마스킹
   * - 그 외, 또는 JSON 파싱 실패: 원문 유지
   * 마스킹된 값이 없으면 원문을 그대로 반환하고, 있으면 JSON은 compact하게 재직렬화한다
   * (JSON.parse를 거치므로 2^53을 넘는 정수는 정밀도를 잃을 수 있음).
   * 예기치 못한 예외 시에는 원문 대신 [MASKED]를 반환한다 (fail-closed).
   */
  static maskBody(text: string, mimeType: string, isSensitiveKey: KeyMatcher | null): string {
    if (!isSensitiveKey || !text) return text;
    try {
      const json = parseJsonContainer(text);
      if (json !== undefined) {
        return maskJsonNode(json, isSensitiveKey) ? JSON.stringify(json) : text;
      }
      if (mimeType.toLowerCase().includes('application/x-www-form-urlencoded')) {
        return maskFormEncoded(text, isSensitiveKey);
      }
      return text;
    } catch {
      return MASKED;
    }
  }

  /**
   * 끝까지 읽지 못하고 잘린 body의 민감 키 값을 가린다 (maxBodySize를 넘은 fetch 응답).
   * 잘린 JSON은 JSON.parse가 실패해 maskBody가 원문을 그대로 두므로, JSON으로 보이면 토큰 단위로 훑어
   * 민감 키의 값(문자열·숫자·리터럴·객체·배열)을 "[MASKED]"로 바꾼다. 값이 잘린 끝까지 이어지면 거기서 텍스트를 끝낸다.
   * form 형식은 필드 단위로 가리고(마지막 필드가 잘려 있어도 키가 보이면 가림), 그 밖의 형식은 원문을 둔다.
   * 예기치 못한 예외 시에는 [MASKED]를 반환한다 (fail-closed).
   */
  static maskTruncatedBody(text: string, mimeType: string, isSensitiveKey: KeyMatcher | null): string {
    if (!isSensitiveKey || !text) return text;
    try {
      if (mimeType.toLowerCase().includes('json') || /^\s*[[{]/.test(text)) {
        return maskPartialJson(text, isSensitiveKey);
      }
      if (mimeType.toLowerCase().includes('application/x-www-form-urlencoded')) {
        return maskFormEncoded(text, isSensitiveKey);
      }
      return text;
    } catch {
      return MASKED;
    }
  }

  /**
   * URL의 쿼리와 fragment에서 민감 키의 값만 [MASKED]로 바꾼다. 요청 URL과 rrweb이 기록하는 페이지 URL에 사용.
   * fragment는 '='를 포함할 때만 form 필드로 보며, 해시 라우트의 쿼리(`#/reset?token=...`)와
   * OAuth implicit flow처럼 fragment 자체가 form 필드인 경우(`#access_token=...&token_type=bearer`)를 모두 검사한다
   * (maskFragment 참고). URLSearchParams로 재직렬화하면 인코딩이 바뀌므로(공백 → '+') 매칭된 값만 문자열 치환하고,
   * 가릴 값이 없으면 원본 URL을 그대로 반환한다.
   * 필드의 키만 비교하고 값은 해석하지 않으므로, 경로나 다른 필드 값 안에 중첩된 토큰(`/reset/{token}`,
   * `?next=/reset?token=...`, 퍼센트 인코딩된 경우 포함)은 감지하지 않는다.
   * 앱의 fetch/XHR과 rrweb emit 경로에서 호출되므로 throw하지 않는다. 예기치 못한 예외 시에는
   * 쿼리와 fragment를 통째로 제거한다 (fail-closed).
   */
  static maskUrl(url: string, isSensitiveKey: KeyMatcher | null): string {
    if (!isSensitiveKey) return url;
    try {
      const hashIndex = url.indexOf('#');
      if (hashIndex === -1) return maskQuery(url, isSensitiveKey);

      const beforeHash = url.slice(0, hashIndex);
      const fragment = url.slice(hashIndex + 1);
      const maskedBeforeHash = maskQuery(beforeHash, isSensitiveKey);
      const maskedFragment = maskFragment(fragment, isSensitiveKey);
      return maskedBeforeHash === beforeHash && maskedFragment === fragment
        ? url
        : `${maskedBeforeHash}#${maskedFragment}`;
    } catch {
      return url.split(/[?#]/)[0]; // fail-closed: 쿼리와 fragment를 통째로 제거
    }
  }
}

/**
 * 비교용 키 정규화: 소문자화 후 ASCII 영숫자가 아닌 문자(_ - . 공백 [] 등)를 제거.
 * 비 ASCII 문자는 유지해 한글 등 다른 문자의 키도 지정할 수 있게 한다.
 */
function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[\x00-\x2f\x3a-\x40\x5b-\x60\x7b-\x7f]/g, '');
}

/** null·빈 문자열은 비밀이 아니고 "값이 비어 있었다"는 사실이 디버깅에 유용하므로 유지 */
function isMaskable(value: unknown): boolean {
  return value !== null && value !== '';
}

function maskNameValues(list: HARNameValue[], isSensitiveKey: KeyMatcher | null): HARNameValue[] {
  if (!isSensitiveKey) return list;
  return list.map(({ name, value }) => ({
    name,
    value: isMaskable(value) && isSensitiveKey(name) ? MASKED : value,
  }));
}

/** URL에서 '#' 앞부분(beforeHash)의 쿼리를 마스킹. 쿼리가 없거나 가릴 값이 없으면 그대로 반환 */
function maskQuery(beforeHash: string, isSensitiveKey: KeyMatcher): string {
  const queryIndex = beforeHash.indexOf('?');
  return queryIndex === -1 ? beforeHash : maskFieldsFrom(beforeHash, queryIndex + 1, isSensitiveKey);
}

/**
 * fragment('#' 뒤)를 마스킹. '='가 없으면(#section, #/users/1) 필드가 없으므로 그대로 둔다.
 * 두 형태를 차례로 검사하고, 어느 쪽에도 가릴 값이 없으면 fragment를 그대로 반환한다.
 * 1. 해시 라우트의 쿼리: 해시 라우터(React Router, Vue Router, Angular)처럼 첫 '?'에서 경로와 쿼리를 나눠 그 뒤를
 *    form 필드로 본다. 경로에 '='가 있어도(#/reset;lang=ko?token=..., #/share/YQ==/view?token=...) 쿼리를 검사한다.
 * 2. fragment 자체가 form 필드인 경우(OAuth implicit flow): 첫 '=' 앞의 마지막 '?' 뒤부터, 그런 '?'가 없으면
 *    fragment 전체를 form 필드로 본다. 값 안에 인코딩되지 않은 '?'가 있어도(#access_token=...&state=/home?tab=1)
 *    그 앞의 필드까지 검사하고, 라우트 경로를 쿼리 키에 이어 붙여 비교하지 않는다(#/session?id=1은 매칭 안 됨).
 */
function maskFragment(fragment: string, isSensitiveKey: KeyMatcher): string {
  if (!fragment.includes('=')) return fragment;
  const routed = maskFieldsFrom(fragment, fragment.indexOf('?') + 1, isSensitiveKey);
  return maskFieldsFrom(routed, routed.lastIndexOf('?', routed.indexOf('=')) + 1, isSensitiveKey);
}

/** text의 start 위치부터를 form 필드로 보고 마스킹. 가릴 값이 없으면 text를 그대로 반환 */
function maskFieldsFrom(text: string, start: number, isSensitiveKey: KeyMatcher): string {
  const fields = text.slice(start);
  const masked = maskFormEncoded(fields, isSensitiveKey);
  return masked === fields ? text : text.slice(0, start) + masked;
}

/** application/x-www-form-urlencoded 형식(URL 쿼리·fragment 포함)에서 매칭된 필드의 값만 교체하고 나머지 바이트는 유지 */
function maskFormEncoded(text: string, isSensitiveKey: KeyMatcher): string {
  let masked = false;
  const fields = text.split('&').map((field) => {
    const eq = field.indexOf('=');
    if (eq === -1 || eq === field.length - 1) return field; // 값 없음
    if (!isSensitiveKey(decodeFormComponent(field.slice(0, eq)))) return field;
    masked = true;
    return field.slice(0, eq + 1) + MASKED;
  });
  return masked ? fields.join('&') : text;
}

function decodeFormComponent(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value; // 잘못된 % 시퀀스는 원문 그대로 비교
  }
}

/** 키를 가질 수 있는 JSON(객체/배열)만 파싱. 그 외 텍스트나 파싱 실패 시 undefined */
function parseJsonContainer(text: string): unknown {
  if (!/^\s*[[{]/.test(text)) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** 객체·배열을 재귀 순회하며 민감 키의 값을 [MASKED]로 교체 (node를 직접 수정). 교체가 있었는지 반환 */
function maskJsonNode(node: unknown, isSensitiveKey: KeyMatcher): boolean {
  if (typeof node !== 'object' || node === null) return false;
  let masked = false;
  if (Array.isArray(node)) {
    for (const item of node) {
      if (maskJsonNode(item, isSensitiveKey)) masked = true;
    }
    return masked;
  }
  const obj = node as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (isSensitiveKey(key)) {
      // 값이 객체/배열이어도 통째로 가린다 (예: "token": { "access": ..., "refresh": ... })
      if (isMaskable(obj[key])) {
        obj[key] = MASKED;
        masked = true;
      }
    } else if (maskJsonNode(obj[key], isSensitiveKey)) {
      masked = true;
    }
  }
  return masked;
}

/**
 * JSON.parse 없이 JSON 텍스트를 앞에서부터 훑으며 민감 키의 값을 가린다 (끝이 잘린 텍스트용).
 * 객체 키 = 문자열 토큰 뒤에 (공백 후) ':'가 오는 경우. null·빈 문자열 값은 maskJsonNode처럼 유지한다.
 */
function maskPartialJson(text: string, isSensitiveKey: KeyMatcher): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] !== '"') {
      out += text[i++];
      continue;
    }
    const keyEnd = scanString(text, i);
    if (keyEnd === -1) return out + text.slice(i); // 잘린 문자열 — 민감 키의 값이라면 아래에서 이미 처리됐다
    let colon = keyEnd;
    while (isJsonSpace(text[colon])) colon++;
    if (text[colon] !== ':') {
      out += text.slice(i, keyEnd);
      i = keyEnd;
      continue;
    }

    const key = decodeJsonString(text.slice(i, keyEnd));
    out += text.slice(i, colon + 1);
    i = colon + 1;
    if (!isSensitiveKey(key)) continue;

    let valueStart = i;
    while (isJsonSpace(text[valueStart])) valueStart++;
    out += text.slice(i, valueStart);
    const valueEnd = scanValue(text, valueStart);
    // 값이 잘린 끝까지 이어지면 남은 부분이 모두 그 값이다
    if (valueEnd === -1) return out + JSON.stringify(MASKED);
    const value = text.slice(valueStart, valueEnd);
    out += value === 'null' || value === '""' ? value : JSON.stringify(MASKED);
    i = valueEnd;
  }
  return out;
}

function isJsonSpace(ch: string | undefined): boolean {
  return ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t';
}

/** start의 '"'로 시작하는 문자열 토큰이 끝나는 위치(닫는 따옴표 다음). 잘려서 닫히지 않으면 -1 */
function scanString(text: string, start: number): number {
  for (let j = start + 1; j < text.length; j++) {
    if (text[j] === '\\') j++;
    else if (text[j] === '"') return j + 1;
  }
  return -1;
}

/** start에서 시작하는 JSON 값이 끝나는 위치. 값이 텍스트 끝까지 이어지면(잘림) -1 */
function scanValue(text: string, start: number): number {
  const first = text[start];
  if (first === undefined) return -1;
  if (first === '"') return scanString(text, start);
  if (first === '{' || first === '[') {
    let depth = 0;
    for (let j = start; j < text.length; j++) {
      const ch = text[j];
      if (ch === '"') {
        const end = scanString(text, j);
        if (end === -1) return -1;
        j = end - 1;
      } else if (ch === '{' || ch === '[') {
        depth++;
      } else if ((ch === '}' || ch === ']') && --depth === 0) {
        return j + 1;
      }
    }
    return -1;
  }
  // 숫자·true·false·null — 구분자가 나오기 전에 텍스트가 끝나면 잘린 값일 수 있다
  for (let j = start; j < text.length; j++) {
    const ch = text[j];
    if (ch === ',' || ch === '}' || ch === ']' || isJsonSpace(ch)) return j;
  }
  return -1;
}

/** 따옴표를 포함한 JSON 문자열 토큰을 디코딩 (잘못된 이스케이프면 따옴표만 벗긴 원문) */
function decodeJsonString(token: string): string {
  try {
    return JSON.parse(token) as string;
  } catch {
    return token.slice(1, -1);
  }
}
