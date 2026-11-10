import { test, expect, type Page, type BrowserContext, type Download } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { unzipSync, strFromU8 } from 'fflate';
import { harProblems } from '../src/network/__tests__/harValidation';

/**
 * 실제 Chromium에서 현재 체크아웃의 SDK 빌드(dist/)를 쓰는 E2E.
 * 앱 요청·업로드는 모두 로컬 fixture 서버(e2e/fixture-server.mjs)로 간다.
 */

const require = createRequire(__filename);
const RRWEB_CDN = 'https://cdn.jsdelivr.net/npm/rrweb@1.1.3/dist/rrweb.min.js';
const RRWEB_FILE = require.resolve('rrweb/dist/rrweb.min.js');

type HarJson = {
  log: {
    creator: { name: string };
    entries: { request: { method: string; url: string; postData?: { text?: string } }; response: { status: number } }[];
  };
};
type UploadRecord = { id: number; mode: string; fields: Record<string, { filename?: string; text: string }> };

const recorderButton = (page: Page) => page.locator('#qa-recorder-root button');
// 각 UI는 크기가 없는 host 요소의 shadow root 안에 그려지므로, 보이는지는 안쪽 요소로 확인한다
// (Playwright의 CSS 선택자는 열린 shadow root 안까지 찾는다)
const confirmModal = (page: Page) => page.locator('[data-qa="confirm-modal"] .qa-modal');
const progressBar = (page: Page) => page.locator('[data-qa="progress-bar"] .qa-progress-bar-wrap');
const sharePanel = (page: Page) => page.locator('[data-qa="share-panel"] .qa-share-panel');

async function start(page: Page, config: Record<string, unknown> = {}) {
  await page.goto('/');
  await page.evaluate((cfg) => (window as unknown as { startRecorder: (c: unknown) => Promise<boolean> }).startRecorder(cfg), config);
  await expect(recorderButton(page)).toBeVisible();
}

/** 앱을 사용한다: fetch 성공·404, XHR(본문에 비밀번호), console.error, 텍스트 입력 */
async function useApp(page: Page, note = 'typed by e2e') {
  const out = page.locator('#out');
  await page.click('#load');
  await expect(out).toContainText('items 200');
  await page.click('#xhr');
  await expect(out).toContainText('echo 200');
  await page.click('#missing');
  await expect(out).toContainText('missing 404');
  await page.click('#log-error');
  await page.fill('#note', note);
}

async function clickSave(page: Page, memo = '') {
  await recorderButton(page).click();
  await expect(confirmModal(page)).toBeVisible();
  if (memo) await confirmModal(page).locator('textarea').fill(memo);
  await confirmModal(page).locator('#confirm').click();
  await expect(confirmModal(page)).toHaveCount(0);
}

/** 다이얼로그(alert) 메시지를 모으고 바로 닫는다 */
function collectDialogs(page: Page): string[] {
  const messages: string[] = [];
  page.on('dialog', (dialog) => {
    messages.push(dialog.message());
    void dialog.accept();
  });
  return messages;
}

async function readZip(download: Download): Promise<Record<string, string>> {
  const file = await download.path();
  const entries = unzipSync(new Uint8Array(fs.readFileSync(file!)));
  return Object.fromEntries(Object.entries(entries).map(([name, data]) => [name, strFromU8(data)]));
}

function pick(files: Record<string, string>, pattern: RegExp): string {
  const name = Object.keys(files).find((n) => pattern.test(n));
  expect(name, `zip entry matching ${pattern}`).toBeTruthy();
  return files[name!];
}

async function serverState(page: Page): Promise<{ uploads: UploadRecord[]; aborted: number; started: number }> {
  return (await page.request.get('/__uploads')).json();
}

/** 리포트의 rrweb CDN 요청에 npm rrweb@1.1.3의 같은 파일로 응답한다 — 브라우저는 integrity를 그대로 검증한다 */
async function serveRrwebFromNpm(context: BrowserContext, body?: string) {
  await context.route(RRWEB_CDN, (route) => route.fulfill({
    status: 200,
    contentType: 'text/javascript',
    headers: { 'access-control-allow-origin': '*' },
    ...(body === undefined ? { path: RRWEB_FILE } : { body }),
  }));
}

