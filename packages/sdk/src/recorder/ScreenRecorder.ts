import { record } from 'rrweb';
import type { QARecorderConfig, RecorderMode } from '../core/config.js';
import { MaskingFilter, type KeyMatcher } from '../network/MaskingFilter.js';

export type RecorderState = 'idle' | 'recording' | 'stopped';

/**
 * 리플레이의 한 구간. 녹화 시작이나 체크아웃의 Meta + FullSnapshot으로 시작하므로 따로 재생할 수 있다
 * (백업에서 복원한 구간도 FullSnapshot부터 시작하도록 정렬한다).
 */
interface Segment {
  /** 녹화 시작과 체크아웃마다 1씩 늘어나는 번호 (복원한 백업 구간은 0) */
  readonly id: number;
  events: unknown[];
  /** JSON 문자 수 — maxReplaySize가 있을 때만 센다 (없으면 0) */
  size: number;
  /** FullSnapshot까지(앞의 Meta 포함)의 JSON 문자 수 */
  snapshotSize: number;
}

/**
 * 저장을 시작할 때 잘라 낸 녹화 (cutForSave 참고).
 * events는 저장할 이벤트이고, segment는 자른 직후 시작된 새 구간의 번호다.
 */
export interface SaveCut {
  readonly events: unknown[];
  readonly segment: number;
  /** 자르기 전 구간들 — 저장에 실패하면 되돌린다 */
  readonly saved: readonly Readonly<Segment>[];
  /**
   * 새 구간을 같은 record() 안의 takeFullSnapshot(true)로 시작했는지.
   * 그렇다면 노드 id가 그대로라(rrweb-snapshot은 노드에 붙인 __sn.id를 다시 쓴다) 저장에 실패했을 때
   * 그 Meta + FullSnapshot을 빼고 뒤의 변경 이벤트를 잘라 낸 구간에 그대로 이어 붙일 수 있다.
   */
  readonly mergeable: boolean;
}

/** rollbackSave의 결과 */
export interface RollbackResult {
  /**
   * 잘라 낸(저장에 실패한) 녹화 중 메모리 제한(maxReplaySize) 때문에 되돌리지 못하고 버린 이벤트 수.
   * 0이면 잘라 낸 녹화가 모두 남았다.
   */
  droppedEvents: number;
}

/**
 * rrweb record()에 전달하는 프라이버시 옵션 (미지정 시 rrweb 기본 동작과 동일).
 * maskAllInputs는 rrweb의 빈틈을 메운 maskInputOptions와 textarea 텍스트 마스킹 셀렉터로 바꿔 전달한다
 * (MASK_ALL_INPUT_OPTIONS, MASK_ALL_INPUTS_TEXT_SELECTOR 참고).
 * maskKeys는 rrweb에 전달하지 않고, 기록된 Meta 이벤트의 페이지 URL(data.href)을 가리는 데 쓴다 (maskMetaHref 참고).
 * 미지정이나 []이면 페이지 URL을 마스킹하지 않는다 — QARecorder는 설정의 maskKeys(기본 목록)를 넘긴다.
 */
export type RecordPrivacyOptions = Pick<
  QARecorderConfig,
  'maskAllInputs' | 'maskTextSelector' | 'blockSelector' | 'maskKeys'
>;

interface ModePreset {
  checkoutEveryNms: number;
  sampling?: { mousemove: number; scroll: number; input: 'last' };
}

type MaskInputOptions = NonNullable<Parameters<typeof record>[0]>['maskInputOptions'];

