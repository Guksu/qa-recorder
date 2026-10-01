import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ record: vi.fn() }));

vi.mock('rrweb', () => ({
  record: Object.assign(mocks.record, { takeFullSnapshot: vi.fn() }),
}));

type ConfigWindow = Window & { __QA_RECORDER_CONFIG__?: object };

describe('script 태그 자동 초기화 (index.ts)', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.record.mockReset();
    document.body.innerHTML = '';
    mocks.record.mockImplementation(({ emit }: { emit: (event: unknown) => void }) => {
      emit({ type: 2, data: {}, timestamp: 1000 });
      return vi.fn();
    });
  });

  afterEach(() => {
    delete (window as ConfigWindow).__QA_RECORDER_CONFIG__;
  });

  it('__QA_RECORDER_CONFIG__가 있으면 싱글톤으로 시작해, 이후 setup()을 호출해도 인스턴스가 하나다', async () => {
    (window as ConfigWindow).__QA_RECORDER_CONFIG__ = {};
    const { QARecorder } = await import('../index.js');

    const instance = QARecorder.getInstance();
    expect(instance).not.toBeNull();
    QARecorder.setup();
    expect(QARecorder.getInstance()).toBe(instance);

    await vi.waitFor(() => expect(document.querySelectorAll('#qa-recorder-root')).toHaveLength(1));
    expect(mocks.record).toHaveBeenCalledOnce();
    instance!.destroy();
  });

  it('__QA_RECORDER_CONFIG__가 없으면 자동으로 시작하지 않는다', async () => {
    const { QARecorder } = await import('../index.js');
    expect(QARecorder.getInstance()).toBeNull();
    expect(mocks.record).not.toHaveBeenCalled();
  });
});
