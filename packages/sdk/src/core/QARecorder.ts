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
import type { HAREntry, HARLog } from '@qa-recorder/shared';
import type { ConsoleEntry } from '../console/ConsoleCapture.js';

const SESSION_KEY = 'qa-recorder-backup';

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

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
  private networkCapture: NetworkCapture;
  private screenRecorder: ScreenRecorder;
  private consoleCapture: ConsoleCapture;
  private floatingButton: FloatingButton;
  private pageHideHandler: (() => void) | null = null;
  private initialized = false;
  /** 확인창이 떠 있거나 저장 중인지 — 그동안 버튼이 다시 눌려도(키보드 Enter 등) 저장을 한 번만 진행한다 */
  private saving = false;

  constructor(overrides?: QARecorderConfig) {
    this.config = resolveConfig(overrides);
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
    });
    this.consoleCapture = new ConsoleCapture(this.config.maxConsoleEntries, this.config.consoleLevels);
    this.floatingButton = new FloatingButton(this.onButtonClick.bind(this), this.config.zIndex);
  }

  async init(): Promise<void> {
    // 두 번 호출하면 버튼과 pagehide 리스너가 중복되고 가로채기가 겹치므로 한 번만 시작한다 (destroy() 후에는 다시 가능)
    if (this.initialized) return;
    this.initialized = true;

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

  private saveToSessionStorage(): void {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({
        events:      this.screenRecorder.getEvents(),
        harEntries:  this.networkCapture.snapshot(),
        consoleLogs: this.consoleCapture.snapshot(),
        savedAt:     new Date().toISOString(),
      }));
    } catch {
      /* sessionStorage 용량 초과 시 무시 */
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
    if (this.saving) return;
    this.saving = true;
    try {
      await this.confirmAndSave();
    } finally {
      this.saving = false;
    }
  }

  private async confirmAndSave(): Promise<void> {
    const { confirmed, memo } = await ConfirmModal.show('Save this QA session?');
    if (!confirmed) return;

    this.screenRecorder.stop();

    const harLog = HARBuilder.build(this.networkCapture.snapshot());
    const consoleLogs = this.consoleCapture.snapshot();

    ProgressBar.show('Saving...', this.config.zIndex);

    const saved = this.config.endpoint
      ? await this.uploadOrSaveLocally(this.config.endpoint, harLog, consoleLogs, memo)
      : await this.saveLocally(harLog, consoleLogs, memo);

    if (saved) {
      if (this.config.enableBackup) {
        sessionStorage.removeItem(SESSION_KEY);
      }

      this.screenRecorder.reset();
      this.networkCapture.clearBuffer();
      this.consoleCapture.clearBuffer();
      this.screenRecorder.start();
    } else {
      /* 저장 실패 — 버퍼를 비우지 않고 기존 이벤트 뒤에 이어서 녹화해 다시 저장할 수 있게 한다 */
      this.screenRecorder.resume();
    }
    this.floatingButton.setState('recording');
  }

  /**
   * 원격 업로드. 실패하면 업로드에 쓰인 것과 같은 데이터로 로컬 ZIP 저장을 시도한다.
   * 둘 중 하나라도 성공하면 true. alert는 블로킹이므로 항상 ProgressBar를 먼저 숨긴다.
   */
  private async uploadOrSaveLocally(
    endpoint: string,
    harLog: HARLog,
    consoleLogs: ConsoleEntry[],
    memo: string,
  ): Promise<boolean> {
    let events: unknown[] | undefined;
    let url: string | undefined;
    try {
      // 대체 저장에도 같은 이벤트를 쓰도록 한 번만 읽는다 — rrweb은 stop() 후에도
      // throttle된 콜백(mousemove 등)의 trailing 타이머로 이벤트를 늦게 emit할 수 있다
      events = this.screenRecorder.getEvents();
      const sessionBlob = new Blob([JSON.stringify(events)], { type: 'application/json' });
      url = await new RemoteDelivery(endpoint).send(sessionBlob, harLog, memo);
    } catch (uploadErr) {
      try {
        await LocalStorage.save(events ?? this.screenRecorder.getEvents(), harLog, consoleLogs, memo);
      } catch (saveErr) {
        ProgressBar.hide();
        alert(
          `Upload failed: ${errorMessage(uploadErr)}\n` +
          `Save failed: ${errorMessage(saveErr)}\n` +
          'The recording was kept. Please try again.',
        );
        return false;
      }
      ProgressBar.hide();
      alert(`Upload failed: ${errorMessage(uploadErr)}\nA local ZIP was downloaded instead.`);
      return true;
    }

    ProgressBar.hide();
    if (url) SharePanel.show(url, this.config.zIndex);
    else alert('Upload complete.');
    return true;
  }

  /** 로컬 ZIP 저장. 성공하면 true */
  private async saveLocally(harLog: HARLog, consoleLogs: ConsoleEntry[], memo: string): Promise<boolean> {
    try {
      await LocalStorage.save(this.screenRecorder.getEvents(), harLog, consoleLogs, memo);
    } catch (err) {
      ProgressBar.hide();
      alert(`Save failed: ${errorMessage(err)}\nThe recording was kept. Please try again.`);
      return false;
    }
    ProgressBar.hide();
    return true;
  }

  destroy(): void {
    this.initialized = false;
    this.networkCapture.stop();
    this.screenRecorder.stop();
    this.consoleCapture.stop();
    this.floatingButton.unmount();
    if (this.pageHideHandler) {
      window.removeEventListener('pagehide', this.pageHideHandler);
      this.pageHideHandler = null;
    }
    if (QARecorder._instance === this) {
      QARecorder._instance = null;
    }
  }

  getNetworkEntries() {
    return this.networkCapture.snapshot();
  }

  /** 데모/테스트용: 즉시 sessionStorage 백업 수행 */
  _saveBackupForDemo(): void {
    this.saveToSessionStorage();
  }
}
