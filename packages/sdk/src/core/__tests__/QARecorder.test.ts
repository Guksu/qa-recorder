import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { QARecorder } from '../QARecorder.js';
import type { HAREntry } from '@qa-recorder/shared';
import type { ScreenRecorder } from '../../recorder/ScreenRecorder.js';
import type { NetworkCapture } from '../../network/NetworkCapture.js';
import type { ConsoleCapture } from '../../console/ConsoleCapture.js';

const mocks = vi.hoisted(() => ({
  stopFn: vi.fn(),
  record: vi.fn(),
  takeFullSnapshot: vi.fn(),
  confirmModalShow: vi.fn(),
  localStorageSave: vi.fn(),
  remoteDeliverySend: vi.fn(),
}));

vi.mock('rrweb', () => ({
  record: Object.assign(mocks.record, { takeFullSnapshot: mocks.takeFullSnapshot }),
}));

vi.mock('../../ui/ConfirmModal.js', () => ({
  ConfirmModal: { show: mocks.confirmModalShow },
}));

vi.mock('../../storage/LocalStorage.js', () => ({
  LocalStorage: { save: mocks.localStorageSave },
}));

vi.mock('../../storage/RemoteDelivery.js', () => ({
  RemoteDelivery: class {
    send(...args: unknown[]) { return mocks.remoteDeliverySend(...args); }
  },
}));

const sessionStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: () => { store = {}; },
  };
})();

/** beforeEach에서 stub되기 전의 실제 URL 생성자 */
const RealURL = globalThis.URL;

/** record() mock이 (재)시작될 때마다 emit하는 FullSnapshot */
const START_SNAPSHOT = { type: 2, data: {}, timestamp: 1000 };

const isProgressVisible = () => document.querySelector('[data-qa="progress-bar"]') !== null;

const internalsOf = (recorder: QARecorder) => recorder as unknown as {
  screenRecorder: ScreenRecorder;
  networkCapture: NetworkCapture;
  consoleCapture: ConsoleCapture;
};

/** 내부 버퍼 상태 조회 (rrweb 이벤트 / 네트워크 / 콘솔) */
function buffersOf(recorder: QARecorder) {
  const { screenRecorder, networkCapture, consoleCapture } = internalsOf(recorder);
  return {
    events: screenRecorder.getEvents(),
    network: networkCapture.snapshot(),
    console: consoleCapture.snapshot(),
  };
}

/** 녹화 중인 각 버퍼에 식별 가능한 항목을 하나씩 추가하고 그 상태를 반환 */
function seedBuffers(recorder: QARecorder) {
  const seededEvent = { type: 3, data: { seeded: true }, timestamp: 1500 };
  const { emit } = mocks.record.mock.lastCall![0] as { emit: (event: unknown) => void };
  emit(seededEvent);
  // URL이 stub되어 있어 fetch 캡처 대신 버퍼에 직접 추가
  internalsOf(recorder).networkCapture.restoreEntries([
    { request: { url: 'https://example.com/api' } } as unknown as HAREntry,
  ]);
  // console.error 대신 잡히지 않은 에러 이벤트 경유로 캡처 (테스트 출력 오염 방지)
  window.dispatchEvent(new ErrorEvent('error', { message: 'seeded error' }));

  const seeded = buffersOf(recorder);
  expect(seeded.events).toContainEqual(seededEvent);
  expect(seeded.network).toHaveLength(1);
  expect(seeded.console).toHaveLength(1);
  return seeded;
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorageMock.clear();
  document.body.innerHTML = '';
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:mock'), revokeObjectURL: vi.fn() });
  vi.stubGlobal('sessionStorage', sessionStorageMock);
  mocks.record.mockImplementation(({ emit }: { emit: (event: unknown) => void }) => {
    emit({ ...START_SNAPSHOT });
    return mocks.stopFn;
  });
  mocks.confirmModalShow.mockResolvedValue({ confirmed: true, memo: '' });
  mocks.localStorageSave.mockResolvedValue(undefined);
  mocks.remoteDeliverySend.mockResolvedValue(undefined);
});

