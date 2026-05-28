import { record } from 'rrweb';
import type { RecorderMode } from '../core/config.js';

export type RecorderState = 'idle' | 'recording' | 'stopped';

interface ModePreset {
  checkoutEveryNms: number;
  sampling?: { mousemove: number; scroll: number; input: 'last' };
}

const MODE_PRESETS: Record<RecorderMode, ModePreset> = {
  light:  { checkoutEveryNms: 30 * 60 * 1000 },
  normal: { checkoutEveryNms: 20 * 60 * 1000 },
  heavy:  {
    checkoutEveryNms: 5 * 60 * 1000,
    sampling: { mousemove: 100, scroll: 150, input: 'last' },
  },
};

/**
 * rrweb 래퍼.
 * MutationObserver 기반 DOM 이벤트를 수집하여 JSON Blob으로 직렬화.
 * getDisplayMedia 권한 불필요 — 모바일/WebView 포함 모든 환경 지원.
 */
export class ScreenRecorder {
  private events: unknown[] = [];
  private stopFn: (() => void) | null = null;
  private state: RecorderState = 'idle';
  private preset: ModePreset;

  constructor(mode: RecorderMode = 'normal') {
    this.preset = MODE_PRESETS[mode];
  }

  start(): void {
    if (this.state === 'recording') return;

    this.events = [];
    const opts: Parameters<typeof record>[0] = {
      emit: (event, isCheckout) => {
        if (isCheckout) {
          this.events = [event];
        } else {
          this.events.push(event);
        }
      },
      checkoutEveryNms: this.preset.checkoutEveryNms,
    };
    if (this.preset.sampling) opts.sampling = this.preset.sampling;

    this.stopFn = record(opts) ?? null;
    this.state = 'recording';
  }

  clearBuffer(): void {
    this.events = [];
    record.takeFullSnapshot();
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

  /** 백업에서 복원된 이벤트를 버퍼 앞에 추가 (현재 mode의 checkout 주기 초과분 자동 필터링) */
  prependEvents(events: unknown[]): void {
    const cutoff = Date.now() - this.preset.checkoutEveryNms;
    const filtered = events.filter(
      (e) => ((e as { timestamp: number }).timestamp ?? 0) >= cutoff,
    );
    this.events = [...filtered, ...this.events];
  }

  reset(): void {
    if (this.state === 'recording') return;
    this.events = [];
    this.stopFn = null;
    this.state = 'idle';
  }
}
