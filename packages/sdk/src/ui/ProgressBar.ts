import { buildStyles } from './styles.js';
import { excludeFromRecording } from './recordingExclusion.js';

export class ProgressBar {
  private static host: HTMLElement | null = null;
  private static shadow: ShadowRoot | null = null;

  static show(label = 'Uploading...', zIndex = 2147483647): void {
    if (this.host) return;

    this.host = document.createElement('div');
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
  }

  static hide(): void {
    this.host?.remove();
    this.host = null;
    this.shadow = null;
  }
}