/**
 * 리포트 HTML을 열어 재생기와 네트워크·콘솔 패널이 동작하는지 확인한다.
 * open()은 window의 load 이벤트까지 기다린다 — 재생 iframe의 문서가 열린 채 남으면 load가 오지 않는다 (회귀 확인).
 */
async function expectWorkingReport(page: Page, open: () => Promise<unknown>, requestCount: number) {
  await open();
  await expect(page.locator('#player iframe')).toHaveCount(1); // rrweb Replayer가 재생 iframe을 만든다
  await expect(page.locator('.player-unavailable')).toHaveCount(0);
  await expect(page.locator('#net-summary')).toHaveText(`${requestCount} requests`);
  await expect(page.locator('.net-row')).toHaveCount(requestCount);
  await expectReplayedPage(page);

  // 네트워크 행을 누르면 그 시점으로 탐색한다 — 전체 스냅샷을 다시 만들어도 재생 문서는 열린 채 남지 않는다
  await page.locator('.net-row').last().click();
  await expectReplayedPage(page);
}

/** 재생 iframe에 녹화한 페이지가 그려져 있고, 그 문서의 로딩이 끝났는지 */
async function expectReplayedPage(page: Page) {
  const replay = page.frameLocator('#player iframe');
  await expect(replay.locator('h1')).toHaveText('Fixture app');
  await expect.poll(() => page.evaluate(() => document.querySelector('iframe')!.contentDocument!.readyState)).toBe('complete');
  expect(await page.evaluate(() => document.readyState)).toBe('complete');
}

test.beforeEach(async ({ page }) => {
  await page.request.post('/__reset');
});

test('녹화 → 로컬 ZIP 저장: rr.json·표준 HAR·환경 정보·리포트가 담기고, 리포트가 재생된다', async ({ page, context }) => {
  const dialogs = collectDialogs(page);
  await start(page);
  await useApp(page);

  const downloadPromise = page.waitForEvent('download');
  await clickSave(page, 'checkout button does nothing');
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^qa-report-.*\.zip$/);
  await expect(progressBar(page)).toHaveCount(0);
  expect(dialogs).toEqual([]);

  const files = await readZip(download);
  expect(Object.keys(files)).toHaveLength(4);

  const events = JSON.parse(pick(files, /\.rr\.json$/)) as { type: number; data?: { source?: number; text?: string } }[];
  expect(events.some((e) => e.type === 2)).toBe(true); // FullSnapshot
  expect(events.some((e) => e.type === 3 && e.data?.source === 5 && e.data.text === 'typed by e2e')).toBe(true); // 입력

  const harText = pick(files, /\.har$/);
  const har = JSON.parse(harText) as HarJson;
  expect(harProblems(har)).toEqual([]);
  expect(har.log.creator.name).toBe('qa-recorder');
  const summary = har.log.entries.map((e) => `${e.request.method} ${new URL(e.request.url).pathname} ${e.response.status}`);
  expect(summary).toEqual(['GET /api/items 200', 'POST /api/echo 200', 'GET /api/missing 404']);
  expect(har.log.entries[0].request.url).toContain('token=%5BMASKED%5D');
  expect(harText).not.toContain('page-secret');
  // 요청 본문의 민감 키는 가린다 (응답이 문자열 값 안에 되돌려 준 원문은 maskKeys가 다루지 않는 범위 — README 참고)
  expect(har.log.entries[1].request.postData?.text).toBe('{"hello":"world","password":"[MASKED]"}');

  const env = JSON.parse(pick(files, /qa-env-.*\.json$/)) as { url: string; userAgent: string };
  expect(env.userAgent).toBe(await page.evaluate(() => navigator.userAgent)); // 이 브라우저의 user agent
  const report = pick(files, /qa-report-.*\.html$/);
  expect(report).toContain('checkout button does nothing');

  // 다운로드한 리포트를 열어 확인 (CDN 스크립트는 npm 파일로 대신 응답, SRI 검증은 그대로)
  await serveRrwebFromNpm(context);
  const viewer = await context.newPage();
  await expectWorkingReport(viewer, () => viewer.setContent(report, { waitUntil: 'load' }), 3);
  await expect(viewer.locator('.con-row')).toHaveCount(1);

  // 녹화는 멈추지 않았고, 다음 저장에는 저장 후의 기록만 들어간다
  await expect(recorderButton(page)).toHaveAttribute('title', 'Stop and save recording');
  await page.click('#missing');
  await expect(page.locator('#out')).toContainText('missing 404');
  const second = page.waitForEvent('download');
  await clickSave(page);
  const secondHar = JSON.parse(pick(await readZip(await second), /\.har$/)) as HarJson;
  expect(secondHar.log.entries.map((e) => new URL(e.request.url).pathname)).toEqual(['/api/missing']);
});