/**
 * maskAllInputs: true일 때 rrweb에 전달하는 maskInputOptions.
 * rrweb 1.1.3의 maskAllInputs 목록은 type 속성으로만 판별해서, 전체 스냅샷에서 type 속성이 없는
 * <input>과 type="hidden" input의 값은 그대로 기록된다. rrweb의 목록에 태그 이름 키 `input`을 더하면
 * maskInputValue가 태그 이름으로도 매칭해 모든 input 값을 가린다 (radio/checkbox/submit/button은
 * rrweb이 입력값 마스킹 대상에서 제외하므로 영향 없음). `input` 키는 rrweb 타입에 없어 캐스팅한다.
 * rrweb은 maskAllInputs: true면 maskInputOptions를 무시하므로 둘 중 이것만 전달해야 한다.
 */
const MASK_ALL_INPUT_OPTIONS = {
  color: true, date: true, 'datetime-local': true, email: true, month: true, number: true,
  range: true, search: true, tel: true, text: true, time: true, url: true, week: true,
  textarea: true, select: true, password: true,
  input: true,
} as MaskInputOptions;

/**
 * maskAllInputs: true일 때 maskTextSelector에 더하는 셀렉터.
 * rrweb 1.1.3은 maskInputOptions를 textarea의 value(속성과 input 이벤트)에만 적용하고, textarea의 텍스트 자식
 * 노드는 maskTextClass/maskTextSelector로만 가린다. 그래서 마크업에 담긴 초기값과, React 제어 textarea가 입력마다
 * node.defaultValue로 교체하는 텍스트 자식이 평문으로 기록된다. rrweb의 needMaskingText는 텍스트 노드의 조상을
 * 따라 올라가며 셀렉터를 검사하므로, 전체 스냅샷과 mutation(adds/characterData) 경로 모두에서 가려진다.
 */
const MASK_ALL_INPUTS_TEXT_SELECTOR = 'textarea';

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
 *
 * 보관 정책 (구간 = Meta + FullSnapshot으로 시작해 따로 재생할 수 있는 이벤트 묶음):
 * - 기본: 마지막 두 구간(직전 + 지금)을 보관한다. 체크아웃(mode의 시간 주기, 또는 지금 구간이
 *   maxReplaySize의 절반을 넘고 변경분이 스냅샷보다 커질 때)마다 그보다 오래된 구간은 버린다.
 *   그래서 저장하면 항상 최소 한 주기의 리플레이가 들어간다 (구간이 일찍 넘어가면 더 짧을 수 있다).
 * - 저장 실패로 되돌린 구간(rollbackSave)이나 복원한 백업처럼 마지막 두 구간보다 오래된 구간은
 *   전체가 maxReplaySize 안에 들어갈 때만 남긴다 — 넘으면 다음 체크아웃을 기다리지 않고 바로
 *   가장 오래된 구간부터 통째로 버린다 (남은 리플레이는 항상 FullSnapshot부터 시작한다).
 * - 예외: 마지막 두 구간은 크기와 상관없이 남긴다. 스냅샷 하나가 maxReplaySize의 4분의 1보다 큰 페이지에서는
 *   한 구간이 스냅샷의 약 두 배까지 커질 수 있어(trackSize 참고) 보관량이 제한을 넘을 수 있다 (최대 약 스냅샷 네 개 분량).
 */
export class ScreenRecorder {
  /** 오래된 구간부터 지금 구간(마지막)까지 */
  private segments: Segment[] = [];
  /** 마지막으로 만든 구간 번호 */
  private segmentSeq = 0;
  /**
   * record()를 새로 시작할 때마다 늘어나는 번호. emit 콜백은 자신을 만든 record()의 번호를 기억하고,
   * 그 뒤에 다른 record()가 시작됐으면 늦게 도착한 이벤트(throttle된 mousemove 등)를 버린다
   * — destroy() 후 다시 init()한 새 녹화에 이전 녹화의 이벤트가 섞이지 않도록.
   */
  private generation = 0;
  /** 다음 emit을 새 구간의 시작으로 다룰지 — record()를 다시 시작해 구간을 나눌 때 사용 (checkoutNow 참고) */
  private startNewSegmentOnNextEmit = false;
  private stopFn: (() => void) | null = null;
  private state: RecorderState = 'idle';
  private preset: ModePreset;
  /** 페이지 URL 마스킹용 민감 키 판별 함수 — 이벤트마다 만들지 않도록 생성자에서 한 번만 만든다 */
  private readonly isSensitiveKey: KeyMatcher | null;
  /** 보관할 이벤트의 대략적인 최대 JSON 문자 수 (Infinity면 크기와 상관없이 시간 기준으로만 구간을 나눈다) */
  private readonly maxReplaySize: number;

