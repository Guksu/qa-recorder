import RecordRTC from 'recordrtc';

export type RecorderState = 'idle' | 'recording' | 'stopped';

/**
 * RecordRTC 래퍼.
 * MediaStream(화면 캡처)을 획득하고 청크 단위로 비디오를 녹화.
 */
export class ScreenRecorder {
  private recorder: RecordRTC | null = null;
  private stream: MediaStream | null = null;
  private state: RecorderState = 'idle';

  async start(): Promise<void> {
    if (this.state === 'recording') return;

    this.stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 30 },
      audio: false,
    });

    this.recorder = new RecordRTC(this.stream, {
      type: 'video',
      mimeType: 'video/webm;codecs=vp9',
      timeSlice: 1000, // 1초 단위 청크
    });

    this.recorder.startRecording();
    this.state = 'recording';
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.recorder || this.state !== 'recording') {
        resolve();
        return;
      }
      this.recorder.stopRecording(() => {
        this.stream?.getTracks().forEach((t) => t.stop());
        this.state = 'stopped';
        resolve();
      });
    });
  }

  getBlob(): Blob {
    if (!this.recorder) throw new Error('No recording available');
    return this.recorder.getBlob();
  }
}
