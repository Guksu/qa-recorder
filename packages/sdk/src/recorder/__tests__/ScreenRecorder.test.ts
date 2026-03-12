import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ScreenRecorder } from '../ScreenRecorder.js';

const mocks = vi.hoisted(() => ({
  startRecording: vi.fn(),
  stopRecording: vi.fn((cb: () => void) => cb()),
  getBlob: vi.fn().mockReturnValue(new Blob(['video-data'], { type: 'video/webm' })),
}));

vi.mock('recordrtc', () => ({
  default: class MockRecordRTC {
    startRecording = mocks.startRecording;
    stopRecording = mocks.stopRecording;
    getBlob = mocks.getBlob;
  },
}));

function makeMockStream(trackStop = vi.fn()): MediaStream {
  return { getTracks: () => [{ stop: trackStop }] } as unknown as MediaStream;
}

describe('ScreenRecorder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(global.navigator, 'mediaDevices', {
      value: { getDisplayMedia: vi.fn().mockResolvedValue(makeMockStream()) },
      configurable: true,
    });
  });

  it('start()는 getDisplayMedia로 스트림을 요청한다', async () => {
    const recorder = new ScreenRecorder();
    await recorder.start();
    expect(navigator.mediaDevices.getDisplayMedia).toHaveBeenCalledWith({
      video: { frameRate: 30 },
      audio: false,
    });
  });

  it('start()는 RecordRTC 녹화를 시작한다', async () => {
    const recorder = new ScreenRecorder();
    await recorder.start();
    expect(mocks.startRecording).toHaveBeenCalledOnce();
  });

  it('start()를 중복 호출해도 녹화는 한 번만 시작된다', async () => {
    const recorder = new ScreenRecorder();
    await recorder.start();
    await recorder.start();
    expect(mocks.startRecording).toHaveBeenCalledOnce();
  });

  it('stop()은 녹화를 중지하고 스트림 트랙을 종료한다', async () => {
    const mockTrackStop = vi.fn();
    Object.defineProperty(global.navigator, 'mediaDevices', {
      value: { getDisplayMedia: vi.fn().mockResolvedValue(makeMockStream(mockTrackStop)) },
      configurable: true,
    });
    const recorder = new ScreenRecorder();
    await recorder.start();
    await recorder.stop();
    expect(mocks.stopRecording).toHaveBeenCalledOnce();
    expect(mockTrackStop).toHaveBeenCalledOnce();
  });

  it('stop()을 녹화 시작 전에 호출해도 에러가 발생하지 않는다', async () => {
    const recorder = new ScreenRecorder();
    await expect(recorder.stop()).resolves.toBeUndefined();
  });

  it('getBlob()은 녹화된 Blob을 반환한다', async () => {
    const recorder = new ScreenRecorder();
    await recorder.start();
    await recorder.stop();
    const blob = recorder.getBlob();
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('video/webm');
  });

  it('getBlob()을 start() 전에 호출하면 에러를 던진다', () => {
    const recorder = new ScreenRecorder();
    expect(() => recorder.getBlob()).toThrow('No recording available');
  });
});