  constructor(
    mode: RecorderMode = 'normal',
    private readonly privacy: RecordPrivacyOptions = {},
    maxReplaySize = Infinity,
  ) {
    this.preset = MODE_PRESETS[mode];
    this.isSensitiveKey = MaskingFilter.createKeyMatcher(privacy.maskKeys ?? []);
    this.maxReplaySize = typeof maxReplaySize === 'number' && maxReplaySize > 0 ? maxReplaySize : Infinity;
  }

  private get sizeLimited(): boolean {
    return this.maxReplaySize !== Infinity;
  }

  /** 지금 구간 (녹화 전이면 없음) */
  private get current(): Segment | undefined {
    return this.segments[this.segments.length - 1];
  }

  private newSegment(events: unknown[] = []): Segment {
    return { id: ++this.segmentSeq, events, size: 0, snapshotSize: 0 };
  }

  start(): void {
    if (this.state === 'recording') return;

    this.segments = [this.newSegment()];
    this.startNewSegmentOnNextEmit = false;
    this.startRecord();
  }

  /** rrweb record()를 시작한다. 버퍼는 건드리지 않는다 */
  private startRecord(): void {
    const generation = ++this.generation;
    const opts: Parameters<typeof record>[0] = {
      emit: (event, isCheckout) => {
        if (generation !== this.generation) return;
        const stored = maskMetaHref(event, this.isSensitiveKey);
        if (isCheckout || this.startNewSegmentOnNextEmit || !this.current) {
          this.startNewSegmentOnNextEmit = false;
          this.segments.push(this.newSegment([stored]));
          // 체크아웃: 마지막 두 구간(직전 + 지금)만 남긴다
          if (this.segments.length > 2) this.segments = this.segments.slice(-2);
        } else {
          this.current!.events.push(stored);
        }
        this.trackSize(stored);
      },
      checkoutEveryNms: this.preset.checkoutEveryNms,
    };
    if (this.privacy.maskAllInputs) opts.maskInputOptions = MASK_ALL_INPUT_OPTIONS;
    else opts.maskAllInputs = false; // rrweb 기본값: 비밀번호 입력만 마스킹
    if (this.preset.sampling) opts.sampling = this.preset.sampling;
    // null/빈 문자열은 rrweb 기본값(셀렉터 없음)과 같으므로 전달하지 않는다
    const maskTextSelector = [
      this.privacy.maskTextSelector,
      this.privacy.maskAllInputs ? MASK_ALL_INPUTS_TEXT_SELECTOR : null,
    ].filter(Boolean).join(', ');
    if (maskTextSelector) opts.maskTextSelector = maskTextSelector;
    if (this.privacy.blockSelector) opts.blockSelector = this.privacy.blockSelector;

    this.stopFn = record(opts) ?? null;
    this.state = 'recording';
  }

  /**
   * 녹화를 멈추지 않고 지금까지의 녹화를 저장용으로 잘라 낸다.
   * 잘라 낸 직후 새 FullSnapshot으로 새 구간을 시작하므로, 저장하는 동안 기록되는 이벤트는 새 구간에 쌓이고
   * 따로 재생할 수 있다. 저장 결과에 따라 commitSave(성공) 또는 rollbackSave(실패)를 호출한다.
   * 녹화 중이 아니면 throw한다.
   */
  cutForSave(): SaveCut {
    if (this.state !== 'recording') throw new Error('No recording available');
    const saved = this.segments.map((seg) => ({ ...seg, events: [...seg.events] }));
    const events = this.getEvents();
    const mergeable = this.checkoutNow();
    return { events, segment: this.current!.id, saved, mergeable };
  }

