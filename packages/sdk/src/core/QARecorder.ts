import { resolveConfig, type QARecorderConfig } from './config.js';
import { NetworkCapture } from '../network/NetworkCapture.js';
import { ScreenRecorder } from '../recorder/ScreenRecorder.js';
import { FloatingButton } from '../ui/FloatingButton.js';
import { ProgressBar } from '../ui/ProgressBar.js';
import { SharePanel } from '../ui/SharePanel.js';
import { LocalStorage } from '../storage/LocalStorage.js';
import { RemoteDelivery } from '../storage/RemoteDelivery.js';
import { HARBuilder } from '../network/HARBuilder.js';

export class QARecorder {
  private config: Required<QARecorderConfig>;
  private networkCapture: NetworkCapture;
  private screenRecorder: ScreenRecorder;
  private floatingButton: FloatingButton;

  constructor(overrides?: QARecorderConfig) {
    this.config = resolveConfig(overrides);
    this.networkCapture = new NetworkCapture(this.config.maxRequests, this.config.maskHeaders);
    this.screenRecorder = new ScreenRecorder();
    this.floatingButton = new FloatingButton(this.onButtonClick.bind(this), this.config.zIndex);
  }

  /** 페이지 로드 후 초기화 — 즉시 녹화 시작 + 버튼 노출 */
  async init(): Promise<void> {
    this.networkCapture.start();
    this.screenRecorder.start();
    this.floatingButton.mount();
    this.floatingButton.setState('recording');
  }

  private async onButtonClick(): Promise<void> {
    this.screenRecorder.stop();

    const harLog = HARBuilder.build(this.networkCapture.snapshot());

    ProgressBar.show('Saving...', this.config.zIndex);

    if (this.config.endpoint) {
      try {
        const url = await new RemoteDelivery(this.config.endpoint).send(
          this.screenRecorder.getBlob(),
          harLog,
        );
        ProgressBar.hide();
        if (url) SharePanel.show(url, this.config.zIndex);
      } catch (err) {
        ProgressBar.hide();
        alert(`Upload failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      await LocalStorage.save(this.screenRecorder.getEvents(), harLog);
      ProgressBar.hide();
    }

    this.screenRecorder.reset();
    this.networkCapture.clearBuffer();
    this.screenRecorder.start();
    this.floatingButton.setState('recording');
  }

  /** 수동으로 녹화 중지 및 리소스 정리 */
  destroy(): void {
    this.networkCapture.stop();
    this.screenRecorder.stop();
    this.floatingButton.unmount();
  }

  /** 디버그용: 현재 캡처된 네트워크 엔트리 반환 */
  getNetworkEntries() {
    return this.networkCapture.snapshot();
  }
}
