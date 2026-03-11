import { BASE_STYLES } from './styles.js';

export class ProgressBar {
  private host: HTMLElement | null = null;
  private fill: HTMLElement | null = null;
  private label: HTMLElement | null = null;

  show(): void {
    this.host = document.createElement('div');
    const shadow = this.host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = BASE_STYLES;

    const wrap = document.createElement('div');
    wrap.className = 'qa-progress-bar-wrap';
    wrap.innerHTML = `
      <div class="qa-progress-track">
        <div class="qa-progress-fill" style="width:0%"></div>
      </div>
      <div class="qa-progress-label">업로드 중... 0%</div>
    `;

    this.fill = wrap.querySelector('.qa-progress-fill');
    this.label = wrap.querySelector('.qa-progress-label');

    shadow.append(style, wrap);
    document.body.appendChild(this.host);
  }

  update(progress: number): void {
    if (this.fill) this.fill.style.width = `${progress}%`;
    if (this.label) this.label.textContent = `업로드 중... ${progress}%`;
  }

  hide(): void {
    this.host?.remove();
    this.host = null;
  }
}