  /**
   * 저장에 성공 — 잘라 낸 시점 이전의 녹화를 버리고, 저장하는 동안 기록된 녹화(잘라 낸 시점의 새 구간부터)는 남긴다.
   */
  commitSave(cut: SaveCut): void {
    this.segments = this.segments.filter((seg) => seg.id >= cut.segment);
  }

  /**
   * 저장에 실패 — 잘라 낸 녹화를 되돌려 다음 저장에 함께 들어가게 한다 (중복 없이).
   * 자를 때 같은 record() 안에서 찍은 Meta + FullSnapshot은 저장을 나누려고 찍은 것이므로 빼고,
   * 그 뒤에 기록된 변경 이벤트를 잘라 낸 마지막 구간에 이어 붙인다 — 실패를 반복해도 스냅샷이 쌓이지 않는다.
   * 되돌린 뒤 maxReplaySize를 넘으면 마지막 두 구간보다 오래된 구간을 가장 오래된 것부터 버리고,
   * 잘라 낸 녹화 중 버린 이벤트 수를 돌려준다.
   */
  rollbackSave(cut: SaveCut): RollbackResult {
    if (this.state === 'idle') return { droppedEvents: 0 };
    const restored = cut.saved.map((seg) => ({ ...seg, events: [...seg.events] }));
    let after = this.segments.filter((seg) => seg.id >= cut.segment);
    const cutSegment = after[0];
    const last = restored[restored.length - 1];
    if (cut.mergeable && last && cutSegment?.id === cut.segment && startsWithSnapshot(cutSegment.events)) {
      last.events.push(...cutSegment.events.slice(2));
      last.size += cutSegment.size - cutSegment.snapshotSize;
      after = after.slice(1);
    }
    this.segments = [...restored, ...after];
    const dropped = this.enforceBudget();
    const savedIds = new Set(cut.saved.map((seg) => seg.id));
    return {
      droppedEvents: dropped.filter((seg) => savedIds.has(seg.id)).reduce((n, seg) => n + seg.events.length, 0),
    };
  }

  /**
   * 마지막 두 구간보다 오래된 구간을 전체 크기가 maxReplaySize 안에 들 때까지 가장 오래된 것부터 버린다.
   * 구간 단위로만 버리므로 남은 리플레이는 항상 FullSnapshot부터 시작한다. 버린 구간을 돌려준다.
   */
  private enforceBudget(): Segment[] {
    if (!this.sizeLimited) return [];
    const dropped: Segment[] = [];
    let total = this.segments.reduce((n, seg) => n + seg.size, 0);
    while (this.segments.length > 2 && total > this.maxReplaySize) {
      const oldest = this.segments.shift()!;
      total -= oldest.size;
      dropped.push(oldest);
    }
    return dropped;
  }

  /**
   * 지금 새 구간을 시작한다 (rrweb의 시간 기준 체크아웃과 같은 takeFullSnapshot(true)).
   * rrweb이 체크아웃 이벤트를 emit하지 않으면(예외 등) record()를 다시 시작해 그 첫 이벤트부터 새 구간으로 다룬다
   * — 동기적으로 이어지므로 기록 공백은 없다. takeFullSnapshot으로 나눴으면 true.
   */
  private checkoutNow(): boolean {
    const before = this.segmentSeq;
    try {
      record.takeFullSnapshot(true);
    } catch {
      /* 아래에서 record()를 다시 시작한다 */
    }
    if (this.segmentSeq !== before) return true;
    this.stopFn?.();
    this.stopFn = null;
    this.startNewSegmentOnNextEmit = true;
    this.startRecord();
    if (this.segmentSeq === before) {
      // record()가 아무것도 emit하지 않았다 — 빈 새 구간을 직접 연다
      this.startNewSegmentOnNextEmit = false;
      this.segments.push(this.newSegment());
      if (this.segments.length > 2) this.segments = this.segments.slice(-2);
    }
    return false;
  }

