import { VERSION } from './version.js';

/** 저장 시점의 실행 환경 — 버그 재현에 필요한 브라우저·화면 정보 */
export interface EnvironmentInfo {
  /** 저장한 페이지의 URL (maskKeys 규칙으로 민감한 쿼리·fragment 값을 가린 값) */
  url: string;
  userAgent: string;
  language: string;
  /** IANA 시간대 (예: Asia/Seoul). 알 수 없으면 빈 문자열 */
  timeZone: string;
  /** 브라우저 창 안쪽 크기 (CSS 픽셀) */
  viewport: { width: number; height: number };
  /** 화면 크기 (CSS 픽셀) */
  screen: { width: number; height: number };
  devicePixelRatio: number;
  /** 저장 시각 (ISO 8601) */
  savedAt: string;
  sdkVersion: string;
}

/**
 * 현재 환경 정보를 모은다. maskUrl은 페이지 URL의 민감 값을 가리는 함수 (MaskingFilter.maskUrl).
 * 문서 제목이나 referrer처럼 개인정보가 담기기 쉬운 값은 모으지 않는다.
 */
export function collectEnvironment(maskUrl: (url: string) => string): EnvironmentInfo {
  let timeZone = '';
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
  } catch {
    /* Intl을 쓸 수 없는 환경 */
  }
  return {
    url: maskUrl(window.location.href),
    userAgent: navigator.userAgent,
    language: navigator.language,
    timeZone,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    screen: { width: window.screen?.width ?? 0, height: window.screen?.height ?? 0 },
    devicePixelRatio: window.devicePixelRatio || 1,
    savedAt: new Date().toISOString(),
    sdkVersion: VERSION,
  };
}
