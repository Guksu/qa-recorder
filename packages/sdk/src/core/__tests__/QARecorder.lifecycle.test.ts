import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { QARecorder } from '../QARecorder.js';
import type { ScreenRecorder } from '../../recorder/ScreenRecorder.js';
import type { NetworkCapture } from '../../network/NetworkCapture.js';
import type { ConsoleCapture } from '../../console/ConsoleCapture.js';
import type { HAREntry } from '../../types/har.js';

/**
 * destroy()와 다시 init()에 대한 회귀 테스트.
 * 분석 당시 재현: 원격 업로드 시작 → 응답 대기 → destroy() → 업로드 응답 완료 → 녹화 재시작·공유 UI 표시.
 * 확인창·업로드·로컬 저장은 실제 구현을 쓰고, 네트워크(fetch)와 rrweb만 대체한다.
 */

const mocks = vi.hoisted(() => ({
  record: vi.fn(),
  takeFullSnapshot: vi.fn(),
  stopFns: [] as ReturnType<typeof vi.fn>[],
}));

vi.mock('rrweb', () => ({
  record: Object.assign(mocks.record, { takeFullSnapshot: mocks.takeFullSnapshot }),
}));

const endpoint = 'https://qa.example.com/upload';
const SNAPSHOT = { type: 2, data: {}, timestamp: 1000 };

type Internals = {
  screenRecorder: ScreenRecorder;
  networkCapture: NetworkCapture;
  consoleCapture: ConsoleCapture;
  activeSave: object | null;
};
const internalsOf = (recorder: QARecorder) => recorder as unknown as Internals;
const lastEmit = () =>
  (mocks.record.mock.lastCall![0] as { emit: (event: unknown, isCheckout?: boolean) => void }).emit;

const query = (qa: string) => document.querySelector(`[data-qa="${qa}"]`);
const confirmModal = () => query('confirm-modal');
const progressBar = () => query('progress-bar');
const sharePanel = () => query('share-panel');
const floatingButton = () => document.getElementById('qa-recorder-root')?.shadowRoot?.querySelector('button') ?? null;

/** 실제 ConfirmModal의 저장 버튼을 누른다 */
function confirmSave(memo = '') {
  const shadow = confirmModal()!.shadowRoot!;
  shadow.querySelector<HTMLTextAreaElement>('#qa-memo')!.value = memo;
  shadow.querySelector<HTMLButtonElement>('#confirm')!.click();
}

/** fetch 요청 중 업로드만 원하는 시점에 끝낼 수 있게 붙잡아 둔다. 신호로 취소되면 실제 fetch처럼 AbortError로 끝난다 */
interface PendingUpload {
  signal: AbortSignal;
  respond: (body: unknown, status?: number) => void;
  fail: (err: Error) => void;
}
let uploads: PendingUpload[];
let downloads: string[];

const nativeFetch = window.fetch;
const nativeXHR = window.XMLHttpRequest;
const nativeConsoleError = console.error;
const nativeConsoleWarn = console.warn;

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '';
  uploads = [];
  downloads = [];
  mocks.record.mockImplementation(({ emit }: { emit: (event: unknown) => void }) => {
    emit({ ...SNAPSHOT });
    const stop = vi.fn();
    mocks.stopFns.push(stop);
    return stop;
  });
  mocks.takeFullSnapshot.mockImplementation((isCheckout?: boolean) => {
    const emit = lastEmit();
    emit({ type: 4, data: {}, timestamp: 2000 }, isCheckout);
    emit({ type: 2, data: { checkout: true }, timestamp: 2000 });
  });
  window.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url !== endpoint) return Promise.resolve(new Response('{}', { status: 200 }));
    return new Promise<Response>((resolve, reject) => {
      const signal = init!.signal!;
      const abort = () => reject(new DOMException('The operation was aborted.', 'AbortError'));
      if (signal.aborted) abort();
      signal.addEventListener('abort', abort);
      uploads.push({
        signal,
        respond: (body, status = 200) => resolve(new Response(JSON.stringify(body), { status })),
        fail: reject,
      });
    });
  }) as typeof fetch;
  // 로컬 ZIP 다운로드: <a download>.click()을 기록한다
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push(this.download);
  });
  // Blob URL만 대체하고, 실제 URL 파싱이 필요한 곳(NetworkCapture)을 위해 생성자는 원래 것을 쓴다
  vi.stubGlobal('URL', new Proxy(globalThis.URL, {
    get(target, prop) {
      if (prop === 'createObjectURL') return () => 'blob:mock';
      if (prop === 'revokeObjectURL') return () => {};
      return Reflect.get(target, prop);
    },
  }));
});

afterEach(() => {
  QARecorder.getInstance()?.destroy();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.fetch = nativeFetch;
  window.XMLHttpRequest = nativeXHR;
  console.error = nativeConsoleError;
  console.warn = nativeConsoleWarn;
});