describe('QARecorder', () => {
  it('init()은 즉시 rrweb.record()를 호출한다', async () => {
    const recorder = new QARecorder();
    await recorder.init();
    expect(mocks.record).toHaveBeenCalledOnce();
    recorder.destroy();
  });

  it('init()은 버튼을 recording 상태로 마운트한다', async () => {
    const recorder = new QARecorder();
    await recorder.init();
    const host = document.getElementById('qa-recorder-root')!;
    const btn = host.shadowRoot!.querySelector('button')!;
    expect(btn.title).toBe('Stop and save recording');
    recorder.destroy();
  });

  it('rrweb 프라이버시 옵션을 record()에 전달한다', async () => {
    const recorder = new QARecorder({ maskAllInputs: true, blockSelector: '.private' });
    await recorder.init();
    expect(mocks.record).toHaveBeenCalledWith(expect.objectContaining({
      maskInputOptions: expect.objectContaining({ input: true, text: true }),
      blockSelector: '.private',
    }));
    recorder.destroy();
  });

  describe('페이지 URL 마스킹 (rrweb Meta 이벤트 href)', () => {
    const SECRET_HREF = 'https://app.example.com/reset?token=RESET-SECRET#access_token=AT-SECRET&token_type=bearer';

    beforeEach(() => {
      mocks.record.mockImplementation(({ emit }: { emit: (event: unknown) => void }) => {
        emit({ type: 4, data: { href: SECRET_HREF, width: 1280, height: 720 }, timestamp: 1000 });
        emit({ type: 2, data: {}, timestamp: 1000 });
        return mocks.stopFn;
      });
    });

    /** 플로팅 버튼으로 저장하고 LocalStorage.save()에 전달된 rrweb 이벤트(rr.json·HTML 리포트의 원본)를 반환 */
    async function saveAndGetEvents(recorder: QARecorder): Promise<{ type: number; data: { href?: string } }[]> {
      await recorder.init();
      document.getElementById('qa-recorder-root')!.shadowRoot!.querySelector('button')!.click();
      await vi.waitFor(() => expect(mocks.localStorageSave).toHaveBeenCalledOnce());
      return mocks.localStorageSave.mock.calls[0]![0];
    }

    it('기본 설정(maskKeys 기본 목록)에서 저장되는 페이지 URL의 토큰을 가린다', async () => {
      const recorder = new QARecorder();
      const events = await saveAndGetEvents(recorder);
      expect(events[0]!.data.href)
        .toBe('https://app.example.com/reset?token=[MASKED]#access_token=[MASKED]&token_type=bearer');
      recorder.destroy();
    });

    it('maskKeys: []이면 페이지 URL을 그대로 저장한다', async () => {
      const recorder = new QARecorder({ maskKeys: [] });
      const events = await saveAndGetEvents(recorder);
      expect(events[0]!.data.href).toBe(SECRET_HREF);
      recorder.destroy();
    });
  });

  it('기본 설정에서 fetch 요청 body의 민감 키가 마스킹되어 기록된다', async () => {
    vi.unstubAllGlobals(); // 요청 URL 파싱에 실제 URL이 필요 — beforeEach의 URL stub 해제
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')));
    const recorder = new QARecorder();
    await recorder.init();

    await window.fetch('https://example.com/login', {
      method: 'POST',
      body: '{"email":"a@b.com","password":"pw"}',
    });

    expect(recorder.getNetworkEntries()[0].request.postData?.text)
      .toBe('{"email":"a@b.com","password":"[MASKED]"}');
    recorder.destroy();
    vi.unstubAllGlobals();
  });

  it('버튼 클릭 시 ConfirmModal이 표시된다', async () => {
    const recorder = new QARecorder();
    await recorder.init();

    const host = document.getElementById('qa-recorder-root')!;
    host.shadowRoot!.querySelector('button')!.click();

    await vi.waitFor(() => expect(mocks.confirmModalShow).toHaveBeenCalledOnce());
    recorder.destroy();
  });

  it('확인 시 파일이 저장된다', async () => {
    const recorder = new QARecorder();
    await recorder.init();

    const host = document.getElementById('qa-recorder-root')!;
    host.shadowRoot!.querySelector('button')!.click();

    await vi.waitFor(() => expect(mocks.localStorageSave).toHaveBeenCalledOnce());
    recorder.destroy();
  });

  it('취소 시 파일이 저장되지 않는다', async () => {
    mocks.confirmModalShow.mockResolvedValue({ confirmed: false, memo: '' });
    const recorder = new QARecorder();
    await recorder.init();

    const host = document.getElementById('qa-recorder-root')!;
    host.shadowRoot!.querySelector('button')!.click();

    await vi.waitFor(() => expect(mocks.confirmModalShow).toHaveBeenCalledOnce());
    expect(mocks.localStorageSave).not.toHaveBeenCalled();
    recorder.destroy();
  });

  it('저장 후 자동으로 녹화가 재시작된다', async () => {
    const recorder = new QARecorder();
    await recorder.init();

    const host = document.getElementById('qa-recorder-root')!;
    host.shadowRoot!.querySelector('button')!.click();

    await vi.waitFor(() => expect(mocks.record).toHaveBeenCalledTimes(2));
    recorder.destroy();
  });

  it('저장 후 버튼은 여전히 recording 상태다', async () => {
    const recorder = new QARecorder();
    await recorder.init();

    const host = document.getElementById('qa-recorder-root')!;
    const btn = host.shadowRoot!.querySelector('button')!;
    btn.click();

    await vi.waitFor(() => expect(mocks.record).toHaveBeenCalledTimes(2));
    expect(btn.title).toBe('Stop and save recording');
    recorder.destroy();
  });

  it('enableBackup: false(기본값)이면 pagehide 리스너를 등록하지 않는다', async () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const recorder = new QARecorder();
    await recorder.init();

    expect(addSpy.mock.calls.some(([evt]) => evt === 'pagehide')).toBe(false);
    recorder.destroy();
    addSpy.mockRestore();
  });

  it('enableBackup: true일 때 pagehide 시 sessionStorage에 저장된다', async () => {
    const recorder = new QARecorder({ enableBackup: true });
    await recorder.init();

    window.dispatchEvent(new Event('pagehide'));

    expect(sessionStorageMock.setItem).toHaveBeenCalledWith(
      'qa-recorder-backup',
      expect.any(String),
    );
    recorder.destroy();
  });

  it('enableBackup: true일 때 init()에서 sessionStorage 백업을 복원한다', async () => {
    const backup = JSON.stringify({
      events: [{ type: 2, data: {}, timestamp: Date.now() - 1000 }],
      harEntries: [],
      consoleLogs: [],
      savedAt: new Date().toISOString(),
    });
    sessionStorageMock.getItem.mockReturnValue(backup);

    const recorder = new QARecorder({ enableBackup: true });
    await recorder.init();

    expect(sessionStorageMock.getItem).toHaveBeenCalledWith('qa-recorder-backup');
    expect(sessionStorageMock.removeItem).toHaveBeenCalledWith('qa-recorder-backup');
    recorder.destroy();
  });

  it('endpoint 설정 시 업로드 성공 후 URL이 없으면 "Upload complete." alert를 표시한다', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    mocks.remoteDeliverySend.mockResolvedValue(undefined);
    const recorder = new QARecorder({ endpoint: 'https://example.com/upload' });
    await recorder.init();

    const host = document.getElementById('qa-recorder-root')!;
    host.shadowRoot!.querySelector('button')!.click();

    await vi.waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Upload complete.'));
    recorder.destroy();
    alertSpy.mockRestore();
  });

  it('로컬 저장 실패 시에도 ProgressBar가 사라지고, 녹화를 보존한 채 이어서 녹화한다', async () => {
    let progressVisibleOnAlert: boolean | undefined;
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {
      progressVisibleOnAlert = isProgressVisible();
    });
    mocks.localStorageSave.mockRejectedValue(new Error('quota exceeded'));
    const recorder = new QARecorder({ enableBackup: true });
    await recorder.init();
    const before = seedBuffers(recorder);
    sessionStorageMock.removeItem.mockClear(); // init()의 백업 복원 시 호출분 제외

    const host = document.getElementById('qa-recorder-root')!;
    const btn = host.shadowRoot!.querySelector('button')!;
    btn.click();

    // 녹화 재개(record 2회 호출)까지 진행되어야 함
    await vi.waitFor(() => expect(mocks.record).toHaveBeenCalledTimes(2));
    expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining('quota exceeded'));
    expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining('The recording was kept'));
    expect(progressVisibleOnAlert).toBe(false); // alert(블로킹) 전에 숨김
    expect(isProgressVisible()).toBe(false);
    expect(btn.title).toBe('Stop and save recording');

    // 버퍼 보존: 기존 rrweb 이벤트 뒤에 새 녹화가 이어지고, 네트워크/콘솔은 그대로
    const after = buffersOf(recorder);
    expect(after.events).toEqual([...before.events, START_SNAPSHOT]);
    expect(after.network).toEqual(before.network);
    expect(after.console).toEqual(before.console);
    // 저장되지 않았으므로 sessionStorage 백업도 유지
    expect(sessionStorageMock.removeItem).not.toHaveBeenCalled();
    recorder.destroy();
    alertSpy.mockRestore();
  });

  it('로컬 저장 실패 후 다시 저장하면 보존된 녹화가 함께 저장되고 버퍼가 초기화된다', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    mocks.localStorageSave.mockRejectedValueOnce(new Error('quota exceeded'));
    const recorder = new QARecorder();
    await recorder.init();
    const before = seedBuffers(recorder);

    const host = document.getElementById('qa-recorder-root')!;
    const btn = host.shadowRoot!.querySelector('button')!;
    btn.click();
    await vi.waitFor(() => expect(mocks.record).toHaveBeenCalledTimes(2));

    btn.click();
    await vi.waitFor(() => expect(mocks.record).toHaveBeenCalledTimes(3));

    const [events, harLog, consoleLogs] = mocks.localStorageSave.mock.calls[1]!;
    expect(events).toEqual([...before.events, START_SNAPSHOT]);
    expect(harLog.entries).toEqual(before.network);
    expect(consoleLogs).toEqual(before.console);

    const after = buffersOf(recorder);
    expect(after.events).toEqual([START_SNAPSHOT]);
    expect(after.network).toHaveLength(0);
    expect(after.console).toHaveLength(0);
    recorder.destroy();
    alertSpy.mockRestore();
  });

  it('로컬 저장 성공 시 버퍼를 초기화하고 녹화를 새로 시작한다', async () => {
    const recorder = new QARecorder();
    await recorder.init();
    seedBuffers(recorder);

    const host = document.getElementById('qa-recorder-root')!;
    host.shadowRoot!.querySelector('button')!.click();

    await vi.waitFor(() => expect(mocks.record).toHaveBeenCalledTimes(2));
    const after = buffersOf(recorder);
    expect(after.events).toEqual([START_SNAPSHOT]);
    expect(after.network).toHaveLength(0);
    expect(after.console).toHaveLength(0);
    recorder.destroy();
  });

  describe('원격 업로드', () => {
    const endpoint = 'https://example.com/upload';

    it('업로드 성공 시 URL이 있으면 SharePanel을 표시하고, 로컬 저장 없이 버퍼를 초기화한다', async () => {
      mocks.remoteDeliverySend.mockResolvedValue('https://example.com/share/abc');
      const recorder = new QARecorder({ endpoint, enableBackup: true });
      await recorder.init();
      seedBuffers(recorder);
      sessionStorageMock.removeItem.mockClear();

      const host = document.getElementById('qa-recorder-root')!;
      host.shadowRoot!.querySelector('button')!.click();

      await vi.waitFor(() => expect(mocks.record).toHaveBeenCalledTimes(2));
      expect(document.querySelector('[data-qa="share-panel"]')).not.toBeNull();
      expect(isProgressVisible()).toBe(false);
      expect(mocks.localStorageSave).not.toHaveBeenCalled();
      expect(sessionStorageMock.removeItem).toHaveBeenCalledWith('qa-recorder-backup');
      const after = buffersOf(recorder);
      expect(after.events).toEqual([START_SNAPSHOT]);
      expect(after.network).toHaveLength(0);
      expect(after.console).toHaveLength(0);
      recorder.destroy();
    });

    it('업로드 실패 시 같은 데이터로 로컬 ZIP 저장으로 대체하고 버퍼를 초기화한다', async () => {
      let progressVisibleOnAlert: boolean | undefined;
      const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {
        progressVisibleOnAlert = isProgressVisible();
      });
      mocks.confirmModalShow.mockResolvedValue({ confirmed: true, memo: 'bug memo' });
      const recorder = new QARecorder({ endpoint, enableBackup: true });
      await recorder.init();
      const before = seedBuffers(recorder);
      sessionStorageMock.removeItem.mockClear();
      // rrweb은 stop() 후에도 throttle trailing 타이머로 이벤트를 늦게 emit할 수 있다 — 업로드 대기 중에 도착하는 경우
      const { emit } = mocks.record.mock.lastCall![0] as { emit: (event: unknown) => void };
      mocks.remoteDeliverySend.mockImplementation(async () => {
        emit({ type: 3, data: { late: true }, timestamp: 1600 });
        throw new Error('network down');
      });

      const host = document.getElementById('qa-recorder-root')!;
      host.shadowRoot!.querySelector('button')!.click();

      await vi.waitFor(() => expect(mocks.record).toHaveBeenCalledTimes(2));
      expect(mocks.localStorageSave).toHaveBeenCalledOnce();

      const [blob, uploadedHar, uploadedMemo] = mocks.remoteDeliverySend.mock.calls[0]!;
      const [events, harLog, consoleLogs, memo] = mocks.localStorageSave.mock.calls[0]!;
      expect(events).toEqual(JSON.parse(await (blob as Blob).text()));
      expect(events).toEqual(before.events);
      expect(harLog).toBe(uploadedHar);
      expect(harLog.entries).toEqual(before.network);
      expect(consoleLogs).toEqual(before.console);
      expect(memo).toBe('bug memo');
      expect(uploadedMemo).toBe('bug memo');

      expect(alertSpy).toHaveBeenCalledOnce();
      expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining('Upload failed: network down'));
      expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining('local ZIP'));
      expect(progressVisibleOnAlert).toBe(false);
      expect(isProgressVisible()).toBe(false);
      expect(sessionStorageMock.removeItem).toHaveBeenCalledWith('qa-recorder-backup');

      const after = buffersOf(recorder);
      expect(after.events).toEqual([START_SNAPSHOT]);
      expect(after.network).toHaveLength(0);
      expect(after.console).toHaveLength(0);
      recorder.destroy();
      alertSpy.mockRestore();
    });

    it('업로드와 로컬 저장이 모두 실패하면 녹화를 보존한 채 이어서 녹화한다', async () => {
      const progressVisible: Record<string, boolean> = {};
      const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {
        progressVisible.onAlert = isProgressVisible();
      });
      mocks.remoteDeliverySend.mockRejectedValue(new Error('network down'));
      mocks.localStorageSave.mockImplementation(async () => {
        progressVisible.onSave = isProgressVisible();
        throw new Error('quota exceeded');
      });
      const recorder = new QARecorder({ endpoint, enableBackup: true });
      await recorder.init();
      const before = seedBuffers(recorder);
      sessionStorageMock.removeItem.mockClear();

      const host = document.getElementById('qa-recorder-root')!;
      const btn = host.shadowRoot!.querySelector('button')!;
      btn.click();

      // 녹화 재개(record 2회 호출)까지 진행되어야 함
      await vi.waitFor(() => expect(mocks.record).toHaveBeenCalledTimes(2));
      expect(alertSpy).toHaveBeenCalledOnce();
      const message = alertSpy.mock.calls[0]![0] as string;
      expect(message).toContain('Upload failed: network down');
      expect(message).toContain('Save failed: quota exceeded');
      expect(message).toContain('The recording was kept');

      // 대체 저장 중에는 ProgressBar가 유지되고, alert 전에 사라진다
      expect(progressVisible).toEqual({ onSave: true, onAlert: false });
      expect(isProgressVisible()).toBe(false);
      expect(btn.title).toBe('Stop and save recording');

      // 버퍼 보존: 기존 rrweb 이벤트 뒤에 새 녹화가 이어지고, 네트워크/콘솔은 그대로
      const after = buffersOf(recorder);
      expect(after.events).toEqual([...before.events, START_SNAPSHOT]);
      expect(after.network).toEqual(before.network);
      expect(after.console).toEqual(before.console);
      expect(sessionStorageMock.removeItem).not.toHaveBeenCalled();
      recorder.destroy();
      alertSpy.mockRestore();
    });

    it('실패한 업로드 요청 자체는 보존된 네트워크 로그와 다음 저장에 포함되지 않는다', async () => {
      const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
      // 실제 fetch 캡처 경로를 쓰도록 URL stub을 되돌리고 실제 RemoteDelivery로 업로드한다
      vi.stubGlobal('URL', RealURL);
      const secretEndpoint = 'https://qa.example.com/upload?token=SECRET123';
      vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
        const url = input instanceof Request ? input.url : String(input);
        return url === secretEndpoint
          ? new Response('{"error":"db down"}', { status: 500 })
          : new Response('[]', { status: 200 });
      }));
      const { RemoteDelivery: RealRemoteDelivery } = await vi.importActual<
        typeof import('../../storage/RemoteDelivery.js')
      >('../../storage/RemoteDelivery.js');
      mocks.remoteDeliverySend.mockImplementation((...args: Parameters<InstanceType<typeof RealRemoteDelivery>['send']>) =>
        new RealRemoteDelivery(secretEndpoint).send(...args));
      mocks.localStorageSave.mockRejectedValueOnce(new Error('quota exceeded'));

      const recorder = new QARecorder({ endpoint: secretEndpoint });
      await recorder.init();
      await window.fetch('https://app.example.com/api/items');
      const appUrls = ['https://app.example.com/api/items'];
      expect(buffersOf(recorder).network.map((e) => e.request.url)).toEqual(appUrls);

      const host = document.getElementById('qa-recorder-root')!;
      const btn = host.shadowRoot!.querySelector('button')!;
      btn.click();
      await vi.waitFor(() => expect(mocks.record).toHaveBeenCalledTimes(2));

      // 업로드와 로컬 저장이 모두 실패해도 녹화기 자신의 업로드 요청은 버퍼에 남지 않는다
      expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining('The recording was kept'));
      expect(buffersOf(recorder).network.map((e) => e.request.url)).toEqual(appUrls);

      // 재시도 시 저장되는 HAR에도 앱 요청만 들어간다
      btn.click();
      await vi.waitFor(() => expect(mocks.record).toHaveBeenCalledTimes(3));
      const [, harLog] = mocks.localStorageSave.mock.calls[1]!;
      expect(harLog.entries.map((e: HAREntry) => e.request.url)).toEqual(appUrls);

      recorder.destroy();
      alertSpy.mockRestore();
      vi.unstubAllGlobals();
    });
  });

  it('저장 완료 후 sessionStorage 백업이 초기화된다', async () => {
    const recorder = new QARecorder({ enableBackup: true });
    await recorder.init();

    const host = document.getElementById('qa-recorder-root')!;
    host.shadowRoot!.querySelector('button')!.click();

    await vi.waitFor(() => expect(mocks.localStorageSave).toHaveBeenCalled());
    expect(sessionStorageMock.removeItem).toHaveBeenCalledWith('qa-recorder-backup');
    recorder.destroy();
  });
});

