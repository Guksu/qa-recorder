import { record } from 'rrweb';

export type RecorderState = 'idle' | 'recording' | 'stopped';

/**
 * rrweb 래퍼.
 * MutationObserver 기반 DOM 이벤트를 수집하여 JSON Blob으로 직렬화.
 * getDisplayMedia 권한 불필요 — 모바일/WebView 포함 모든 환경 지원.
 */
export class ScreenRecorder {
  private events: unknown[] = [];
  private stopFn: (() => void) | null = null;
  private state: RecorderState = 'idle';

  start(): void {
    if (this.state === 'recording') return;

    this.events = [];
    this.stopFn =
      record({
        emit: (event) => {
          this.events.push(event);
        },
      }) ?? null;

    this.state = 'recording';
  }

  stop(): void {
    if (this.state !== 'recording') return;
    this.stopFn?.();
    this.stopFn = null;
    this.state = 'stopped';
  }

  getEvents(): unknown[] {
    if (this.state === 'idle') throw new Error('No recording available');
    return this.events;
  }

  getBlob(): Blob {
    if (this.state === 'idle') throw new Error('No recording available');
    return new Blob([JSON.stringify(this.events)], { type: 'application/json' });
  }

  reset(): void {
    if (this.state === 'recording') return;
    this.events = [];
    this.stopFn = null;
    this.state = 'idle';
  }
}
