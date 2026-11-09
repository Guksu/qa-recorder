import { describe, it, expect, vi } from 'vitest';
import path from 'path';
import { localSdkPlugin, localBuildInfo, DEMO_SDK_IMPORT } from '../localSdkPlugin';
import pkg from '../../package.json';

const sdkRoot = path.resolve(__dirname, '../..');

describe('localSdkPlugin', () => {
  it('데모의 SDK import를 CDN 배포본이 아니라 현재 체크아웃의 src/index.ts로 연결한다', () => {
    const plugin = localSdkPlugin(sdkRoot);
    const resolveId = plugin.resolveId as (source: string) => string | null;
    expect(resolveId(DEMO_SDK_IMPORT)).toBe(path.join(sdkRoot, 'src/index.ts'));
    expect(resolveId('/sdk/qa-recorder.esm.js')).toBe(path.join(sdkRoot, 'src/index.ts'));
    expect(resolveId('rrweb')).toBeNull();
  });

  it('/sdk/build-info.json으로 현재 체크아웃의 버전과 커밋을 알려 준다', () => {
    const plugin = localSdkPlugin(sdkRoot);
    const use = vi.fn();
    (plugin.configureServer as (server: unknown) => void)({ middlewares: { use } });
    const middleware = use.mock.calls[0]![0] as (req: unknown, res: unknown, next: () => void) => void;
    const res = { setHeader: vi.fn(), end: vi.fn() };
    const next = vi.fn();

    middleware({ url: '/sdk/build-info.json?t=1' }, res, next);
    const info = JSON.parse(res.end.mock.calls[0]![0] as string);
    expect(info.version).toBe(pkg.version);
    expect(info.source).toMatch(/Local checkout/);

    middleware({ url: '/other' }, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('git 정보는 커밋 해시와 변경 여부를 담는다', () => {
    const info = localBuildInfo(sdkRoot);
    expect(info.commit === null || /^[0-9a-f]{40}$/.test(info.commit)).toBe(true);
    expect(typeof info.dirty).toBe('boolean');
  });
});
