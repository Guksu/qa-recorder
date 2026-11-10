import { resolveConfig, type QARecorderConfig } from './config.js';
import { NetworkCapture } from '../network/NetworkCapture.js';
import { ScreenRecorder } from '../recorder/ScreenRecorder.js';
import { ConsoleCapture } from '../console/ConsoleCapture.js';
import { FloatingButton } from '../ui/FloatingButton.js';
import { ConfirmModal } from '../ui/ConfirmModal.js';
import { ProgressBar } from '../ui/ProgressBar.js';
import { SharePanel } from '../ui/SharePanel.js';
import { LocalStorage } from '../storage/LocalStorage.js';
import { RemoteDelivery } from '../storage/RemoteDelivery.js';
import { HARBuilder } from '../network/HARBuilder.js';
import { isAbortError } from './abort.js';
import { MaskingFilter, type KeyMatcher } from '../network/MaskingFilter.js';
import { UnifiedViewer } from '../viewer/UnifiedViewer.js';
import { collectEnvironment, type EnvironmentInfo } from './environment.js';
import type { HARDocument, HAREntry } from '../types/har.js';
import type { ConsoleEntry } from '../console/ConsoleCapture.js';
import type { SaveCut } from '../recorder/ScreenRecorder.js';

const SESSION_KEY = 'qa-recorder-backup';

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** 저장을 시작할 때 잘라 낸 데이터. 저장이 끝나면 성공이면 commit, 실패면 rollback한다 */
interface SaveSnapshot {
  screen: SaveCut;
  network: HAREntry[];
  console: ConsoleEntry[];
  /** 자른 시각 — 저장 성공 후 남은 기록의 기준 시각 */
  cutAt: Date;
  /** 리포트를 만들 때 응답 본문을 아직 받는 중이던 요청 — 저장에 성공해도 버리지 않고 다음 저장에 다시 넣는다 */
  pendingBodies: Set<HAREntry>;
}

/** 저장 실패 후 메모리 제한 때문에 되돌리지 못한(다음 저장에 들어가지 않는) 기록 */
interface RollbackLoss {
  replayEvents: number;
  requests: number;
  consoleEntries: number;
}

/**
 * 저장 결과. aborted는 저장이 취소된 경우 — 진행 막대의 취소 버튼이면 잘라 낸 기록을 되돌리고,
 * destroy()면 아무것도 하지 않는다 (confirmAndSave 참고).
 */
type SaveOutcome =
  | { kind: 'saved'; url?: string; uploaded: boolean }
  | { kind: 'fallback'; uploadError: unknown }
  | { kind: 'failed'; uploadError?: unknown; saveError: unknown; loss?: RollbackLoss }
  | { kind: 'aborted' };

/** 저장 실패 안내의 마지막 줄 — 메모리 제한으로 일부를 남기지 못했으면 그렇게 말한다 */
function hasLoss(loss: RollbackLoss | undefined): boolean {
  return !!loss && (loss.replayEvents > 0 || loss.requests > 0 || loss.consoleEntries > 0);
}

function keptMessage(loss: RollbackLoss | undefined): string {
  const parts = [
    loss?.replayEvents ? `${loss.replayEvents} replay events` : '',
    loss?.requests ? `${loss.requests} network requests` : '',
    loss?.consoleEntries ? `${loss.consoleEntries} console entries` : '',
  ].filter(Boolean);
  if (parts.length === 0) return 'The recording was kept. Please try again.';
  return 'The recording was kept, except for its oldest part, which no longer fit within the memory limits ' +
    `(maxReplaySize, maxRequests, maxConsoleEntries) and was dropped: ${parts.join(', ')}. Please try again.`;
}

export class QARecorder {
  private static _instance: QARecorder | null = null;

  /**
   * Initialize qa-recorder as a singleton. Safe to call multiple times —
   * subsequent calls are no-ops. Designed to be called at module level,
   * outside React components, so StrictMode double-invocation has no effect.
   *
   * @example
   * // main.tsx or app entry point — outside React
   * QARecorder.setup({ enableBackup: true });
   */
  static setup(config?: QARecorderConfig): void {
    if (!QARecorder._instance) {
      QARecorder._instance = new QARecorder(config);
      QARecorder._instance.init().catch(console.error);
    }
  }

