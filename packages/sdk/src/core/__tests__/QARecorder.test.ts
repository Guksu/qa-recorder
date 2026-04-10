import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QARecorder } from '../QARecorder.js';

const mocks = vi.hoisted(() => ({
  stopFn: vi.fn(),
  record: vi.fn(),
  takeFullSnapshot: vi.fn(),
  confirmModalShow: vi.fn(),
  localStorageSave: vi.fn(),
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
