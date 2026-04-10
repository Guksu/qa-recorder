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

const SESSION_KEY = 'qa-recorder-backup';

export class QARecorder {
  private config: Required<QARecorderConfig>;
  private networkCapture: NetworkCapture;
  private screenRecorder: ScreenRecorder;
  private consoleCapture: ConsoleCapture;
  private floatingButton: FloatingButton;
  private pageHideHandler: (() => void) | null = null;

  constructor(overrides?: QARecorderConfig) {
    this.config = resolveConfig(overrides);
    this.networkCapture = new NetworkCapture(this.config.maxRequests, this.config.maskHeaders);
    this.screenRecorder = new ScreenRecorder();
    this.consoleCapture = new ConsoleCapture(this.config.maxConsoleEntries, this.config.consoleLevels);
    this.floatingButton = new FloatingButton(this.onButtonClick.bind(this), this.config.zIndex);
  }

  async init(): Promise<void> {
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
        harEntries: Parameters<typeof this.networkCapture.restoreEntries>[0];
        consoleLogs: Parameters<typeof this.consoleCapture.restoreEntries>[0];
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
    const { confirmed, memo } = await ConfirmModal.show('Save this QA session?');
    if (!confirmed) return;

    this.screenRecorder.stop();

    const harLog = HARBuilder.build(this.networkCapture.snapshot());
    const consoleLogs = this.consoleCapture.snapshot();

    ProgressBar.show('Saving...', this.config.zIndex);

    if (this.config.endpoint) {
      try {
        const url = await new RemoteDelivery(this.config.endpoint).send(
          this.screenRecorder.getBlob(),
          harLog,
          memo,
        );
        ProgressBar.hide();
        if (url) SharePanel.show(url, this.config.zIndex);
      } catch (err) {
        ProgressBar.hide();
        alert(`Upload failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      await LocalStorage.save(this.screenRecorder.getEvents(), harLog, consoleLogs, memo);
      ProgressBar.hide();
    }

    if (this.config.enableBackup) {
      sessionStorage.removeItem(SESSION_KEY);
    }

    this.screenRecorder.reset();
    this.networkCapture.clearBuffer();
    this.consoleCapture.clearBuffer();
    this.screenRecorder.start();
    this.floatingButton.setState('recording');
  }

  destroy(): void {
    this.networkCapture.stop();
    this.screenRecorder.stop();
    this.consoleCapture.stop();
    this.floatingButton.unmount();
    if (this.pageHideHandler) {
      window.removeEventListener('pagehide', this.pageHideHandler);
      this.pageHideHandler = null;
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
