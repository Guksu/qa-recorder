import { test, expect, type Page, type BrowserContext, type Download } from '@playwright/test';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { unzipSync, strFromU8 } from 'fflate';
import { harProblems } from '../src/network/__tests__/harValidation';

/**
 * 실제 Chromium에서 저장 실패 복구(리플레이 보관량)와 저장 경계의 지연 응답 본문을 확인한다.
 * 응답 헤더와 본문 전송 시점은 로컬 fixture 서버(/api/stream/<id>, /__stream/<id>/push|end)로 따로 제어한다.
 */

const require = createRequire(__filename);
const RRWEB_CDN = 'https://cdn.jsdelivr.net/npm/rrweb@1.1.3/dist/rrweb.min.js';
const RRWEB_FILE = require.resolve('rrweb/dist/rrweb.min.js');

type HarEntry = {
  request: { url: string };
  comment?: string;
  _alsoInEarlierReport?: boolean;
  response: { content: { text?: string; comment?: string; size: number; _bodyStatus?: string } };
};
type Har = { log: { entries: HarEntry[] } };
type RrwebEvent = { type: number };

const recorderButton = (page: Page) => page.locator('#qa-recorder-root button');
const confirmModal = (page: Page) => page.locator('[data-qa="confirm-modal"] .qa-modal');
const progressBar = (page: Page) => page.locator('[data-qa="progress-bar"] .qa-progress-bar-wrap');

async function start(page: Page, config: Record<string, unknown>, navigate = true) {
  if (navigate) await page.goto('/');
  await page.evaluate((cfg) => (window as unknown as { startRecorder: (c: unknown) => Promise<boolean> }).startRecorder(cfg), config);
  await expect(recorderButton(page)).toBeVisible();
}

async function clickSave(page: Page) {
  await recorderButton(page).click();
  await expect(confirmModal(page)).toBeVisible();
  await confirmModal(page).locator('#confirm').click();
  await expect(confirmModal(page)).toHaveCount(0);
}

function collectDialogs(page: Page): string[] {
  const messages: string[] = [];
  page.on('dialog', (dialog) => { messages.push(dialog.message()); void dialog.accept(); });
  return messages;
}

async function readZip(download: Download): Promise<Record<string, string>> {
  const entries = unzipSync(new Uint8Array(fs.readFileSync((await download.path())!)));
  return Object.fromEntries(Object.entries(entries).map(([name, data]) => [name, strFromU8(data)]));
}
const pick = (files: Record<string, string>, pattern: RegExp) => files[Object.keys(files).find((n) => pattern.test(n))!];

/** 브라우저 안에서 지금 보관 중인 리플레이 (녹화기 내부 — 테스트 확인용) */
const replayInPage = (page: Page) => page.evaluate(() => {
  const recorder = (window as unknown as { recorder: { screenRecorder: { getEvents(): { type: number }[] } } }).recorder;
  const events = recorder.screenRecorder.getEvents();
  return { size: JSON.stringify(events).length, snapshots: events.filter((e) => e.type === 2).length };
});

async function openStream(page: Page, id: string, type = 'application/json') {
  await page.evaluate(([i, t]) => (window as unknown as { openStream: (id: string, type: string) => void }).openStream(i, t), [id, type]);
  // 응답 헤더를 보낸 뒤까지 기다린다
  await expect.poll(async () => ((await (await page.request.get('/__streams')).json()) as { open: string[] }).open).toContain(id);
}
const push = (page: Page, id: string, text: string) => page.request.post(`/__stream/${id}/push`, { data: text });
const end = (page: Page, id: string) => page.request.post(`/__stream/${id}/end`);
const received = (page: Page, id: string) =>
  page.evaluate((i) => (window as unknown as { streamed: Record<string, { chunks: string[]; done: boolean }> }).streamed[i], id);

async function serveRrwebFromNpm(context: BrowserContext) {
  await context.route(RRWEB_CDN, (route) => route.fulfill({
    status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, path: RRWEB_FILE,
  }));
}

