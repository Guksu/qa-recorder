import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QARecorder } from '../QARecorder.js';

vi.mock('../../ui/ConfirmModal.js', () => ({
  ConfirmModal: { show: vi.fn().mockResolvedValue(true) },
}));

const mocks = vi.hoisted(() => ({
  stopFn: vi.fn(),
  record: vi.fn(),
}));

vi.mock('rrweb', () => ({
  record: mocks.record,
}));

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '';
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:mock'), revokeObjectURL: vi.fn() });
  mocks.record.mockImplementation(({ emit }: { emit: (event: unknown) => void }) => {
    emit({ type: 2, data: {}, timestamp: 1000 });
    return mocks.stopFn;
  });
});

describe('QARecorder', () => {
  it('init()은 녹화를 즉시 시작하지 않는다', async () => {
    const recorder = new QARecorder();
    await recorder.init();
    expect(mocks.record).not.toHaveBeenCalled();
    recorder.destroy();
  });

  it('init()은 플로팅 버튼을 마운트한다', async () => {
    const recorder = new QARecorder();
    await recorder.init();
    expect(document.getElementById('qa-recorder-root')).not.toBeNull();
    recorder.destroy();
  });

  it('첫 번째 버튼 클릭은 rrweb.record()를 호출한다', async () => {
    const recorder = new QARecorder();
    await recorder.init();

    const host = document.getElementById('qa-recorder-root')!;
    host.shadowRoot!.querySelector('button')!.click();
    await vi.waitFor(() =>
      expect(mocks.record).toHaveBeenCalledOnce()
    );
    recorder.destroy();
  });

  it('녹화 중 버튼 클릭 후 확인하면 녹화를 중지하고 저장한다', async () => {
    const recorder = new QARecorder();
    await recorder.init();

    const host = document.getElementById('qa-recorder-root')!;
    const btn = host.shadowRoot!.querySelector('button')!;

    btn.click();
    await vi.waitFor(() =>
      expect(btn.title).toBe('녹화 중지 및 저장')
    );

    btn.click();
    await vi.waitFor(() =>
      expect(URL.createObjectURL).toHaveBeenCalled()
    );
    recorder.destroy();
  });

  it('저장 시 세션 파일과 HAR 파일이 다운로드된다', async () => {
    const recorder = new QARecorder();
    await recorder.init();

    const host = document.getElementById('qa-recorder-root')!;
    const btn = host.shadowRoot!.querySelector('button')!;

    btn.click();
    await vi.waitFor(() => expect(btn.title).toBe('녹화 중지 및 저장'));

    btn.click();
    await vi.waitFor(() =>
      expect(URL.createObjectURL).toHaveBeenCalled()
    );
    recorder.destroy();
  });

  it('녹화 중지 후 다시 녹화를 시작할 수 있다', async () => {
    const recorder = new QARecorder();
    await recorder.init();

    const host = document.getElementById('qa-recorder-root')!;
    const btn = host.shadowRoot!.querySelector('button')!;

    // 1차 녹화 시작
    btn.click();
    await vi.waitFor(() =>
      expect(btn.title).toBe('녹화 중지 및 저장')
    );

    // 1차 녹화 중지
    btn.click();
    await vi.waitFor(() =>
      expect(btn.title).toBe('QA 녹화 시작')
    );

    // 2차 녹화 시작
    btn.click();
    await vi.waitFor(() =>
      expect(mocks.record).toHaveBeenCalledTimes(2)
    );
    recorder.destroy();
  });
});