  /**
   * 지금 구간의 크기를 세고, maxReplaySize의 절반을 넘으면 새 구간을 일찍 시작한다.
   * rrweb의 시간 기준 체크아웃과 같은 takeFullSnapshot(true)를 쓰므로 emit에 isCheckout으로 돌아와
   * 가장 오래된 구간이 버려지고, 남은 두 구간은 각각 FullSnapshot으로 시작해 그대로 재생된다.
   * 새 구간도 스냅샷 크기만큼은 차지하므로, 스냅샷 뒤에 쌓인 변경분이 스냅샷보다 작으면 넘기지 않는다
   * — 스냅샷 하나가 제한의 절반보다 큰 페이지에서 이벤트마다 스냅샷을 다시 찍지 않도록.
   * 저장 실패로 되돌린 오래된 구간은 새 이벤트로 전체가 제한을 넘으면 바로 버린다 (enforceBudget).
   * stop() 뒤에 늦게 emit된 이벤트(throttle된 mousemove 등)로는 스냅샷을 찍지 않는다.
   */
  private trackSize(event: unknown): void {
    if (!this.sizeLimited) return;
    const seg = this.current!;
    seg.size += JSON.stringify(event).length;
    if ((event as { type?: unknown }).type === FULL_SNAPSHOT) {
      seg.snapshotSize = seg.size;
      return;
    }
    if (this.segments.length > 2) this.enforceBudget();
    if (
      this.state === 'recording' &&
      seg.size > this.maxReplaySize / 2 &&
      seg.size - seg.snapshotSize > seg.snapshotSize
    ) {
      record.takeFullSnapshot(true);
    }
  }

