import { describe, it, expect, afterEach, vi } from 'vitest';
import { collectEnvironment } from '../environment.js';
import { VERSION } from '../version.js';

describe('collectEnvironment', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState({}, '', '/');
  });

  it('브라우저·화면 정보와 저장 시각, SDK 버전을 모은다', () => {
    const env = collectEnvironment((url) => url);
    expect(env.userAgent).toBe(navigator.userAgent);
    expect(env.language).toBe(navigator.language);
    expect(env.viewport).toEqual({ width: window.innerWidth, height: window.innerHeight });
    expect(env.screen).toEqual({ width: window.screen.width, height: window.screen.height });
    expect(env.devicePixelRatio).toBe(window.devicePixelRatio || 1);
    expect(Number.isNaN(Date.parse(env.savedAt))).toBe(false);
    expect(env.sdkVersion).toBe(VERSION);
    expect(typeof env.timeZone).toBe('string');
  });

  it('페이지 URL은 넘겨받은 maskUrl로 가린 값을 쓴다', () => {
    window.history.replaceState({}, '', '/reset?token=SECRET&lang=ko');
    const maskUrl = vi.fn((url: string) => url.replace('SECRET', '[MASKED]'));
    const env = collectEnvironment(maskUrl);
    expect(maskUrl).toHaveBeenCalledWith(window.location.href);
    expect(env.url).toContain('token=[MASKED]&lang=ko');
    expect(JSON.stringify(env)).not.toContain('SECRET');
  });

  it('Intl을 쓸 수 없으면 시간대는 빈 문자열이다', () => {
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(() => { throw new Error('no Intl'); });
    expect(collectEnvironment((url) => url).timeZone).toBe('');
  });

  it('문서 제목과 referrer는 모으지 않는다', () => {
    const env = collectEnvironment((url) => url) as unknown as Record<string, unknown>;
    expect(env).not.toHaveProperty('title');
    expect(env).not.toHaveProperty('referrer');
  });
});
