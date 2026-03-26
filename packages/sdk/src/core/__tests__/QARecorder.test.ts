import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QARecorder } from '../QARecorder.js';

vi.mock('../../ui/ConfirmModal.js', () => ({
  ConfirmModal: { show: vi.fn().mockResolvedValue(true) },
}));

const mocks = vi.hoisted(() => ({
  stopFn: vi.fn(),
  record: vi.fn(),
  takeFullSnapshot: vi.fn(),
}));

vi.mock('rrweb', () => ({
  record: Object.assign(mocks.record, { takeFullSnapshot: mocks.takeFullSnapshot }),
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
  it('init()은 즉시 rrweb.record()를 호출한다', async () => {
    const recorder = new QARecorder();
    await recorder.init();
    expect(mocks.record).toHaveBeenCalledOnce();
    recorder.destroy();
  });

  it('init()은 플로팅 버튼을 recording 상태로 마운트한다', async () => {
    const recorder = new QARecorder();
    await recorder.init();
    const host = document.getElementById('qa-recorder-root')!;
    const btn = host.shadowRoot!.querySelector('button')!;
    expect(btn.title).toBe('Stop and save recording');
    recorder.destroy();
  });

  it('버튼 클릭 후 확인하면 파일이 저장된다', async () => {
    const recorder = new QARecorder();
    await recorder.init();

    const host = document.getElementById('qa-recorder-root')!;
    const btn = host.shadowRoot!.querySelector('button')!;

    btn.click();
    await vi.waitFor(() =>
      expect(URL.createObjectURL).toHaveBeenCalled()
    );
    recorder.destroy();
  });

  it('저장 후 자동으로 녹화가 재시작된다', async () => {
    const recorder = new QARecorder();
    await recorder.init();

    const host = document.getElementById('qa-recorder-root')!;
    const btn = host.shadowRoot!.querySelector('button')!;

    btn.click();
    await vi.waitFor(() =>
      expect(mocks.record).toHaveBeenCalledTimes(2)
    );
    recorder.destroy();
  });

  it('저장 후 버튼은 여전히 recording 상태다', async () => {
    const recorder = new QARecorder();
    await recorder.init();

    const host = document.getElementById('qa-recorder-root')!;
    const btn = host.shadowRoot!.querySelector('button')!;

    btn.click();
    await vi.waitFor(() =>
      expect(mocks.record).toHaveBeenCalledTimes(2)
    );
    expect(btn.title).toBe('Stop and save recording');
    recorder.destroy();
  });

  it('확인 취소 시 저장하지 않는다', async () => {
    const { ConfirmModal } = await import('../../ui/ConfirmModal.js');
    vi.mocked(ConfirmModal.show).mockResolvedValueOnce(false);

    const recorder = new QARecorder();
    await recorder.init();

    const host = document.getElementById('qa-recorder-root')!;
    host.shadowRoot!.querySelector('button')!.click();

    await vi.waitFor(() => expect(ConfirmModal.show).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    recorder.destroy();
  });
});
