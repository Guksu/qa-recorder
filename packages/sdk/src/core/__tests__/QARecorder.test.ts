import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { QARecorder } from '../QARecorder.js';

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

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorageMock.clear();
  document.body.innerHTML = '';
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:mock'), revokeObjectURL: vi.fn() });
  vi.stubGlobal('sessionStorage', sessionStorageMock);
  mocks.record.mockImplementation(({ emit }: { emit: (event: unknown) => void }) => {
    emit({ type: 2, data: {}, timestamp: 1000 });
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

  it('로컬 저장 실패 시에도 ProgressBar가 사라지고 녹화가 재시작된다', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    mocks.localStorageSave.mockRejectedValue(new Error('quota exceeded'));
    const recorder = new QARecorder();
    await recorder.init();

    const host = document.getElementById('qa-recorder-root')!;
    host.shadowRoot!.querySelector('button')!.click();

    // 녹화 재시작(record 2회 호출)까지 진행되어야 함
    await vi.waitFor(() => expect(mocks.record).toHaveBeenCalledTimes(2));
    expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining('quota exceeded'));
    expect(document.querySelector('[data-qa="progress-bar"]')).toBeNull();
    recorder.destroy();
    alertSpy.mockRestore();
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