  /**
   * Returns the singleton instance created by `setup()`, or `null` if not yet initialized.
   */
  static getInstance(): QARecorder | null {
    return QARecorder._instance;
  }

  private config: Required<QARecorderConfig>;
  /** 환경 정보의 페이지 URL을 가릴 때 쓰는 민감 키 판별 함수 (maskKeys) */
  private readonly urlKeyMatcher: KeyMatcher | null;
  private networkCapture: NetworkCapture;
  private screenRecorder: ScreenRecorder;
  private consoleCapture: ConsoleCapture;
  private floatingButton: FloatingButton;
  private pageHideHandler: (() => void) | null = null;
  /**
   * init()부터 destroy()까지의 수명. destroy()가 abort()하면 진행 중인 확인창·업로드·로컬 저장이 취소되고,
   * 그 흐름은 이 신호를 보고 녹화·버퍼·UI를 더 건드리지 않는다. 다시 init()하면 새 컨트롤러를 만들므로
   * 이전 수명의 늦은 완료 처리는 새 수명에 영향을 주지 않는다.
   */
  private lifecycle: AbortController | null = null;
  /** 진행 중인 저장 흐름 (확인창 포함). 그동안 버튼이 다시 눌려도(키보드 Enter 등) 저장을 한 번만 진행한다 */
  private activeSave: object | null = null;
  /** 이 인스턴스가 띄운 진행 막대·공유 패널을 닫는 함수 (destroy()에서 정리) */
  private dismissProgress: (() => void) | null = null;
  private dismissShare: (() => void) | null = null;

  constructor(overrides?: QARecorderConfig) {
    this.config = resolveConfig(overrides);
    this.urlKeyMatcher = MaskingFilter.createKeyMatcher(this.config.maskKeys);
    // 업로드 요청은 앱 트래픽이 아니므로 캡처하지 않는다 (저장 실패로 버퍼를 보존할 때 리포트에 섞이지 않도록)
    this.networkCapture = new NetworkCapture(this.config.maxRequests, this.config.maskHeaders, {
      maskKeys: this.config.maskKeys,
      ignoreUrls: this.config.endpoint ? [this.config.endpoint] : [],
      maxBodySize: this.config.maxBodySize,
    });
    this.screenRecorder = new ScreenRecorder(this.config.mode, {
      maskAllInputs: this.config.maskAllInputs,
      maskTextSelector: this.config.maskTextSelector,
      blockSelector: this.config.blockSelector,
      maskKeys: this.config.maskKeys,
    }, this.config.maxReplaySize);
    this.consoleCapture = new ConsoleCapture(this.config.maxConsoleEntries, this.config.consoleLevels);
    this.floatingButton = new FloatingButton(this.onButtonClick.bind(this), this.config.zIndex);
  }

  async init(): Promise<void> {
    // 두 번 호출하면 버튼과 pagehide 리스너가 중복되고 가로채기가 겹치므로 한 번만 시작한다 (destroy() 후에는 다시 가능)
    if (this.lifecycle) return;
    this.lifecycle = new AbortController();

    // destroy() 후 다시 init()하면 새 녹화로 시작한다 — 화면 녹화(start())처럼 네트워크·콘솔 기록도 비운다
    this.networkCapture.clearBuffer();
    this.consoleCapture.clearBuffer();
    this.networkCapture.start();
    this.screenRecorder.start();
    this.consoleCapture.start();
    this.floatingButton.mount();
    this.floatingButton.setState('recording');

    if (this.config.enableBackup) {
      /* 이전 세션 백업을 현재 세션 버퍼에 복원 (동기) */
      this.restoreFromSessionStorage();

      /* pagehide(새로고침/닫기/이동) 시 sessionStorage에 동기적으로 저장
       * — async IDB는 페이지 종료 전 완료 보장 불가. sessionStorage는 동기 API라 항상 완료됨. */
      this.pageHideHandler = () => { this.saveToSessionStorage(); };
      window.addEventListener('pagehide', this.pageHideHandler);
    }
  }

