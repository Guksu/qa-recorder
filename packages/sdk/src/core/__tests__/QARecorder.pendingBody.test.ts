import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { QARecorder } from '../QARecorder.js';
import type { NetworkCapture } from '../../network/NetworkCapture.js';
import type { HARDocument, HAREntry } from '../../types/har.js';
import { harProblems } from '../../network/__tests__/harValidation.js';

/**
 * 저장 경계의 지연 응답 본문 회귀 테스트.
 * 분석 당시 재현: fetch 응답 헤더는 왔지만 본문이 아직 오는 중에 저장하면 HAR에 본문이 없고, 저장 성공으로
 * 요청이 버퍼에서 빠져 앱이 나중에 본문을 다 받아도 다음 저장에 남지 않았다.
 * 실제 NetworkCapture로 캡처하고, 앱의 fetch 응답은 본문 전송 시점을 직접 제어하는 스트림으로 만든다.
 */

const mocks = vi.hoisted(() => ({ save: vi.fn(), record: vi.fn() }));
vi.mock('rrweb', () => ({
  record: Object.assign(mocks.record, { takeFullSnapshot: vi.fn() }),
}));
vi.mock('../../ui/ConfirmModal.js', () => ({ ConfirmModal: { show: async () => ({ confirmed: true, memo: '' }) } }));
vi.mock('../../storage/LocalStorage.js', () => ({ LocalStorage: { save: mocks.save } }));

/** 헤더는 바로 보내고 본문은 push/end/fail로 나중에 보내는 응답 */
function delayedBody(contentType = 'application/json') {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });
  const encoder = new TextEncoder();
  return {
    response: new Response(stream, { headers: { 'content-type': contentType } }),
    push: (text: string) => controller.enqueue(encoder.encode(text)),
    end: () => controller.close(),
    fail: (err: Error) => controller.error(err),
  };
}

type Internals = { networkCapture: NetworkCapture; activeSave: object | null };
const internals = (r: QARecorder) => r as unknown as Internals;
const buffer = (r: QARecorder) => internals(r).networkCapture.snapshot();
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const button = () => document.getElementById('qa-recorder-root')!.shadowRoot!.querySelector('button')!;
const progressVisible = () => document.querySelector('[data-qa="progress-bar"]') !== null;

/** 저장 버튼을 누르고 저장 흐름이 끝날 때까지 기다린다 */
async function save(recorder: QARecorder) {
  button().click();
  await vi.waitFor(() => expect(internals(recorder).activeSave).toBeNull(), { timeout: 5_000 });
}

/** n번째 저장의 HAR (LocalStorage.save의 두 번째 인자) */
const savedHar = (n: number) => mocks.save.mock.calls[n]![1] as HARDocument;

let responses: Response[];
const nativeFetch = window.fetch;
let recorder: QARecorder | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '';
  responses = [];
  mocks.record.mockImplementation(({ emit }: { emit: (e: unknown) => void }) => {
    emit({ type: 2, data: {}, timestamp: Date.now() });
    return () => {};
  });
  mocks.save.mockResolvedValue(undefined);
  vi.spyOn(window, 'alert').mockImplementation(() => {});
});

afterEach(() => {
  recorder?.destroy();
  recorder = null;
  window.fetch = nativeFetch;
  vi.restoreAllMocks();
});

/** 녹화를 시작하고, 이후 앱의 fetch는 next()가 돌려주는 응답을 받는다 */
async function start(config: ConstructorParameters<typeof QARecorder>[0], next: () => Response) {
  window.fetch = vi.fn(async () => { const r = next(); responses.push(r); return r; }) as unknown as typeof fetch;
  recorder = new QARecorder(config);
  await recorder.init();
  return recorder;
}

