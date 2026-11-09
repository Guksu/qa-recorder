import type { Plugin } from 'vite';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

/** 데모 페이지가 SDK를 불러오는 경로 (demo/index.html) */
export const DEMO_SDK_IMPORT = './sdk/qa-recorder.esm.js';
const BUILD_INFO_URL = '/sdk/build-info.json';

/** 데모가 보여 주는 SDK 빌드 정보 (배포 워크플로가 같은 모양의 파일을 만든다) */
export interface SdkBuildInfo {
  version: string;
  /** 사람이 읽는 출처 설명 */
  source: string;
  commit: string | null;
  /** 커밋되지 않은 변경이 있는 체크아웃인지 */
  dirty: boolean;
}

function git(args: string[], cwd: string): string | null {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

/** 현재 체크아웃의 SDK 정보 */
export function localBuildInfo(sdkRoot: string): SdkBuildInfo {
  const pkg = JSON.parse(fs.readFileSync(path.join(sdkRoot, 'package.json'), 'utf8')) as { version: string };
  const status = git(['status', '--porcelain'], sdkRoot);
  return {
    version: pkg.version,
    source: 'Local checkout: packages/sdk/src served by the Vite dev server (pnpm demo)',
    commit: git(['rev-parse', 'HEAD'], sdkRoot),
    dirty: status !== null && status !== '',
  };
}

/**
 * `pnpm demo` 전용: 데모가 불러오는 SDK(`./sdk/qa-recorder.esm.js`)를 CDN의 배포본이 아니라
 * 현재 체크아웃의 소스(src/index.ts)로 연결하고, 그 빌드 정보를 /sdk/build-info.json으로 알려 준다.
 * 소스를 바로 쓰므로 SDK를 고치면 빌드 없이 데모에 반영된다.
 */
export function localSdkPlugin(sdkRoot: string): Plugin {
  const entry = path.join(sdkRoot, 'src/index.ts');
  return {
    name: 'qa-local-sdk',
    enforce: 'pre',
    resolveId(source) {
      if (source === DEMO_SDK_IMPORT || source === '/sdk/qa-recorder.esm.js') return entry;
      return null;
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split('?')[0] !== BUILD_INFO_URL) return next();
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify(localBuildInfo(sdkRoot)));
      });
    },
  };
}
