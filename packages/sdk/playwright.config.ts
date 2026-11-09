import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.E2E_PORT ?? 4319);

const ALL_BROWSERS = {
  chromium: devices['Desktop Chrome'],
  firefox: devices['Desktop Firefox'],
  webkit: devices['Desktop Safari'],
} as const;
type BrowserName = keyof typeof ALL_BROWSERS;

/**
 * 실행할 브라우저 — E2E_BROWSERS(쉼표 구분)로 고른다. 기본은 세 브라우저 모두이며, 설치된 브라우저만 있는
 * 로컬에서는 예를 들어 `E2E_BROWSERS=chromium pnpm test:e2e`나 `pnpm test:e2e --project=chromium`으로 실행한다.
 * CI는 브라우저마다 job을 나눠 `--project`로 실행한다 (.github/workflows/ci.yml).
 */
const browsers = (process.env.E2E_BROWSERS ?? Object.keys(ALL_BROWSERS).join(','))
  .split(',').map((b) => b.trim()).filter((b): b is BrowserName => b in ALL_BROWSERS);

/**
 * 실제 브라우저(Chromium, Firefox, WebKit) E2E. 현재 체크아웃에서 빌드한 SDK(dist/)를 로컬 fixture 서버로 서빙한다 — 먼저 `pnpm build`.
 * 외부 네트워크에 의존하지 않는다 (리포트의 rrweb CDN 스크립트도 테스트가 npm의 같은 파일로 대신 응답하고,
 * 브라우저가 integrity(SRI)를 그대로 검증한다).
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    acceptDownloads: true,
    trace: 'off',
  },
  projects: browsers.map((name) => ({ name, use: { ...ALL_BROWSERS[name] } })),
  webServer: {
    command: 'node e2e/fixture-server.mjs',
    url: `http://localhost:${port}/`,
    reuseExistingServer: !process.env.CI,
    env: { E2E_PORT: String(port) },
  },
});
