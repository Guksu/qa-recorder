import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveConfig } from '../config.js';

describe('resolveConfig', () => {
  afterEach(() => {
    delete (window as Window & { __QA_RECORDER_CONFIG__?: object }).__QA_RECORDER_CONFIG__;
  });

  it('기본값을 반환한다', () => {
    const config = resolveConfig();
    expect(config.maxRequests).toBe(100);
    expect(config.maskHeaders).toEqual(['Authorization', 'Cookie', 'Set-Cookie']);
  });

  it('overrides로 maxRequests를 덮어쓴다', () => {
    const config = resolveConfig({ maxRequests: 50 });
    expect(config.maxRequests).toBe(50);
  });

  it('overrides로 maskHeaders를 덮어쓴다', () => {
    const config = resolveConfig({ maskHeaders: ['X-Token'] });
    expect(config.maskHeaders).toEqual(['X-Token']);
  });

  it('window.__QA_RECORDER_CONFIG__ 값을 반영한다', () => {
    (window as Window & { __QA_RECORDER_CONFIG__?: object }).__QA_RECORDER_CONFIG__ = {
      maxRequests: 200,
    };
    const config = resolveConfig();
    expect(config.maxRequests).toBe(200);
  });

  it('overrides가 window.__QA_RECORDER_CONFIG__보다 우선한다', () => {
    (window as Window & { __QA_RECORDER_CONFIG__?: object }).__QA_RECORDER_CONFIG__ = {
      maxRequests: 200,
    };
    const config = resolveConfig({ maxRequests: 10 });
    expect(config.maxRequests).toBe(10);
  });
});