test('리포트는 rrweb 스크립트의 integrity가 맞지 않으면 재생기를 쓰지 않는다 (SRI 유지)', async ({ page, context }) => {
  await start(page);
  await page.click('#load');
  const downloadPromise = page.waitForEvent('download');
  await clickSave(page);
  const report = pick(await readZip(await downloadPromise), /qa-report-.*\.html$/);

  await serveRrwebFromNpm(context, 'window.rrweb = { Replayer: function () {} };');
  const viewer = await context.newPage();
  await viewer.setContent(report, { waitUntil: 'load' });
  await expect(viewer.locator('.player-unavailable')).toContainText('Session replay is unavailable');
  await expect(viewer.locator('.net-row')).toHaveCount(1); // 네트워크 패널은 그대로 동작
});

test('원격 업로드 성공: 공유 링크를 보여 주고, 서버가 받은 HAR·세션·콘솔·리포트가 올바르다', async ({ page, context }) => {
  const dialogs = collectDialogs(page);
  await start(page, { endpoint: '/upload?mode=ok' });
  await useApp(page);

  await clickSave(page, 'upload memo');
  await expect(sharePanel(page)).toBeVisible();
  await expect(sharePanel(page)).toContainText('/uploads/1/report');
  await expect(progressBar(page)).toHaveCount(0);
  expect(dialogs).toEqual([]);

  const { uploads } = await serverState(page);
  expect(uploads).toHaveLength(1);
  const { fields } = uploads[0];
  expect(Object.keys(fields).sort()).toEqual(['console', 'env', 'har', 'memo', 'report', 'session']);
  expect(fields.memo.text).toBe('upload memo');
  expect(fields.har.filename).toMatch(/\.har$/);
  const har = JSON.parse(fields.har.text) as HarJson;
  expect(harProblems(har)).toEqual([]);
  // 녹화기 자신의 업로드 요청은 HAR에 들어가지 않는다
  expect(har.log.entries.map((e) => new URL(e.request.url).pathname)).toEqual(['/api/items', '/api/echo', '/api/missing']);
  expect(JSON.parse(fields.console.text)).toHaveLength(1);

  await serveRrwebFromNpm(context);
  const viewer = await context.newPage();
  await expectWorkingReport(viewer, () => viewer.goto('/uploads/1/report', { waitUntil: 'load' }), 3);
});

