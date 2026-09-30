import { record } from 'rrweb';
import type { QARecorderConfig, RecorderMode } from '../core/config.js';
import { MaskingFilter, type KeyMatcher } from '../network/MaskingFilter.js';

export type RecorderState = 'idle' | 'recording' | 'stopped';

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
 */
export class ScreenRecorder {
  private events: unknown[] = [];
  /**
   * 직전 체크아웃 구간. 체크아웃 시 현재 구간을 즉시 버리면 저장 시점에 따라
   * 히스토리가 0에 수렴할 수 있으므로, 마지막 두 구간을 유지해
   * 항상 최소 한 주기(checkoutEveryNms)만큼의 리플레이를 보장한다 (최대 두 주기).
   */
  private prevEvents: unknown[] = [];
  private stopFn: (() => void) | null = null;
  private state: RecorderState = 'idle';
  private preset: ModePreset;
  /** 페이지 URL 마스킹용 민감 키 판별 함수 — 이벤트마다 만들지 않도록 생성자에서 한 번만 만든다 */
  private readonly isSensitiveKey: KeyMatcher | null;

  constructor(mode: RecorderMode = 'normal', private readonly privacy: RecordPrivacyOptions = {}) {
    this.preset = MODE_PRESETS[mode];
    this.isSensitiveKey = MaskingFilter.createKeyMatcher(privacy.maskKeys ?? []);
  }

  start(): void {
    if (this.state === 'recording') return;

    this.events = [];
    this.prevEvents = [];
    const opts: Parameters<typeof record>[0] = {
      emit: (event, isCheckout) => {
        const stored = maskMetaHref(event, this.isSensitiveKey);
        if (isCheckout) {
          this.prevEvents = this.events;
          this.events = [stored];
        } else {
          this.events.push(stored);
        }
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
   * 페이지 URL 마스킹 이전 버전이나 다른 maskKeys 설정으로 저장된 백업일 수 있으므로 Meta href도 다시 가린다.
   */
  prependEvents(events: unknown[]): void {
    const cutoff = Date.now() - this.preset.checkoutEveryNms;
    const filtered = alignToFullSnapshot(
      events.filter((e) => ((e as { timestamp: number }).timestamp ?? 0) >= cutoff),
    );
    const masked = filtered.map((e) => maskMetaHref(e, this.isSensitiveKey));
    this.prevEvents = [...masked, ...this.prevEvents];
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