describe('저장할 때 응답 본문을 아직 받는 중인 요청', () => {
  it('헤더 도착 후 본문이 늦어도, pendingBodyTimeout 안에 끝나면 그 본문을 리포트에 넣는다', async () => {
    const body = delayedBody();
    const r = await start({ pendingBodyTimeout: 2_000 }, () => body.response);
    const res = await window.fetch('https://api.example.com/slow');
    body.push('{"items":');

    button().click();
    await vi.waitFor(() => expect(progressVisible()).toBe(true)); // 본문을 기다리는 동안 진행 막대
    expect(mocks.save).not.toHaveBeenCalled();
    body.push('[1,2]}');
    body.end();
    await vi.waitFor(() => expect(internals(r).activeSave).toBeNull());

    const [entry] = savedHar(0).log.entries;
    expect(entry.response.content.text).toBe('{"items":[1,2]}');
    expect(entry.response.content._bodyStatus).toBe('complete');
    expect(entry.response.content.size).toBe(15);
    expect(buffer(r)).toEqual([]); // 다 받은 본문을 저장했으므로 버퍼에서 뺀다
    expect(await res.text()).toBe('{"items":[1,2]}'); // 앱이 받는 원본은 그대로
  });

  it('기다린 뒤에도 받는 중이면 받은 부분만 pending으로 넣고, 저장 처리 중에 본문이 끝나면 다음 리포트에 전체 본문을 한 번 더 넣는다', async () => {
    const body = delayedBody();
    const r = await start({ pendingBodyTimeout: 100 }, () => body.response);
    const res = await window.fetch('https://api.example.com/report');
    body.push('{"part":');
    // 리포트를 만든 뒤 로컬 저장(압축·다운로드) 중에 본문이 끝난다
    mocks.save.mockImplementationOnce(async () => {
      body.push('1}');
      body.end();
      await tick(10);
    });

    await save(r);

    const [first] = savedHar(0).log.entries;
    expect(first.response.content._bodyStatus).toBe('pending');
    expect(first.response.content.text).toBe('{"part":');
    expect(first.response.content.size).toBe(-1);
    expect(first.response.content.comment).toMatch(/still being received/);
    expect(harProblems(savedHar(0))).toEqual([]);

    // 저장에 성공했지만 본문을 다 받지 못했던 요청은 버퍼에 남는다
    expect(await res.text()).toBe('{"part":1}');
    expect(buffer(r)).toHaveLength(1);

    await save(r);
    const [again] = savedHar(1).log.entries;
    expect(again.response.content.text).toBe('{"part":1}');
    expect(again.response.content._bodyStatus).toBe('complete');
    expect(again._alsoInEarlierReport).toBe(true);
    expect(again.comment).toMatch(/Also included in an earlier report/);
    expect(again.startedDateTime).toBe(first.startedDateTime); // 같은 요청

    // 다 받은 본문을 저장했으므로 세 번째 리포트에는 다시 들어가지 않는다
    await save(r);
    expect(savedHar(2).log.entries).toEqual([]);
  });

  it('끝나지 않는 스트림(SSE)이 있어도 pendingBodyTimeout보다 오래 기다리지 않고, 앱의 원본 스트림은 계속 읽힌다', async () => {
    const body = delayedBody('text/event-stream');
    const r = await start({ pendingBodyTimeout: 150 }, () => body.response);
    const res = await window.fetch('https://api.example.com/events');
    const appReader = res.body!.getReader();
    body.push('data: one\n\n');
    expect(new TextDecoder().decode((await appReader.read()).value)).toBe('data: one\n\n');

    const startedAt = Date.now();
    await save(r);
    expect(Date.now() - startedAt).toBeLessThan(1_500);

    const [entry] = savedHar(0).log.entries;
    expect(entry.response.content._bodyStatus).toBe('pending');
    expect(entry.response.content.text).toBe('data: one\n\n');

    // 저장 뒤에도 앱은 스트림을 계속 받는다 (녹화기가 소비하거나 취소하지 않았다)
    body.push('data: two\n\n');
    expect(new TextDecoder().decode((await appReader.read()).value)).toBe('data: two\n\n');
    await tick(10);
    // 다음 저장에는 그때까지 받은 부분으로 다시 들어간다 (여전히 받는 중)
    await save(r);
    const [next] = savedHar(1).log.entries;
    expect(next.response.content.text).toBe('data: one\n\ndata: two\n\n');
    expect(next.response.content._bodyStatus).toBe('pending');
    // (앱이 reader.cancel()을 하면 tee 명세상 녹화기 사본도 끝나야 원본이 취소된다 — README의 남은 제한 참고)
    body.end();
    expect((await appReader.read()).done).toBe(true);
  });

  it('본문을 읽다가 실패하면 error로 남기고 이유를 HAR에 적는다', async () => {
    const body = delayedBody('text/plain');
    const r = await start({ pendingBodyTimeout: 1_000 }, () => body.response);
    const res = await window.fetch('https://api.example.com/broken');
    res.text().catch(() => {}); // 앱 쪽도 같은 오류를 받는다
    body.push('partial ');
    await tick(10);
    body.fail(new TypeError('network error while reading body'));
    await tick(10);

    await save(r);
    const [entry] = savedHar(0).log.entries;
    expect(entry.response.content._bodyStatus).toBe('error');
    expect(entry.response.content.text).toBe('partial ');
    expect(entry.response.content.comment).toMatch(/could not be read completely/);
    expect(buffer(r)).toEqual([]); // 읽기가 끝났으므로(실패) 다음 저장으로 넘기지 않는다
  });

  it('본문을 기다리는 중에 destroy()하면 저장하지 않고, 다시 init()한 녹화에는 이전 요청이 들어가지 않으며 앱의 응답은 그대로다', async () => {
    const body = delayedBody();
    const r = await start({ pendingBodyTimeout: 5_000 }, () => body.response);
    const res = await window.fetch('https://api.example.com/slow');
    body.push('{"a":');
    const old = buffer(r)[0];

    button().click();
    await vi.waitFor(() => expect(progressVisible()).toBe(true));
    r.destroy();
    await tick(10);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(progressVisible()).toBe(false);
    expect(old.response.content._bodyStatus).toBe('aborted'); // 녹화기의 사본 읽기만 취소

    await r.init();
    body.push('1}');
    body.end();
    expect(await res.text()).toBe('{"a":1}');
    await tick(10);
    expect(buffer(r)).toEqual([]);
    expect(old.response.content._bodyStatus).toBe('aborted'); // 늦게 끝난 본문이 이전 엔트리를 바꾸지 않는다
  });

  it('받는 중인 본문도 민감 키를 가리고, maxBodySize를 넘으면 잘라서 truncated로 기록한다', async () => {
    const bodies = [delayedBody(), delayedBody()];
    let i = 0;
    const r = await start({ pendingBodyTimeout: 100, maxBodySize: 40 }, () => bodies[i++].response);
    await window.fetch('https://api.example.com/a');
    await window.fetch('https://api.example.com/b');
    bodies[0].push('{"user":"kim","token":"SECRET-1');
    bodies[1].push(`{"token":"SECRET-2","pad":"${'x'.repeat(100)}"}`);
    bodies[1].end();
    await tick(10);

    await save(r);
    const har = savedHar(0);
    const text = JSON.stringify(har);
    expect(text).not.toContain('SECRET-1');
    expect(text).not.toContain('SECRET-2');
    const [pending, cut] = har.log.entries;
    expect(pending.response.content._bodyStatus).toBe('pending');
    expect(pending.response.content.text).toBe('{"user":"kim","token":"[MASKED]"'); // 미완성 JSON도 키 단위로 가린다
    expect(cut.response.content._bodyStatus).toBe('truncated');
    expect(cut.response.content.text!.length).toBeLessThanOrEqual(40);
    expect(cut.response.content.comment).toMatch(/Truncated by qa-recorder/);
    expect(harProblems(har)).toEqual([]);
  });

  it('저장에 실패하면 받는 중이던 요청도 그대로 남아 재시도에 다시 들어간다 (중복 없이)', async () => {
    const body = delayedBody();
    const r = await start({ pendingBodyTimeout: 50 }, () => body.response);
    await window.fetch('https://api.example.com/slow');
    body.push('{"x":');
    mocks.save.mockRejectedValueOnce(new Error('download blocked'));

    await save(r);
    body.push('1}');
    body.end();
    await tick(10);
    await save(r);

    const entries = savedHar(1).log.entries;
    expect(entries).toHaveLength(1);
    expect(entries[0].response.content.text).toBe('{"x":1}');
    expect(entries[0]._alsoInEarlierReport).toBeUndefined(); // 실패한 저장은 리포트가 아니다
  });
});

describe('pendingBodyTimeout: 0', () => {
  it('기다리지 않고 바로 저장한다', async () => {
    const body = delayedBody();
    const r = await start({ pendingBodyTimeout: 0 }, () => body.response);
    await window.fetch('https://api.example.com/slow');
    body.push('{"y":');
    await tick(10);
    await save(r);
    expect((savedHar(0).log.entries[0] as HAREntry).response.content._bodyStatus).toBe('pending');
  });
});
