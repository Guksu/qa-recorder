import { buildStyles } from './styles.js';

export class SharePanel {
  private static host: HTMLElement | null = null;

  static show(url: string, zIndex = 2147483647): void {
    // 이미 표시 중이면 교체하여 항상 최신 URL을 노출
    if (this.host) this.hide();

    this.host = document.createElement('div');
    this.host.setAttribute('data-qa', 'share-panel');
    const shadow = this.host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = buildStyles(zIndex);

    const panel = document.createElement('div');
    panel.className = 'qa-share-panel';
    panel.innerHTML = `
      <div class="qa-share-title">Saved</div>
      <div class="qa-share-url"></div>
      <button class="qa-copy-btn">Copy link</button>
    `;
    // 서버가 내려준 값이므로 HTML로 해석되지 않도록 textContent로 삽입
    panel.querySelector('.qa-share-url')!.textContent = url;

    panel.querySelector('.qa-copy-btn')!.addEventListener('click', () => {
      navigator.clipboard.writeText(url);
    });

    shadow.append(style, panel);
    document.body.appendChild(this.host);
  }

  static hide(): void {
    this.host?.remove();
    this.host = null;
  }
}