describe('QARecorder — 호스트 앱 보호', () => {
  const buttons = () => document.querySelectorAll('#qa-recorder-root');

  it('init()을 두 번 호출해도 버튼과 rrweb 녹화는 하나만 시작된다', async () => {
    const recorder = new QARecorder();
    await recorder.init();
    await recorder.init();
    expect(buttons()).toHaveLength(1);
    expect(mocks.record).toHaveBeenCalledOnce();
    recorder.destroy();
    expect(buttons()).toHaveLength(0);
  });

  it('init()을 두 번 호출해도 destroy() 후 console 메서드가 원래대로 돌아온다', async () => {
    const original = console.error;
    const recorder = new QARecorder({ consoleLevels: ['error'] });
    await recorder.init();
    await recorder.init();
    recorder.destroy();
    expect(console.error).toBe(original);
  });

  it('destroy() 후에는 init()으로 다시 시작할 수 있다', async () => {
    const recorder = new QARecorder();
    await recorder.init();
    recorder.destroy();
    await recorder.init();
    expect(buttons()).toHaveLength(1);
    expect(mocks.record).toHaveBeenCalledTimes(2);
    recorder.destroy();
  });

  it('확인창이 떠 있는 동안 버튼이 다시 눌려도 저장 흐름은 한 번만 진행된다', async () => {
    let resolveModal!: (r: { confirmed: boolean; memo: string }) => void;
    mocks.confirmModalShow.mockImplementationOnce(() => new Promise((r) => { resolveModal = r; }));
    const recorder = new QARecorder();
    await recorder.init();
    const btn = document.getElementById('qa-recorder-root')!.shadowRoot!.querySelector('button')!;

    btn.click();
    btn.click();
    expect(mocks.confirmModalShow).toHaveBeenCalledOnce();

    resolveModal({ confirmed: true, memo: '' });
    await vi.waitFor(() => expect(mocks.localStorageSave).toHaveBeenCalledOnce());
    // 저장이 끝나면 다시 저장할 수 있다
    await vi.waitFor(() => {
      btn.click();
      expect(mocks.confirmModalShow).toHaveBeenCalledTimes(2);
    });
    await vi.waitFor(() => expect(mocks.localStorageSave).toHaveBeenCalledTimes(2));
    recorder.destroy();
  });

  it('저장하는 동안 버튼이 다시 눌려도 확인창을 다시 띄우지 않는다', async () => {
    let resolveSave!: () => void;
    mocks.localStorageSave.mockImplementationOnce(() => new Promise<void>((r) => { resolveSave = r; }));
    const recorder = new QARecorder();
    await recorder.init();
    const btn = document.getElementById('qa-recorder-root')!.shadowRoot!.querySelector('button')!;

    btn.click();
    await vi.waitFor(() => expect(mocks.localStorageSave).toHaveBeenCalledOnce());
    btn.click();
    expect(mocks.confirmModalShow).toHaveBeenCalledOnce();

    resolveSave();
    await vi.waitFor(() => expect(isProgressVisible()).toBe(false));
    recorder.destroy();
  });

  it('<head>에서 body가 생기기 전에 init()해도 throw하지 않고, 파싱이 끝나면 버튼을 붙인다', async () => {
    const body = document.body;
    document.documentElement.removeChild(body);
    const recorder = new QARecorder();
    try {
      await expect(recorder.init()).resolves.toBeUndefined();
      expect(mocks.record).toHaveBeenCalledOnce();
    } finally {
      document.documentElement.appendChild(body);
    }
    expect(buttons()).toHaveLength(0);

    document.dispatchEvent(new Event('DOMContentLoaded'));
    expect(buttons()).toHaveLength(1);
    const btn = buttons()[0].shadowRoot!.querySelector('button')!;
    expect(btn.title).toBe('Stop and save recording');
    recorder.destroy();
  });
});

