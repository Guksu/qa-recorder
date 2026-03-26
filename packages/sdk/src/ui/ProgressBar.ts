import { BASE_STYLES } from './styles.js';

export class ProgressBar {
  private static host: HTMLElement | null = null;
  private static shadow: ShadowRoot | null = null;

  static show(label = 'Uploading...'): void {
    if (this.host) return;

    this.host = document.createElement('div');
    this.host.setAttribute('data-qa', 'progress-bar');
    this.shadow = this.host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = BASE_STYLES;

    const wrap = document.createElement('div');
    wrap.className = 'qa-progress-bar-wrap';
    wrap.innerHTML = `
      <div class="qa-progress-track">
        <div class="qa-progress-fill" id="fill" style="width:0%"></div>
      </div>
      <div class="qa-progress-label" id="label">${label}</div>
    `;

    this.shadow.append(style, wrap);
    document.body.appendChild(this.host);
  }

  static update(percent: number): void {
    if (!this.shadow) return;
    const fill = this.shadow.querySelector<HTMLElement>('#fill');
    if (fill) fill.style.width = `${percent}%`;
  }

  static hide(): void {
    this.host?.remove();
    this.host = null;
    this.shadow = null;
  }
}
