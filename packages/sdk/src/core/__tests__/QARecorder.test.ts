import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QARecorder } from '../QARecorder.js';

const mocks = vi.hoisted(() => ({
  stopFn: vi.fn(),
  record: vi.fn(),
  takeFullSnapshot: vi.fn(),
  confirmModalShow: vi.fn(),
  localStorageSave: vi.fn(),
  idbHasData: vi.fn(),
  idbSave: vi.fn(),
  idbLoad: vi.fn(),
  idbClear: vi.fn(),
}));

vi.mock('rrweb', () => ({
  record: Object.assign(mocks.record, { takeFullSnapshot: mocks.takeFullSnapshot }),
}));

vi.mock('../../ui/ConfirmModal.js', () => ({
  ConfirmModal: { show: mocks.confirmModalShow },
}));

vi.mock('../../storage/IndexedDBBackup.js', () => ({
  IndexedDBBackup: {
    hasData: mocks.idbHasData,
    save: mocks.idbSave,
    load: mocks.idbLoad,
    clear: mocks.idbClear,
  },
}));

vi.mock('../../storage/LocalStorage.js', () => ({
  LocalStorage: { save: mocks.localStorageSave },
}));

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '';
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:mock'), revokeObjectURL: vi.fn() });
  mocks.record.mockImplementation(({ emit }: { emit: (event: unknown) => void }) => {
    emit({ type: 2, data: {}, timestamp: 1000 });
    return mocks.stopFn;
  });
  mocks.confirmModalShow.mockResolvedValue({ confirmed: true, memo: '' });
  mocks.localStorageSave.mockResolvedValue(undefined);
  mocks.idbHasData.mockResolvedValue(false);
  mocks.idbSave.mockResolvedValue(undefined);
  mocks.idbLoad.mockResolvedValue(null);
  mocks.idbClear.mockResolvedValue(undefined);
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
    expect(URL.createObjectURL).not.toHaveBeenCalled();
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

  it('enableBackup: false(기본값)이면 백업 체크를 하지 않는다', async () => {
    const recorder = new QARecorder();
    await recorder.init();

    expect(mocks.idbHasData).not.toHaveBeenCalled();
    recorder.destroy();
  });

  it('enableBackup: true일 때 백업이 있으면 세션에 복원되고 다운로드는 발생하지 않는다', async () => {
    mocks.idbHasData.mockResolvedValue(true);
    mocks.idbLoad.mockResolvedValue({
      events: [{ type: 2, data: {}, timestamp: Date.now() - 1000 }],
      harEntries: [],
      consoleLogs: [],
      savedAt: new Date().toISOString(),
    });

    const recorder = new QARecorder({ enableBackup: true });
    await recorder.init();

    await vi.waitFor(() => expect(mocks.idbClear).toHaveBeenCalledOnce());
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    recorder.destroy();
  });

  it('visibilitychange(hidden) 이벤트 시 IndexedDB에 현재 세션이 저장된다', async () => {
    const recorder = new QARecorder({ enableBackup: true });
    await recorder.init();

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    await vi.waitFor(() => expect(mocks.idbSave).toHaveBeenCalledOnce());
    recorder.destroy();
  });

  it('저장 완료 후 IndexedDB 백업이 초기화된다', async () => {
    const recorder = new QARecorder({ enableBackup: true });
    await recorder.init();

    const host = document.getElementById('qa-recorder-root')!;
    host.shadowRoot!.querySelector('button')!.click();

    await vi.waitFor(() => expect(mocks.idbClear).toHaveBeenCalled());
    recorder.destroy();
  });
});