test.beforeEach(async ({ page }) => {
  await page.request.post('/__reset');
});

test('로컬 다운로드 실패를 반복해도 리플레이 보관량과 스냅샷 수가 늘지 않고, 재시도로 저장한 리포트가 재생된다', async ({ page, context }) => {
  const dialogs = collectDialogs(page);
  await page.goto('/');
  // 분석 당시처럼 스냅샷이 약 13,000자인 정적인 페이지 (제한 20,000자)
  await page.evaluate(() => {
    const main = document.createElement('main');
    for (let i = 0; i < 120; i++) {
      const p = document.createElement('p');
      p.textContent = `Static paragraph ${i} with some descriptive text`;
      main.appendChild(p);
    }
    document.body.appendChild(main);
  });
  await start(page, { maxReplaySize: 20_000 }, false);
  // 다운로드를 막는다 (Blob URL 생성 실패) — 로컬 저장이 실패한다
  await page.evaluate(() => {
    (window as unknown as { realCreateObjectURL: typeof URL.createObjectURL }).realCreateObjectURL = URL.createObjectURL;
    URL.createObjectURL = () => { throw new Error('download blocked'); };
  });
  const initial = await replayInPage(page);

  for (let i = 1; i <= 10; i++) {
    await clickSave(page);
    await expect.poll(() => dialogs.length).toBe(i);
    expect(dialogs[i - 1]).toContain('Save failed: download blocked');
    expect(dialogs[i - 1]).toContain('The recording was kept. Please try again.');
    const now = await replayInPage(page);
    // 실패한 저장의 스냅샷은 쌓이지 않는다. 저장할 때마다의 마우스 조작과 SDK UI 자리표시자 변경(약 1,500자)이
    // 쌓여 크기 기준 체크아웃이 한 번 일어날 수는 있다 (보관 정책상 최대 두 구간)
    expect(now.snapshots).toBeLessThanOrEqual(2);
    expect(now.size).toBeLessThan(initial.size + i * 2_500);
  }
  // 분석 당시에는 10번 실패 뒤 스냅샷 11개, 약 160,000자였다
  expect(initial.size).toBeGreaterThan(10_000);
  expect((await replayInPage(page)).size).toBeLessThan(2 * 20_000);

  await page.evaluate(() => {
    URL.createObjectURL = (window as unknown as { realCreateObjectURL: typeof URL.createObjectURL }).realCreateObjectURL;
  });
  await page.fill('#note', 'after ten failures');
  const downloadPromise = page.waitForEvent('download');
  await clickSave(page);
  const files = await readZip(await downloadPromise);
  const events = JSON.parse(pick(files, /\.rr\.json$/)) as RrwebEvent[];
  expect(events.slice(0, 2).map((e) => e.type)).toEqual([4, 2]);
  expect(events.filter((e) => e.type === 2)).toHaveLength(1);

  await serveRrwebFromNpm(context);
  const viewer = await context.newPage();
  await viewer.setContent(pick(files, /qa-report-.*\.html$/), { waitUntil: 'load' });
  await expect(viewer.frameLocator('#player iframe').locator('h1')).toHaveText('Fixture app');
});

test('헤더 도착 후 본문이 늦게 오면, 저장이 잠시 기다렸다가 다 받은 본문을 넣는다', async ({ page }) => {
  await start(page, { pendingBodyTimeout: 5_000 });
  await openStream(page, 'late');
  await push(page, 'late', '{"items":');

  const downloadPromise = page.waitForEvent('download');
  await clickSave(page);
  await expect(progressBar(page)).toBeVisible(); // 본문을 기다리는 중
  await page.waitForTimeout(300);
  await push(page, 'late', '[1,2,3]}');
  await end(page, 'late');

  const har = JSON.parse(pick(await readZip(await downloadPromise), /\.har$/)) as Har;
  expect(harProblems(har)).toEqual([]);
  const entry = har.log.entries.find((e) => e.request.url.includes('/api/stream/late'))!;
  expect(entry.response.content._bodyStatus).toBe('complete');
  expect(entry.response.content.text).toBe('{"items":[1,2,3]}');
  expect((await received(page, 'late')).done).toBe(true);
});