async function startUpload(recorder: QARecorder): Promise<PendingUpload> {
  const count = uploads.length;
  floatingButton()!.click();
  confirmSave('memo');
  await vi.waitFor(() => expect(uploads).toHaveLength(count + 1));
  expect(progressBar()).not.toBeNull();
  void recorder;
  return uploads[count];
}

/** 대기 중인 마이크로태스크와 짧은 타이머(ZIP 저장의 setTimeout 등)를 흘려보낸다 */
const flush = () => new Promise((r) => setTimeout(r, 400));

describe('destroy() 중 진행 중인 저장', () => {
  it('업로드 응답 대기 중 destroy()하면, 늦게 도착한 성공 응답이 녹화를 재시작하거나 공유 UI를 띄우지 않는다', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const recorder = new QARecorder({ endpoint });
    await recorder.init();
    const upload = await startUpload(recorder);

    recorder.destroy();
    expect(upload.signal.aborted).toBe(true); // 업로드 요청을 취소한다
    expect(progressBar()).toBeNull();
    expect(floatingButton()).toBeNull();

    // 서버가 취소를 무시하고 응답을 보내도(또는 이미 보낸 응답이 늦게 처리돼도) 아무 일도 일어나지 않는다
    upload.respond({ url: 'https://qa.example.com/share/1' });
    await flush();

    expect(mocks.record).toHaveBeenCalledOnce();
    expect(mocks.stopFns[0]).toHaveBeenCalledOnce();
    expect(sharePanel()).toBeNull();
    expect(progressBar()).toBeNull();
    expect(alertSpy).not.toHaveBeenCalled();
    expect(downloads).toEqual([]);
  });

  it('destroy()로 취소된 업로드는 실패로 다루지 않는다 — 로컬 ZIP 대체 저장도 안내도 없다', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const recorder = new QARecorder({ endpoint });
    await recorder.init();
    await startUpload(recorder);

    recorder.destroy(); // fetch가 AbortError로 끝난다
    await flush();

    expect(downloads).toEqual([]);
    expect(alertSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('업로드 시간 초과는 업로드 실패로 다뤄 같은 데이터를 로컬 ZIP으로 저장하고 기록을 비운다', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const recorder = new QARecorder({ endpoint, uploadTimeout: 50 });
    await recorder.init();
    const upload = await startUpload(recorder);

    // 대체 저장은 실제 fflate 압축을 쓰므로 Node의 worker 시작 시간만큼 기다린다
    await vi.waitFor(() => expect(alertSpy).toHaveBeenCalled(), { timeout: 10_000 });
    expect(upload.signal.aborted).toBe(true);
    expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining('Upload failed: timed out after 50 ms'));
    expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining('A local ZIP was downloaded instead.'));
    expect(downloads).toHaveLength(1);
    expect(downloads[0]).toMatch(/^qa-report-.*\.zip$/);
    expect(progressBar()).toBeNull();
    expect(mocks.record).toHaveBeenCalledOnce(); // 녹화는 계속된다
    recorder.destroy();
  });

  it('확인창이 열린 상태에서 destroy()하면 확인창을 닫고 저장하지 않으며, 다시 init()해 저장할 수 있다', async () => {
    const recorder = new QARecorder({ endpoint });
    await recorder.init();
    floatingButton()!.click();
    expect(confirmModal()).not.toBeNull();

    recorder.destroy();
    expect(confirmModal()).toBeNull();
    await flush();
    expect(uploads).toHaveLength(0);
    expect(progressBar()).toBeNull();

    // 같은 인스턴스를 다시 시작하면 저장 흐름이 막혀 있지 않다
    await recorder.init();
    expect(internalsOf(recorder).activeSave).toBeNull();
    const upload = await startUpload(recorder);
    upload.respond({ url: 'https://qa.example.com/share/2' });
    await vi.waitFor(() => expect(sharePanel()).not.toBeNull());
    recorder.destroy();
    expect(sharePanel()).toBeNull(); // 이 인스턴스가 띄운 공유 패널도 정리한다
  });

  it('destroy() 후 같은 인스턴스를 다시 init()하면, 이전 업로드의 늦은 완료가 새 녹화의 기록과 UI를 바꾸지 않는다', async () => {
    const recorder = new QARecorder({ endpoint });
    await recorder.init();
    const oldUpload = await startUpload(recorder);
    recorder.destroy();

    await recorder.init();
    lastEmit()({ type: 3, data: { fresh: true }, timestamp: 3000 });
    internalsOf(recorder).networkCapture.restoreEntries([
      { request: { url: 'https://app.example.com/fresh' } } as unknown as HAREntry,
    ]);
    const freshEvents = internalsOf(recorder).screenRecorder.getEvents();

    oldUpload.respond({ url: 'https://qa.example.com/share/old' });
    await flush();

    expect(sharePanel()).toBeNull();
    expect(internalsOf(recorder).screenRecorder.getEvents()).toEqual(freshEvents);
    expect(internalsOf(recorder).networkCapture.snapshot().map((e) => e.request.url))
      .toEqual(['https://app.example.com/fresh']);
    expect(floatingButton()).not.toBeNull();
    recorder.destroy();
  });

  it('이전 인스턴스의 늦은 완료가 새 인스턴스의 진행 막대를 닫거나 공유 패널을 띄우지 않는다', async () => {
    const first = new QARecorder({ endpoint });
    await first.init();
    const firstUpload = await startUpload(first);
    first.destroy();

    const second = new QARecorder({ endpoint });
    await second.init();
    const secondUpload = await startUpload(second);
    expect(progressBar()).not.toBeNull();

    firstUpload.respond({ url: 'https://qa.example.com/share/first' });
    await flush();
    expect(progressBar()).not.toBeNull(); // 새 인스턴스의 업로드는 아직 진행 중
    expect(sharePanel()).toBeNull();

    secondUpload.respond({ url: 'https://qa.example.com/share/second' });
    await vi.waitFor(() => expect(sharePanel()).not.toBeNull());
    expect(sharePanel()!.shadowRoot!.textContent).toContain('share/second');
    expect(progressBar()).toBeNull();
    second.destroy();
  });

  it('로컬 ZIP 저장 중 destroy()하면 다운로드하지 않는다', async () => {
    // 저장은 진행 막대를 그린 다음 프레임까지 양보한다 — 그 사이에 destroy()한다
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.push(cb); return frames.length; });
    const recorder = new QARecorder();
    await recorder.init();
    floatingButton()!.click();
    confirmSave();
    await vi.waitFor(() => expect(frames).toHaveLength(1));
    expect(progressBar()).not.toBeNull();

    recorder.destroy();
    frames[0](performance.now());
    await flush();

    expect(downloads).toEqual([]);
    expect(progressBar()).toBeNull();
    expect(mocks.record).toHaveBeenCalledOnce();
  });
});

