import { resolveConfig, type QARecorderConfig } from './config.js';
import { NetworkCapture } from '../network/NetworkCapture.js';
import { ScreenRecorder } from '../recorder/ScreenRecorder.js';
import { FloatingButton } from '../ui/FloatingButton.js';
import { ConfirmModal } from '../ui/ConfirmModal.js';
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
    this.floatingButton = new FloatingButton(this.onButtonClick.bind(this));
  }

  private isRecording = false;

  /** 페이지 로드 후 초기화 — 버튼 노출 및 네트워크 캡처 시작 */
  async init(): Promise<void> {
    this.networkCapture.start();
    this.floatingButton.mount();
  }

  private async onButtonClick(): Promise<void> {
    if (!this.isRecording) {
      this.networkCapture.clearBuffer();
      this.screenRecorder.start();
      this.isRecording = true;
      this.floatingButton.setState('recording');
      return;
    }

    const confirmed = await ConfirmModal.show('현재까지의 내용을 저장하시겠습니까?');
    if (!confirmed) return;

    this.screenRecorder.stop();
    this.isRecording = false;
    this.floatingButton.setState('idle');

    const harLog = HARBuilder.build(this.networkCapture.snapshot());

    if (this.config.endpoint) {
      ProgressBar.show('업로드 중...');
      try {
        const url = await new RemoteDelivery(this.config.endpoint).send(
          this.screenRecorder.getBlob(),
          harLog,
        );
        ProgressBar.hide();
        if (url) SharePanel.show(url);
      } catch (err) {
        ProgressBar.hide();
        alert(`업로드 실패: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      await LocalStorage.save(this.screenRecorder.getEvents(), harLog);
    }

    this.screenRecorder.reset();
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