test('기다린 뒤에도 받는 중인 본문은 받은 부분만 이유와 함께 넣고, 다 받으면 다음 리포트에 전체 본문을 넣는다', async ({ page, context }) => {
  await start(page, { pendingBodyTimeout: 300 });
  await openStream(page, 'slow');
  await push(page, 'slow', '{"token":"SECRET","part":');

  const first = page.waitForEvent('download');
  await clickSave(page);
  const firstFiles = await readZip(await first);
  await expect(progressBar(page)).toHaveCount(0); // 첫 저장이 끝날 때까지 (저장 중의 클릭은 무시된다)
  const firstHar = JSON.parse(pick(firstFiles, /\.har$/)) as Har;
  expect(harProblems(firstHar)).toEqual([]);
  const pending = firstHar.log.entries.find((e) => e.request.url.includes('/api/stream/slow'))!;
  expect(pending.response.content._bodyStatus).toBe('pending');
  expect(pending.response.content.text).toBe('{"token":"[MASKED]","part":');
  expect(pending.response.content.comment).toMatch(/still being received/);
  expect(JSON.stringify(firstHar)).not.toContain('SECRET');

  // 첫 리포트의 뷰어도 이유를 보여 준다
  await serveRrwebFromNpm(context);
  const viewer = await context.newPage();
  await viewer.setContent(pick(firstFiles, /qa-report-.*\.html$/), { waitUntil: 'load' });
  await viewer.locator('.net-row', { hasText: 'slow' }).click();
  await viewer.locator('.detail-tab[data-pane="pane-response"]').click();
  await expect(viewer.locator('#pane-response .body-note')).toContainText('still being received');

  await page.bringToFront(); // 녹화하는 페이지로 돌아간다
  await push(page, 'slow', '42}');
  await end(page, 'slow');
  await expect.poll(async () => (await received(page, 'slow')).done).toBe(true);

  const second = page.waitForEvent('download');
  await clickSave(page);
  const secondHar = JSON.parse(pick(await readZip(await second), /\.har$/)) as Har;
  const complete = secondHar.log.entries.find((e) => e.request.url.includes('/api/stream/slow'))!;
  expect(complete.response.content._bodyStatus).toBe('complete');
  expect(complete.response.content.text).toBe('{"token":"[MASKED]","part":42}');
  expect(complete._alsoInEarlierReport).toBe(true);
  expect(complete.comment).toMatch(/Also included in an earlier report/);
});

test('끝나지 않는 SSE 스트림이 있어도 저장이 오래 걸리지 않고, 앱은 계속 이벤트를 받는다', async ({ page }) => {
  await start(page, { pendingBodyTimeout: 500 });
  await openStream(page, 'sse', 'text/event-stream');
  await push(page, 'sse', 'data: one\n\n');
  await expect.poll(async () => (await received(page, 'sse')).chunks.join('')).toBe('data: one\n\n');

  const startedAt = Date.now();
  const download = page.waitForEvent('download');
  await clickSave(page);
  const har = JSON.parse(pick(await readZip(await download), /\.har$/)) as Har;
  expect(Date.now() - startedAt).toBeLessThan(5_000);
  const entry = har.log.entries.find((e) => e.request.url.includes('/api/stream/sse'))!;
  expect(entry.response.content._bodyStatus).toBe('pending');
  expect(entry.response.content.text).toBe('data: one\n\n');

  await push(page, 'sse', 'data: two\n\n');
  await expect.poll(async () => (await received(page, 'sse')).chunks.join('')).toBe('data: one\n\ndata: two\n\n');
  await end(page, 'sse');
});