  /**
   * sessionStorage 용량(Chromium 기준 키 포함 5,242,880자)을 넘으면 더 작은 백업으로 다시 시도한다:
   * 전체 녹화 → 지금 구간만 (FullSnapshot으로 시작해 따로 재생 가능) → 녹화 없이 네트워크·콘솔 기록만.
   */
  private saveToSessionStorage(): void {
    try {
      const all = this.screenRecorder.getEvents();
      const recent = this.screenRecorder.getRecentEvents();
      const rest = {
        harEntries:  this.networkCapture.snapshot(),
        consoleLogs: this.consoleCapture.snapshot(),
        savedAt:     new Date().toISOString(),
      };
      // 남은 이전 백업은 용량을 차지하고, 아래 시도가 모두 실패하면 다음 init()에 오래된 백업이 복원되므로 먼저 지운다
      sessionStorage.removeItem(SESSION_KEY);
      for (const events of recent.length < all.length ? [all, recent, []] : [all, []]) {
        try {
          sessionStorage.setItem(SESSION_KEY, JSON.stringify({ events, ...rest }));
          return;
        } catch {
          /* 용량 초과 — 더 작은 백업으로 다시 시도 */
        }
      }
    } catch {
      /* 녹화 전이거나 sessionStorage를 쓸 수 없는 환경 */
    }
  }