test('느린 업로드 중에도 녹화가 이어지고, 업로드 중의 기록은 다음 저장에 중복 없이 들어간다', async ({ page }) => {
  const dialogs = collectDialogs(page);
  await start(page, { endpoint: '/upload?mode=slow&delay=2500' });
  await page.click('#load');
  await expect(page.locator('#out')).toContainText('items 200');

  await clickSave(page);
  await expect(progressBar(page)).toBeVisible();
  // 업로드 응답을 기다리는 동안 앱을 계속 사용한다
  await page.click('#missing');
  await expect(page.locator('#out')).toContainText('missing 404');
  await page.fill('#note', 'typed while uploading');
  await expect(progressBar(page)).toBeVisible();

  await expect(sharePanel(page)).toBeVisible({ timeout: 15_000 });
  expect(dialogs).toEqual([]);

  // 두 번째 저장(업로드)에는 업로드 중에 기록된 것만 들어간다
  await clickSave(page);
  await expect.poll(async () => (await serverState(page)).uploads.length, { timeout: 15_000 }).toBe(2);
  const [first, second] = (await serverState(page)).uploads;
  const paths = (u: UploadRecord) => (JSON.parse(u.fields.har.text) as HarJson).log.entries.map((e) => new URL(e.request.url).pathname);
  expect(paths(first)).toEqual(['/api/items']);
  expect(paths(second)).toEqual(['/api/missing']);

  const typedIn = (u: UploadRecord) => (JSON.parse(u.fields.session.text) as { type: number; data?: { text?: string } }[])
    .some((e) => e.type === 3 && e.data?.text === 'typed while uploading');
  expect(typedIn(first)).toBe(false);
  expect(typedIn(second)).toBe(true);
  // 두 번째 세션도 FullSnapshot으로 시작해 따로 재생할 수 있다
  const secondEvents = JSON.parse(second.fields.session.text) as { type: number }[];
  expect(secondEvents.slice(0, 2).map((e) => e.type)).toEqual([4, 2]);
});

test('업로드 실패(500): 같은 데이터를 로컬 ZIP으로 대신 저장하고 안내한다', async ({ page }) => {
  const dialogs = collectDialogs(page);
  await start(page, { endpoint: '/upload?mode=error' });
  await useApp(page);

  const downloadPromise = page.waitForEvent('download');
  await clickSave(page);
  const files = await readZip(await downloadPromise);
  await expect.poll(() => dialogs.length).toBe(1);
  expect(dialogs[0]).toContain('Upload failed: Upload failed: 500');
  expect(dialogs[0]).toContain('A local ZIP was downloaded instead.');
  await expect(progressBar(page)).toHaveCount(0);
  await expect(sharePanel(page)).toHaveCount(0);

  const har = JSON.parse(pick(files, /\.har$/)) as HarJson;
  expect(harProblems(har)).toEqual([]);
  expect(har.log.entries).toHaveLength(3);
});

test('업로드 시간 초과: 요청을 끊고 업로드 실패로 다뤄 로컬 ZIP으로 저장한다', async ({ page }) => {
  const dialogs = collectDialogs(page);
  await start(page, { endpoint: '/upload?mode=hang', uploadTimeout: 1500 });
  await page.click('#load');
  await expect(page.locator('#out')).toContainText('items 200');

  const downloadPromise = page.waitForEvent('download');
  await clickSave(page);
  await expect(progressBar(page)).toBeVisible();
  await downloadPromise;
  await expect.poll(() => dialogs.length).toBe(1);
  expect(dialogs[0]).toContain('Upload failed: timed out after 1.5 s');
  await expect.poll(async () => (await serverState(page)).aborted).toBe(1);
  await expect(progressBar(page)).toHaveCount(0);
});

test('업로드 중 destroy(): 요청을 취소하고, 늦은 응답이 녹화나 UI를 되살리지 않으며 패치를 되돌린다', async ({ page }) => {
  const dialogs = collectDialogs(page);
  let downloads = 0;
  page.on('download', () => { downloads++; });
  await start(page, { endpoint: '/upload?mode=slow&delay=2000' });
  await page.click('#load');
  await expect(page.locator('#out')).toContainText('items 200');

  await clickSave(page);
  await expect(progressBar(page)).toBeVisible();
  await expect.poll(async () => (await serverState(page)).started).toBe(1);

  await page.evaluate(() => (window as unknown as { recorder: { destroy(): void } }).recorder.destroy());
  await expect(progressBar(page)).toHaveCount(0);
  await expect(recorderButton(page)).toHaveCount(0);
  await expect.poll(async () => (await serverState(page)).aborted).toBe(1);

  // 서버가 응답했을 시간이 지나도 아무것도 되살아나지 않는다
  await page.waitForTimeout(3000);
  await expect(sharePanel(page)).toHaveCount(0);
  await expect(progressBar(page)).toHaveCount(0);
  await expect(recorderButton(page)).toHaveCount(0);
  expect(dialogs).toEqual([]);
  expect(downloads).toBe(0);

  const restored = await page.evaluate(() => ({
    fetch: window.fetch === (window as unknown as { nativeFetch: typeof fetch }).nativeFetch,
    xhr: XMLHttpRequest.toString().includes('[native code]'),
    consoleError: console.error.toString().includes('[native code]'),
  }));
  expect(restored).toEqual({ fetch: true, xhr: true, consoleError: true });
});

