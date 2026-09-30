import type { HAREntry, HARNameValue } from '@qa-recorder/shared';

const MASKED = '[MASKED]';

/** body/쿼리의 키가 민감 정보인지 판별하는 함수 — MaskingFilter.createKeyMatcher()로 생성 */
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
   * 유효한 항목이 없으면 null — body/쿼리 마스킹 비활성.
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
   * 헤더(maskSet)와 URL 쿼리·요청/응답 body의 민감 키(isSensitiveKey) 값을 [MASKED]로 바꾼 사본을 반환.
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
        url: maskUrl(request.url, isSensitiveKey),
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

/**
 * URL의 쿼리 파라미터 값만 마스킹. URLSearchParams로 재직렬화하면 인코딩이 바뀌므로(공백 → '+')
 * 매칭된 값만 문자열 치환하고 나머지(경로, 다른 파라미터, fragment)는 그대로 둔다.
 */
function maskUrl(url: string, isSensitiveKey: KeyMatcher | null): string {
  if (!isSensitiveKey) return url;
  try {
    const hashIndex = url.indexOf('#');
    const end = hashIndex === -1 ? url.length : hashIndex;
    const queryIndex = url.indexOf('?');
    if (queryIndex === -1 || queryIndex > end) return url;

    const query = url.slice(queryIndex + 1, end);
    const masked = maskFormEncoded(query, isSensitiveKey);
    return masked === query ? url : url.slice(0, queryIndex + 1) + masked + url.slice(end);
  } catch {
    return url.split(/[?#]/)[0]; // fail-closed: 쿼리와 fragment를 통째로 제거
  }
}

/** application/x-www-form-urlencoded 형식(URL 쿼리 포함)에서 매칭된 필드의 값만 교체하고 나머지 바이트는 유지 */
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