describe('QARecorder.setup / getInstance', () => {
  afterEach(() => {
    QARecorder.getInstance()?.destroy();
  });

  it('setup() 전에는 getInstance()가 null을 반환한다', () => {
    expect(QARecorder.getInstance()).toBeNull();
  });

  it('setup() 후 getInstance()가 QARecorder 인스턴스를 반환한다', async () => {
    QARecorder.setup();
    await vi.waitFor(() => expect(mocks.record).toHaveBeenCalledOnce());
    expect(QARecorder.getInstance()).toBeInstanceOf(QARecorder);
  });

  it('setup()을 여러 번 호출해도 init()은 한 번만 실행된다', async () => {
    QARecorder.setup();
    QARecorder.setup();
    QARecorder.setup();
    await vi.waitFor(() => expect(mocks.record).toHaveBeenCalledOnce());
    expect(mocks.record).toHaveBeenCalledOnce();
  });

  it('setup()을 여러 번 호출해도 항상 동일한 인스턴스를 반환한다', () => {
    QARecorder.setup();
    const first = QARecorder.getInstance();
    QARecorder.setup();
    const second = QARecorder.getInstance();
    expect(first).toBe(second);
  });

  it('destroy() 후 getInstance()가 null을 반환한다', async () => {
    QARecorder.setup();
    await vi.waitFor(() => expect(mocks.record).toHaveBeenCalledOnce());
    QARecorder.getInstance()!.destroy();
    expect(QARecorder.getInstance()).toBeNull();
  });

  it('destroy() 후 setup()을 다시 호출하면 새 인스턴스가 초기화된다', async () => {
    QARecorder.setup();
    await vi.waitFor(() => expect(mocks.record).toHaveBeenCalledOnce());
    QARecorder.getInstance()!.destroy();

    vi.clearAllMocks();
    document.body.innerHTML = '';
    mocks.record.mockImplementation(({ emit }: { emit: (event: unknown) => void }) => {
      emit({ type: 2, data: {}, timestamp: 1000 });
      return mocks.stopFn;
    });

    QARecorder.setup();
    await vi.waitFor(() => expect(mocks.record).toHaveBeenCalledOnce());
    expect(QARecorder.getInstance()).toBeInstanceOf(QARecorder);
  });
});

