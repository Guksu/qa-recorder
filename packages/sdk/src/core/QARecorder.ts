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
import { IndexedDBBackup } from '../storage/IndexedDBBackup.js';
import { HARBuilder } from '../network/HARBuilder.js';

export class QARecorder {
  private config: Required<QARecorderConfig>;
  private networkCapture: NetworkCapture;
  private screenRecorder: ScreenRecorder;
  private consoleCapture: ConsoleCapture;
  private floatingButton: FloatingButton;
  private visibilityHandler: (() => void) | null = null;

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
      /* 이전 세션 백업이 있으면 현재 세션 버퍼에 복원 */
      if (await IndexedDBBackup.hasData()) {
        await this.restoreFromBackup();
      }

      /* visibilitychange(hidden) 시 세션을 IDB에 저장 — pagehide보다 먼저 발생하여 async IDB 쓰기 완료 가능 */
      this.visibilityHandler = () => {
        if (document.visibilityState === 'hidden') { void this.saveBackup(); }
      };
      document.addEventListener('visibilitychange', this.visibilityHandler);
    }
  }

  private async restoreFromBackup(): Promise<void> {
    const backup = await IndexedDBBackup.load();
    if (!backup) return;

    this.screenRecorder.prependEvents(backup.events);
    this.networkCapture.restoreEntries(
      backup.harEntries as Parameters<typeof this.networkCapture.restoreEntries>[0],
    );
    this.consoleCapture.restoreEntries(
      backup.consoleLogs as Parameters<typeof this.consoleCapture.restoreEntries>[0],
    );

    await IndexedDBBackup.clear();
  }

  async saveBackup(): Promise<void> {
    await IndexedDBBackup.save({
      events:      this.screenRecorder.getEvents() ?? [],
      harEntries:  this.networkCapture.snapshot(),
      consoleLogs: this.consoleCapture.snapshot(),
      savedAt:     new Date().toISOString(),
    });
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
      await IndexedDBBackup.clear();
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
    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
    }
  }

  getNetworkEntries() {
    return this.networkCapture.snapshot();
  }

  /** 데모/테스트용: 즉시 IndexedDB 백업 수행 */
  _saveBackupForDemo(): Promise<void> {
    return this.saveBackup();
  }
}