describe('destroy() 정리', () => {
  it('fetch·XHR·console 패치와 window 리스너를 모두 원래대로 되돌린다', async () => {
    const appFetch = window.fetch;
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const recorder = new QARecorder({ enableBackup: true });
    await recorder.init();
    expect(window.fetch).not.toBe(appFetch);
    expect(window.XMLHttpRequest).not.toBe(nativeXHR);
    expect(console.error).not.toBe(nativeConsoleError);

    recorder.destroy();

    expect(window.fetch).toBe(appFetch);
    expect(window.XMLHttpRequest).toBe(nativeXHR);
    expect(console.error).toBe(nativeConsoleError);
    expect(console.warn).toBe(nativeConsoleWarn);
    const added = addSpy.mock.calls.map(([type, fn]) => `${type}:${String(fn)}`);
    const removed = removeSpy.mock.calls.map(([type, fn]) => `${type}:${String(fn)}`);
    for (const type of ['pagehide', 'error', 'unhandledrejection']) {
      expect(added.filter((a) => a.startsWith(`${type}:`)).length).toBe(1);
      expect(removed.filter((r) => r.startsWith(`${type}:`)).length).toBe(1);
    }
  });

  it('destroy() 후에 끝난 앱 요청과 콘솔 출력은 다시 init()한 녹화에 들어가지 않는다', async () => {
    let finishApp!: (r: Response) => void;
    const appFetch = vi.fn(() => new Promise<Response>((r) => { finishApp = r; }));
    window.fetch = appFetch as unknown as typeof fetch;
    const recorder = new QARecorder();
    await recorder.init();
    const pending = window.fetch('https://app.example.com/slow');

    recorder.destroy();
    await recorder.init();
    finishApp(new Response('{}', { status: 200 }));
    await pending;
    await flush();

    expect(internalsOf(recorder).networkCapture.snapshot()).toEqual([]);
    recorder.destroy();
    expect(window.fetch).toBe(appFetch);
  });

  it('녹화기 위에 다른 코드가 fetch를 감쌌으면 destroy()가 그 패치를 지우지 않는다', async () => {
    const recorder = new QARecorder();
    await recorder.init();
    const recorderFetch = window.fetch;
    const outer = vi.fn((...args: Parameters<typeof fetch>) => recorderFetch(...args)) as unknown as typeof fetch;
    window.fetch = outer;

    recorder.destroy();
    expect(window.fetch).toBe(outer);
    // 남은 녹화기 패치는 원본으로 그대로 넘기기만 한다
    await expect(window.fetch('https://app.example.com/x')).resolves.toBeInstanceOf(Response);
  });

  it('setup() 싱글톤을 destroy()한 뒤 setup()하면 새 인스턴스가 시작되고 이전 저장의 영향을 받지 않는다', async () => {
    QARecorder.setup({ endpoint });
    const first = QARecorder.getInstance()!;
    await vi.waitFor(() => expect(floatingButton()).not.toBeNull());
    const upload = await startUpload(first);
    first.destroy();
    expect(QARecorder.getInstance()).toBeNull();

    QARecorder.setup({ endpoint });
    const second = QARecorder.getInstance()!;
    expect(second).not.toBe(first);
    upload.respond({ url: 'https://qa.example.com/share/1' });
    await flush();
    expect(sharePanel()).toBeNull();
    expect(floatingButton()).not.toBeNull();
  });
});
