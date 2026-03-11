import { resolveConfig, type QARecorderConfig } from './config.js';
import { NetworkCapture } from '../network/NetworkCapture.js';
import { ScreenRecorder } from '../recorder/ScreenRecorder.js';
import { FloatingButton } from '../ui/FloatingButton.js';
import { ConfirmModal } from '../ui/ConfirmModal.js';
import { LocalStorage } from '../storage/LocalStorage.js';
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

  /** 페이지 로드 후 자동 시작 */
  async init(): Promise<void> {
    this.networkCapture.start();
    this.floatingButton.mount();
    await this.screenRecorder.start();
  }

  private async onButtonClick(): Promise<void> {
    const confirmed = await ConfirmModal.show('현재까지의 내용을 저장하시겠습니까?');
    if (!confirmed) return;

    await this.screenRecorder.stop();
    const videoBlob = this.screenRecorder.getBlob();
    const networkEntries = this.networkCapture.snapshot();
    const harLog = HARBuilder.build(networkEntries);

    await LocalStorage.save(videoBlob, harLog);
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