  clearBuffer(): void {
    this.segments = [this.newSegment()];
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
   * 정지된 녹화를 기존 이벤트를 유지한 채 재개.
   * 새 record()는 Meta + FullSnapshot부터 emit하므로 [...기존, ...신규] 순서로 이어 붙여도 재생 가능하다.
   * 보존된 이벤트는 직전 구간이 되므로 일반 직전 구간과 마찬가지로 다음 체크아웃 때 폐기된다.
   * recording 중이면 무시하고, idle이면 보존할 녹화가 없으므로 start()와 동일하게 동작한다.
   */
  resume(): void {
    if (this.state === 'recording') return;
    const kept = this.state === 'stopped' ? this.getEvents() : [];
    this.start();
    // start()가 비운 버퍼의 앞쪽(직전 구간)에 기존 이벤트를 되돌려 놓는다
    if (kept.length) this.segments.unshift(this.measured({ id: 0, events: kept, size: 0, snapshotSize: 0 }));
  }

  getEvents(): unknown[] {
    if (this.state === 'idle') throw new Error('No recording available');
    const all: unknown[] = [];
    for (const seg of this.segments) all.push(...seg.events);
    return all;
  }

  /**
   * 지금 구간의 이벤트만 반환 (백업 용량이 모자랄 때 사용).
   * 구간은 녹화 시작이나 체크아웃의 Meta + FullSnapshot으로 시작하므로 따로 재생할 수 있다.
   */
  getRecentEvents(): unknown[] {
    if (this.state === 'idle') throw new Error('No recording available');
    return [...(this.current?.events ?? [])];
  }

  getBlob(): Blob {
    return new Blob([JSON.stringify(this.getEvents())], { type: 'application/json' });
  }

  /**
   * 백업에서 복원된 이벤트를 버퍼 앞에 추가 (현재 mode의 checkout 주기 초과분 자동 필터링).
   * 컷오프로 잘린 뒤에는 기준 스냅샷 없는 고아 incremental 이벤트가 앞에 남지 않도록
   * 재생 가능한 지점(FullSnapshot)부터 시작하게 정렬한다.
   * 페이지 URL 마스킹 이전 버전이나 다른 maskKeys 설정으로 저장된 백업일 수 있으므로 Meta href도 다시 가린다.
   */
  prependEvents(events: unknown[]): void {
    const cutoff = Date.now() - this.preset.checkoutEveryNms;
    const filtered = alignToFullSnapshot(
      events.filter((e) => ((e as { timestamp: number }).timestamp ?? 0) >= cutoff),
    );
    if (filtered.length === 0) return;
    const masked = filtered.map((e) => maskMetaHref(e, this.isSensitiveKey));
    this.segments.unshift(this.measured({ id: 0, events: masked, size: 0, snapshotSize: 0 }));
    this.enforceBudget();
  }

  /** 이벤트로 구간 크기를 다시 센다 (크기 제한이 있을 때만) */
  private measured(seg: Segment): Segment {
    if (!this.sizeLimited) return seg;
    let size = 0;
    for (const event of seg.events) {
      size += JSON.stringify(event).length;
      if ((event as { type?: unknown }).type === FULL_SNAPSHOT && seg.snapshotSize === 0) seg.snapshotSize = size;
    }
    seg.size = size;
    return seg;
  }

  reset(): void {
    if (this.state === 'recording') return;
    this.segments = [];
    this.stopFn = null;
    this.state = 'idle';
  }
}

/** 구간이 Meta + FullSnapshot으로 시작하는지 (자를 때 찍은 체크아웃을 뺄 수 있는지 확인) */
function startsWithSnapshot(events: unknown[]): boolean {
  return (events[0] as { type?: unknown } | undefined)?.type === META
    && (events[1] as { type?: unknown } | undefined)?.type === FULL_SNAPSHOT;
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

/**
 * Meta 이벤트의 data.href — rrweb이 스냅샷마다 기록하는 window.location.href — 에서 민감 키 값을 가린 새 이벤트를 반환
 * (MaskingFilter.maskUrl: 쿼리와 '='가 있는 fragment). 비밀번호 재설정·매직 링크의 `?token=`이나
 * OAuth implicit flow의 `#access_token=`이 Meta href에 담겨 rr.json·HTML 리포트·sessionStorage 백업에 남지 않게 한다.
 * 키 이름만 비교하므로 경로나 다른 파라미터 값 안의 토큰(/reset/{token}, ?next=/reset?token=...)은 감지하지 않고,
 * 페이지 URL이 다른 경로로 기록되는 것도 막지 않는다 — 예: DOM의 상대 링크(href="#main" 등, rrweb이 페이지 쿼리가 붙은
 * 절대 URL로 기록), 인라인 스크립트 에러의 메시지·스택 트레이스(ConsoleCapture), 페이지 URL을 값으로 담은 요청
 * (NetworkCapture — 분석 도구의 dl= 등)에는 페이지 URL이 그대로 남는다.
 * rrweb 1.1.3 Replayer는 Meta 이벤트에서 width/height(와 type·timestamp)만 읽고 href는 쓰지 않으므로 재생에는 영향이 없다.
 * rrweb이 넘긴 객체는 수정하지 않는다 (emit 직후에도 rrweb의 wrappedEmit이 같은 객체를 읽는다).
 * Meta가 아니거나 가릴 값이 없으면 받은 이벤트를 그대로 반환한다.
 */
function maskMetaHref(event: unknown, isSensitiveKey: KeyMatcher | null): unknown {
  if (!isSensitiveKey || typeof event !== 'object' || event === null) return event;
  const meta = event as { type?: unknown; data?: { href?: unknown } | null };
  const href = meta.data?.href;
  if (meta.type !== META || typeof href !== 'string') return event;
  const masked = MaskingFilter.maskUrl(href, isSensitiveKey);
  return masked === href ? event : { ...meta, data: { ...meta.data, href: masked } };
}