  private restoreFromSessionStorage(): void {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return;

      const backup = JSON.parse(raw) as {
        events: unknown[];
        harEntries: HAREntry[];
        consoleLogs: ConsoleEntry[];
      };

      this.screenRecorder.prependEvents(backup.events);
      this.networkCapture.restoreEntries(backup.harEntries);
      this.consoleCapture.restoreEntries(backup.consoleLogs);
    } catch {
      /* 손상된 데이터 무시 */
    } finally {
      sessionStorage.removeItem(SESSION_KEY);
    }
  }

  private async onButtonClick(): Promise<void> {
    const lifecycle = this.lifecycle;
    if (!lifecycle || this.activeSave) return;
    const token = {};
    this.activeSave = token;
    try {
      await this.confirmAndSave(lifecycle.signal);
    } catch (err) {
      // destroy()로 끊긴 흐름의 에러는 의도한 취소다
      if (!lifecycle.signal.aborted) console.error('[qa-recorder] save failed', err);
    } finally {
      if (this.activeSave === token) this.activeSave = null;
    }
  }

  /**
   * 확인 → 저장. 녹화는 멈추지 않는다: 저장할 데이터를 잘라 낸 뒤 새로 기록되는 데이터는 따로 쌓이고,
   * 저장에 성공하면 잘라 낸 데이터만 버리고, 실패하면 잘라 낸 데이터를 되돌려 다음 저장에 함께 넣는다.
   * await 뒤에는 항상 signal을 확인해 destroy() 후에는 녹화·버퍼·UI를 건드리지 않는다.
   */
  private async confirmAndSave(lifecycleSignal: AbortSignal): Promise<void> {
    const { confirmed, memo } = await ConfirmModal.show('Save this QA session?', { signal: lifecycleSignal });
    if (!confirmed || lifecycleSignal.aborted) return;

    // 이 저장만 취소하는 신호 — 진행 막대의 취소 버튼과 destroy() 둘 다 이 신호로 업로드·대기·다운로드를 멈춘다
    const save = new AbortController();
    const abortSave = () => save.abort();
    lifecycleSignal.addEventListener('abort', abortSave);
    const signal = save.signal;

    const snapshot = this.cutForSave();
    let outcome: SaveOutcome;
    try {
      this.dismissProgress = ProgressBar.show('Saving...', this.config.zIndex, { onCancel: abortSave });
      // 응답 헤더는 왔지만 본문을 아직 받는 중인 요청은 pendingBodyTimeout까지 기다린다 (끝나지 않는 스트림도 그 이상은 기다리지 않는다).
      // 그때까지 다 받지 못한 본문은 받은 부분만 'pending'으로 리포트에 넣고, 다음 저장에 다시 넣는다
      await this.networkCapture.waitForBodies(snapshot.network, this.config.pendingBodyTimeout, signal);
      if (signal.aborted) {
        outcome = { kind: 'aborted' };
      } else {
        snapshot.pendingBodies = this.networkCapture.markPendingBodies(snapshot.network);
        const har = HARBuilder.build(snapshot.network);
        const environment = collectEnvironment((url) => MaskingFilter.maskUrl(url, this.urlKeyMatcher));
        outcome = this.config.endpoint
          ? await this.uploadOrSaveLocally(this.config.endpoint, snapshot, har, memo, environment, signal)
          : await this.saveLocally(snapshot, har, memo, environment, signal);
      }
    } catch (err) {
      // 리포트 생성 등 예기치 못한 실패도 기록을 잃지 않도록 실패로 다룬다
      outcome = signal.aborted ? { kind: 'aborted' } : { kind: 'failed', saveError: err };
    } finally {
      lifecycleSignal.removeEventListener('abort', abortSave);
    }
    // destroy(): 녹화·버퍼·UI를 건드리지 않는다
    if (lifecycleSignal.aborted) return;

    let loss: RollbackLoss | undefined;
    if (outcome.kind === 'failed' || outcome.kind === 'aborted') {
      // 실패나 사용자의 취소: 잘라 낸 기록을 되돌려 다음 저장에 함께 넣는다.
      // 다운로드를 이미 시작했거나 업로드가 끝난 뒤에 누른 취소는 늦었으므로 저장한 것으로 다룬다(outcome이 saved·fallback)
      loss = this.rollbackSave(snapshot);
      if (outcome.kind === 'failed') outcome.loss = loss;
    } else {
      this.commitSave(snapshot);
    }

    // alert는 블로킹이므로 항상 진행 막대를 먼저 숨긴다
    this.dismissProgress?.();
    this.dismissProgress = null;
    if (outcome.kind === 'aborted') {
      // 사용자가 취소했다 — 안내하지 않는다. 다만 메모리 제한 때문에 기록 일부를 남기지 못했으면 알린다
      if (hasLoss(loss)) alert(`Save cancelled.\n${keptMessage(loss)}`);
      return;
    }
    this.notify(outcome);
  }

  /** 저장할 데이터를 잘라 낸다. 녹화와 네트워크·콘솔 캡처는 계속된다 */
  private cutForSave(): SaveSnapshot {
    return {
      screen: this.screenRecorder.cutForSave(),
      network: this.networkCapture.snapshot(),
      console: this.consoleCapture.snapshot(),
      cutAt: new Date(),
      pendingBodies: new Set(),
    };
  }

  /** 저장 성공: 저장한 데이터만 버리고 저장하는 동안 새로 기록된 데이터는 남긴다 */
  private commitSave(snapshot: SaveSnapshot): void {
    if (this.config.enableBackup) {
      try { sessionStorage.removeItem(SESSION_KEY); } catch { /* sessionStorage를 쓸 수 없는 환경 */ }
    }
    this.screenRecorder.commitSave(snapshot.screen);
    this.networkCapture.discard(snapshot.network, snapshot.pendingBodies);
    this.consoleCapture.discard(snapshot.console);
    // 남은 기록은 잘라 낸 시점에 시작한 새 구간에 속한다
    this.networkCapture.rebase(snapshot.cutAt);
    this.consoleCapture.rebase(snapshot.cutAt);
  }

  /**
   * 저장 실패: 아무것도 버리지 않는다. 잘라 낸 화면 녹화를 되돌려 다음 저장에 함께 넣는다.
   * 다만 메모리 제한 안에서만 남긴다 — 리플레이는 maxReplaySize, 네트워크·콘솔은 maxRequests·maxConsoleEntries
   * (저장하는 동안 새 기록이 들어와 오래된 것이 밀려났을 수 있다). 남기지 못한 수를 돌려준다.
   */
  private rollbackSave(snapshot: SaveSnapshot): RollbackLoss {
    const { droppedEvents } = this.screenRecorder.rollbackSave(snapshot.screen);
    return {
      replayEvents: droppedEvents,
      requests: this.networkCapture.countMissing(snapshot.network),
      consoleEntries: this.consoleCapture.countMissing(snapshot.console),
    };
  }

  private notify(outcome: Exclude<SaveOutcome, { kind: 'aborted' }>): void {
    switch (outcome.kind) {
      case 'saved':
        if (!outcome.uploaded) return;
        if (outcome.url) this.dismissShare = SharePanel.show(outcome.url, this.config.zIndex);
        else alert('Upload complete.');
        return;
      case 'fallback':
        alert(`Upload failed: ${errorMessage(outcome.uploadError)}\nA local ZIP was downloaded instead.`);
        return;
      case 'failed':
        alert(
          (outcome.uploadError === undefined ? '' : `Upload failed: ${errorMessage(outcome.uploadError)}\n`) +
          `Save failed: ${errorMessage(outcome.saveError)}\n` +
          keptMessage(outcome.loss),
        );
    }
  }

  /**
   * 원격 업로드. 실패하면(시간 초과 포함) 업로드에 쓰인 것과 같은 데이터로 로컬 ZIP 저장을 시도한다.
   * destroy()로 취소되면 대체 저장 없이 aborted.
   */
  private async uploadOrSaveLocally(
    endpoint: string,
    snapshot: SaveSnapshot,
    har: HARDocument,
    memo: string,
    environment: EnvironmentInfo,
    signal: AbortSignal,
  ): Promise<SaveOutcome> {
    const events = snapshot.screen.events;
    const consoleLogs = snapshot.console;
    try {
      const sessionBlob = new Blob([JSON.stringify(events)], { type: 'application/json' });
      // 서버가 따로 뷰어를 만들지 않아도 되도록 콘솔 로그와 통합 리포트, 환경 정보도 함께 보낸다
      const url = await new RemoteDelivery(endpoint).send(sessionBlob, har, memo, {
        consoleLogs,
        reportHtml: UnifiedViewer.generate(events, har.log, consoleLogs, memo, environment),
        environment,
      }, { timeout: this.config.uploadTimeout, signal });
      return { kind: 'saved', url, uploaded: true };
    } catch (uploadErr) {
      if (signal.aborted || isAbortError(uploadErr)) return { kind: 'aborted' };
      try {
        await LocalStorage.save(events, har, consoleLogs, memo, environment, { signal });
      } catch (saveErr) {
        if (signal.aborted) return { kind: 'aborted' };
        return { kind: 'failed', uploadError: uploadErr, saveError: saveErr };
      }
      return { kind: 'fallback', uploadError: uploadErr };
    }
  }

  /** 로컬 ZIP 저장 */
  private async saveLocally(
    snapshot: SaveSnapshot,
    har: HARDocument,
    memo: string,
    environment: EnvironmentInfo,
    signal: AbortSignal,
  ): Promise<SaveOutcome> {
    try {
      await LocalStorage.save(snapshot.screen.events, har, snapshot.console, memo, environment, { signal });
    } catch (err) {
      if (signal.aborted) return { kind: 'aborted' };
      return { kind: 'failed', saveError: err };
    }
    return { kind: 'saved', uploaded: false };
  }

  /**
   * 녹화를 끝내고 이 인스턴스가 만든 것을 모두 정리한다: fetch/XHR·console 패치, 이벤트 리스너, 버튼,
   * 확인창, 진행 막대, 공유 패널. 진행 중인 업로드와 로컬 저장은 취소되고(대체 저장이나 안내 없이),
   * 그 늦은 완료가 녹화를 다시 시작하거나 UI를 띄우지 않는다. 그 뒤 init()으로 새 녹화를 시작할 수 있다.
   */
  destroy(): void {
    const lifecycle = this.lifecycle;
    this.lifecycle = null;
    this.activeSave = null;
    lifecycle?.abort();
    this.networkCapture.stop();
    this.screenRecorder.stop();
    this.consoleCapture.stop();
    this.floatingButton.unmount();
    this.dismissProgress?.();
    this.dismissProgress = null;
    this.dismissShare?.();
    this.dismissShare = null;
    if (this.pageHideHandler) {
      window.removeEventListener('pagehide', this.pageHideHandler);
      this.pageHideHandler = null;
    }
    if (QARecorder._instance === this) {
      QARecorder._instance = null;
    }
  }

  /**
   * 지금 버퍼에 있는 네트워크 캡처 엔트리의 복사본 (저장할 때 `.har`로 내보내는 원본).
   * 캡처 형식이라 HAR 1.2의 cookies·cache 등 일부 필수 필드는 비어 있을 수 있다 — 표준 HAR은 저장된 파일을 쓴다.
   */
  getNetworkEntries(): HAREntry[] {
    return this.networkCapture.snapshot();
  }

  /** 데모/테스트용: 즉시 sessionStorage 백업 수행 */
  _saveBackupForDemo(): void {
    this.saveToSessionStorage();
  }
}
