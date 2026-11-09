import { buildStyles } from './styles.js';
import { excludeFromRecording } from './recordingExclusion.js';

export class ProgressBar {
  private static host: HTMLElement | null = null;
  private static shadow: ShadowRoot | null = null;

  /**
   * 진행 막대를 표시하고, 이 호출이 띄운 막대만 닫는 함수를 반환한다.
   * 이미 표시 중이면 새로 띄우지 않고 아무것도 하지 않는 함수를 반환한다 — 다른 쪽이 띄운 막대를 닫지 않도록.
   */
  static show(label = 'Uploading...', zIndex = 2147483647): () => void {
    if (this.host) return () => {};

    const host = document.createElement('div');
    this.host = host;
    this.host.setAttribute('data-qa', 'progress-bar');
    this.shadow = this.host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = buildStyles(zIndex);

    const wrap = document.createElement('div');
    wrap.className = 'qa-progress-bar-wrap';
    // 실제 진행률을 알 수 없으므로 계속 움직이는 막대로 "작업 중"만 보여준다
    wrap.innerHTML = `
      <div class="qa-progress-track">
        <div class="qa-progress-fill" id="fill"></div>
      </div>
      <div class="qa-progress-label" id="label"></div>
    `;
    // 문구를 HTML로 해석하지 않도록 textContent로 넣는다
    wrap.querySelector('#label')!.textContent = label;

    excludeFromRecording(this.host, style, wrap);
    this.shadow.append(style, wrap);
    document.body.appendChild(this.host);
    return () => {
      if (this.host === host) this.hide();
    };
  }

  static hide(): void {
    this.host?.remove();
    this.host = null;
    this.shadow = null;
  }
}