test('확인창이 열린 상태에서 destroy() 후 다시 시작하면 새 녹화가 정상적으로 저장된다', async ({ page }) => {
  await start(page, { endpoint: '/upload?mode=ok' });
  await page.click('#load');
  await recorderButton(page).click();
  await expect(confirmModal(page)).toBeVisible();

  await page.evaluate(() => (window as unknown as { recorder: { destroy(): void } }).recorder.destroy());
  await expect(confirmModal(page)).toHaveCount(0);
  await expect(recorderButton(page)).toHaveCount(0);

  await page.evaluate(() => (window as unknown as { startRecorder: (c: unknown) => Promise<boolean> })
    .startRecorder({ endpoint: '/upload?mode=ok' }));
  await page.click('#missing');
  await expect(page.locator('#out')).toContainText('missing 404');
  await clickSave(page);
  await expect(sharePanel(page)).toBeVisible();

  const { uploads } = await serverState(page);
  expect(uploads).toHaveLength(1);
  const har = JSON.parse(uploads[0].fields.har.text) as HarJson;
  // destroy() 전의 기록은 새 녹화에 섞이지 않는다
  expect(har.log.entries.map((e) => new URL(e.request.url).pathname)).toEqual(['/api/missing']);
  expect(path.basename(uploads[0].fields.session.filename!)).toMatch(/\.rr\.json$/);
});

test('업로드 중 진행 막대의 취소 버튼을 누르면 요청을 끊고, 녹화는 이어지며 다음 저장에 그 기록이 들어간다', async ({ page }) => {
  const dialogs = collectDialogs(page);
  let downloads = 0;
  page.on('download', () => { downloads++; });
  await start(page, { endpoint: '/upload?mode=slow&delay=3000' });
  await page.click('#load');
  await expect(page.locator('#out')).toContainText('items 200');

  await clickSave(page);
  await expect(progressBar(page)).toBeVisible();
  await expect.poll(async () => (await serverState(page)).started).toBe(1);
  const cancel = page.locator('[data-qa="progress-bar"] .qa-progress-cancel');
  await expect(cancel).toHaveText('Cancel');
  await cancel.click();

  await expect(progressBar(page)).toHaveCount(0);
  await expect.poll(async () => (await serverState(page)).aborted).toBe(1);
  await page.waitForTimeout(3500); // 서버가 응답했을 시간이 지나도
  expect(downloads).toBe(0);
  expect(dialogs).toEqual([]);
  await expect(sharePanel(page)).toHaveCount(0);
  await expect(recorderButton(page)).toHaveAttribute('title', 'Stop and save recording');

  // 같은 녹화로 다시 저장하면 취소한 저장의 요청(/api/items)과 그 뒤의 요청(/api/missing)이 한 번씩 들어간다
  await page.click('#missing');
  await expect(page.locator('#out')).toContainText('missing 404');
  await clickSave(page);
  await expect(sharePanel(page)).toBeVisible({ timeout: 15_000 });
  const { uploads } = await serverState(page);
  const har = JSON.parse(uploads.at(-1)!.fields.har.text) as HarJson;
  expect(har.log.entries.map((e) => new URL(e.request.url).pathname)).toEqual(['/api/items', '/api/missing']);
});
