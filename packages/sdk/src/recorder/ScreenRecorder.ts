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
  /**
   * 직전 체크아웃 구간. 체크아웃 시 현재 구간을 즉시 버리면 저장 시점에 따라
   * 히스토리가 0에 수렴할 수 있으므로, 마지막 두 구간을 유지해
   * 항상 최소 한 주기(checkoutEveryNms)만큼의 리플레이를 보장한다 (최대 두 주기).
   * 단, resume()으로 보존된 녹화 전체가 prevEvents가 되고 새 record()가 체크아웃 주기를
   * 처음부터 다시 세므로, 저장 실패 후 다음 체크아웃 전까지는 두 주기를 넘을 수 있다.
   */
  private prevEvents: unknown[] = [];
  private stopFn: (() => void) | null = null;
  private state: RecorderState = 'idle';
  private preset: ModePreset;

  constructor(mode: RecorderMode = 'normal') {
    this.preset = MODE_PRESETS[mode];
  }

  start(): void {
    if (this.state === 'recording') return;

    this.events = [];
    this.prevEvents = [];
    const opts: Parameters<typeof record>[0] = {
      emit: (event, isCheckout) => {
        if (isCheckout) {
          this.prevEvents = this.events;
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
    this.prevEvents = [];
    // takeFullSnapshot은 record()가 실행 중일 때만 유효 — idle/stopped에서 호출하면 rrweb이 throw
    if (this.state === 'recording') record.takeFullSnapshot();
  }

  stop(): void {
    if (this.state !== 'recording') return;
    this.stopFn?.();
    this.stopFn = null;
    this.state = 'stopped';
  }

  /**
   * 정지된 녹화를 기존 이벤트를 유지한 채 재개 (저장 실패 시 녹화 보존용).
   * 새 record()는 Meta + FullSnapshot부터 emit하므로 [...기존, ...신규] 순서로 이어 붙여도 재생 가능하다.
   * 보존된 이벤트는 prevEvents로 들어가므로 일반 직전 구간과 마찬가지로 다음 체크아웃 때 폐기된다.
   * recording 중이면 무시하고, idle이면 보존할 녹화가 없으므로 start()와 동일하게 동작한다.
   */
  resume(): void {
    if (this.state === 'recording') return;
    const kept = this.state === 'stopped' ? this.getEvents() : [];
    this.start();
    // start()가 비운 버퍼의 앞쪽(prevEvents)에 기존 이벤트를 되돌려 놓는다
    this.prevEvents = kept;
  }

  getEvents(): unknown[] {
    if (this.state === 'idle') throw new Error('No recording available');
    return [...this.prevEvents, ...this.events];
  }

  getBlob(): Blob {
    return new Blob([JSON.stringify(this.getEvents())], { type: 'application/json' });
  }

  /**
   * 백업에서 복원된 이벤트를 버퍼 앞에 추가 (현재 mode의 checkout 주기 초과분 자동 필터링).
   * 컷오프로 잘린 뒤에는 기준 스냅샷 없는 고아 incremental 이벤트가 앞에 남지 않도록
   * 재생 가능한 지점(FullSnapshot)부터 시작하게 정렬한다.
   */
  prependEvents(events: unknown[]): void {
    const cutoff = Date.now() - this.preset.checkoutEveryNms;
    const filtered = alignToFullSnapshot(
      events.filter((e) => ((e as { timestamp: number }).timestamp ?? 0) >= cutoff),
    );
    this.prevEvents = [...filtered, ...this.prevEvents];
  }

  reset(): void {
    if (this.state === 'recording') return;
    this.events = [];
    this.prevEvents = [];
    this.stopFn = null;
    this.state = 'idle';
  }
}

/* rrweb EventType: 2 = FullSnapshot, 4 = Meta (스냅샷 직전에 viewport 정보로 선행) */
const FULL_SNAPSHOT = 2;
const META = 4;

/**
 * 첫 FullSnapshot 이전의 이벤트를 제거해 배열이 재생 가능한 지점에서 시작하도록 정렬.
 * FullSnapshot 바로 앞의 Meta 이벤트는 함께 유지하고, FullSnapshot이 없으면
 * 전부 재생 불가이므로 빈 배열을 반환한다.
 */
function alignToFullSnapshot(events: unknown[]): unknown[] {
  const idx = events.findIndex((e) => (e as { type?: number }).type === FULL_SNAPSHOT);
  if (idx === -1) return [];
  const hasLeadingMeta = idx > 0 && (events[idx - 1] as { type?: number }).type === META;
  return events.slice(hasLeadingMeta ? idx - 1 : idx);
}