describe('QARecorder — 환경 정보와 업로드 파일', () => {
  afterEach(() => {
    window.history.replaceState({}, '', '/');
  });

  it('로컬 저장 시 maskKeys로 페이지 URL을 가린 환경 정보를 넘긴다', async () => {
    window.history.replaceState({}, '', '/reset?token=PAGE-SECRET&lang=ko');
    const recorder = new QARecorder();
    await recorder.init();
    document.getElementById('qa-recorder-root')!.shadowRoot!.querySelector('button')!.click();
    await vi.waitFor(() => expect(mocks.localStorageSave).toHaveBeenCalledOnce());

    const environment = mocks.localStorageSave.mock.calls[0]![4];
    expect(environment.url).toContain('token=[MASKED]&lang=ko');
    expect(JSON.stringify(environment)).not.toContain('PAGE-SECRET');
    expect(environment.userAgent).toBe(navigator.userAgent);
    recorder.destroy();
  });

  it('원격 업로드 시 콘솔 로그, 통합 리포트, 환경 정보를 함께 보낸다', async () => {
    mocks.remoteDeliverySend.mockResolvedValue(undefined);
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const recorder = new QARecorder({ endpoint: 'https://example.com/upload' });
    await recorder.init();
    // 콘솔 캡처 방식과 무관하게 버퍼에 직접 넣는다
    internalsOf(recorder).consoleCapture.restoreEntries([
      { timestamp: new Date().toISOString(), level: 'error', message: 'seeded for upload', _offsetMs: 0 },
    ]);
    document.getElementById('qa-recorder-root')!.shadowRoot!.querySelector('button')!.click();
    await vi.waitFor(() => expect(mocks.remoteDeliverySend).toHaveBeenCalledOnce());

    const extras = mocks.remoteDeliverySend.mock.calls[0]![3];
    expect(extras.consoleLogs.map((e: { message: string }) => e.message)).toContain('seeded for upload');
    expect(extras.reportHtml).toContain('<title>QA Report</title>');
    expect(extras.reportHtml).toContain(JSON.stringify(extras.environment.userAgent));
    expect(extras.environment.sdkVersion).toBeTruthy();
    recorder.destroy();
    alertSpy.mockRestore();
  });
});