test('본문을 기다리는 중에 destroy()하면 저장하지 않고, 앱은 본문을 그대로 받으며 다시 시작한 녹화에 섞이지 않는다', async ({ page }) => {
  const dialogs = collectDialogs(page);
  let downloads = 0;
  page.on('download', () => { downloads++; });
  await start(page, { pendingBodyTimeout: 10_000 });
  await openStream(page, 'gone');
  await push(page, 'gone', '{"a":');

  await clickSave(page);
  await expect(progressBar(page)).toBeVisible();
  await page.evaluate(() => (window as unknown as { recorder: { destroy(): void } }).recorder.destroy());
  await expect(progressBar(page)).toHaveCount(0);

  await page.evaluate(() => (window as unknown as { startRecorder: (c: unknown) => Promise<boolean> }).startRecorder({}));
  await push(page, 'gone', '1}');
  await end(page, 'gone');
  await expect.poll(async () => (await received(page, 'gone')).chunks.join('')).toBe('{"a":1}');

  const entries = await page.evaluate(() =>
    (window as unknown as { recorder: { getNetworkEntries(): { request: { url: string } }[] } }).recorder.getNetworkEntries()
      .map((e) => e.request.url));
  expect(entries.some((u) => u.includes('/api/stream/gone'))).toBe(false);
  expect(downloads).toBe(0);
  expect(dialogs).toEqual([]);
});

test('앱이 열린 스트림을 reader.cancel()하면 연결이 닫히고, 받은 부분은 cancelled로 리포트에 남는다', async ({ page }) => {
  await start(page, { pendingBodyTimeout: 300 });
  // 앱: 스트림을 열고 첫 이벤트를 읽은 뒤 취소한다 (fetch 기반 SSE 클라이언트가 피드를 닫을 때처럼)
  await page.evaluate(() => {
    const w = window as unknown as { cancelled?: number };
    fetch('/api/stream/feed?type=text%2Fevent-stream').then(async (res) => {
      const reader = res.body!.getReader();
      await reader.read();
      await reader.cancel('feed closed');
      w.cancelled = Date.now();
    });
  });
  await expect.poll(async () => ((await (await page.request.get('/__streams')).json()) as { open: string[] }).open).toContain('feed');
  await push(page, 'feed', 'data: first\n\n');
  await expect.poll(() => page.evaluate(() => (window as unknown as { cancelled?: number }).cancelled)).toBeTruthy();

  // 녹화 중이어도 서버 쪽 연결이 닫힌다 (녹화기 사본 때문에 열려 있지 않다)
  await expect.poll(async () => ((await (await page.request.get('/__streams')).json()) as { open: string[] }).open, { timeout: 5_000 })
    .not.toContain('feed');

  const download = page.waitForEvent('download');
  await clickSave(page);
  const har = JSON.parse(pick(await readZip(await download), /\.har$/)) as Har;
  expect(harProblems(har)).toEqual([]);
  const entry = har.log.entries.find((e) => e.request.url.includes('/api/stream/feed'))!;
  expect(entry.response.content._bodyStatus).toBe('cancelled');
  expect(entry.response.content.text).toBe('data: first\n\n');
  expect(entry.response.content.comment).toMatch(/app cancelled the response body/);
});

test('녹화 중에도 앱은 응답 본문을 BYOB reader와 pipeThrough로 그대로 읽는다', async ({ page }) => {
  await start(page, {});
  const result = await page.evaluate(async () => {
    const byob = (await fetch('/api/items')).body!.getReader({ mode: 'byob' });
    let bytes = 0;
    for (;;) {
      const { done, value } = await byob.read(new Uint8Array(8));
      if (done) break;
      bytes += value!.byteLength;
    }
    const piped = (await fetch('/api/items')).body!.pipeThrough(new TextDecoderStream());
    let text = '';
    for (const reader = piped.getReader(); ;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += value;
    }
    return { bytes, text };
  });
  expect(result.bytes).toBe(JSON.stringify({ items: [{ id: 1, name: 'apple' }, { id: 2, name: 'pear' }] }).length);
  expect(JSON.parse(result.text).items).toHaveLength(2);
});
