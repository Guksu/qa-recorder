import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveConfig } from '../config.js';

describe('resolveConfig', () => {
  afterEach(() => {
    delete (window as Window & { __QA_RECORDER_CONFIG__?: object }).__QA_RECORDER_CONFIG__;
  });

  it('기본값을 반환한다', () => {
    const config = resolveConfig();
    expect(config.endpoint).toBe('');
    expect(config.maxRequests).toBe(100);
    expect(config.maxBodySize).toBe(100 * 1024);
    expect(config.maxReplaySize).toBe(20 * 1024 * 1024);
    expect(config.maskHeaders).toEqual([
      'Authorization', 'Cookie', 'Set-Cookie',
      'Proxy-Authorization', 'X-API-Key', 'X-Auth-Token', 'X-CSRF-Token', 'X-XSRF-Token',
    ]);
    expect(config.enableBackup).toBe(false);
  });

  it('maskKeys 기본값은 비밀번호·토큰·카드 정보 등 민감 키 목록이다 (body/쿼리 마스킹 기본 활성)', () => {
    const config = resolveConfig();
    expect(config.maskKeys).toEqual([
      'password', 'passwd', 'pwd', 'passwordConfirm', 'passwordConfirmation', 'passphrase', 'passcode',
      'secret', 'secretKey', 'token', 'jwt', 'apiKey', 'accessKey', 'clientSecret', 'privateKey',
      'credential', 'authorization', 'sessionId', 'otp', 'otpCode', 'ssn', 'cardNumber', 'cvv', 'cvc',
    ]);
  });

  it('overrides로 endpoint를 설정한다', () => {
    const config = resolveConfig({ endpoint: 'https://my-server.com/upload' });
    expect(config.endpoint).toBe('https://my-server.com/upload');
  });

  it('overrides로 maxRequests를 덮어쓴다', () => {
    const config = resolveConfig({ maxRequests: 50 });
    expect(config.maxRequests).toBe(50);
  });

  it('overrides로 maskHeaders를 덮어쓴다', () => {
    const config = resolveConfig({ maskHeaders: ['X-Token'] });
    expect(config.maskHeaders).toEqual(['X-Token']);
  });

  it('overrides로 maskKeys를 덮어쓰고, 빈 배열로 body/쿼리 마스킹을 끌 수 있다', () => {
    expect(resolveConfig({ maskKeys: ['memberNo'] }).maskKeys).toEqual(['memberNo']);
    expect(resolveConfig({ maskKeys: [] }).maskKeys).toEqual([]);
  });

  it('rrweb 프라이버시 옵션 기본값은 rrweb 기본 동작과 같다 (비밀번호 입력만 마스킹, 셀렉터 없음)', () => {
    const config = resolveConfig();
    expect(config.maskAllInputs).toBe(false);
    expect(config.maskTextSelector).toBeNull();
    expect(config.blockSelector).toBeNull();
  });

  it('overrides로 rrweb 프라이버시 옵션을 설정한다', () => {
    const config = resolveConfig({ maskAllInputs: true, maskTextSelector: '.pii', blockSelector: '.private' });
    expect(config.maskAllInputs).toBe(true);
    expect(config.maskTextSelector).toBe('.pii');
    expect(config.blockSelector).toBe('.private');
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

  it('mode의 기본값은 normal이다', () => {
    const config = resolveConfig();
    expect(config.mode).toBe('normal');
  });

  it('overrides로 mode를 heavy로 설정한다', () => {
    const config = resolveConfig({ mode: 'heavy' });
    expect(config.mode).toBe('heavy');
  });

  it('overrides로 mode를 light로 설정한다', () => {
    const config = resolveConfig({ mode: 'light' });
    expect(config.mode).toBe('light');
  });

  it('overrides로 maxReplaySize를 덮어쓰고, Infinity로 크기 제한을 끌 수 있다', () => {
    expect(resolveConfig({ maxReplaySize: 5 * 1024 * 1024 }).maxReplaySize).toBe(5 * 1024 * 1024);
    expect(resolveConfig({ maxReplaySize: Infinity }).maxReplaySize).toBe(Infinity);
  });

  it('명시적 undefined 값은 기본값을 덮어쓰지 않는다', () => {
    const config = resolveConfig({ maxRequests: undefined, endpoint: undefined, mode: 'heavy' });
    expect(config.maxRequests).toBe(100);
    expect(config.endpoint).toBe('');
    expect(config.mode).toBe('heavy');
  });

  it('window 설정의 undefined 값도 기본값을 덮어쓰지 않는다', () => {
    (window as Window & { __QA_RECORDER_CONFIG__?: object }).__QA_RECORDER_CONFIG__ = {
      maxConsoleEntries: undefined,
    };
    const config = resolveConfig();
    expect(config.maxConsoleEntries).toBe(200);
  });
});
