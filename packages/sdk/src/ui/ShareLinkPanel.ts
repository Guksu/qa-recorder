import { BASE_STYLES } from './styles.js';

export class ShareLinkPanel {
  static show(shareUrl: string): void {
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = BASE_STYLES;

    const panel = document.createElement('div');
    panel.className = 'qa-share-panel';
    panel.innerHTML = `
      <div class="qa-share-url">${shareUrl}</div>
      <button class="qa-copy-btn">링크 복사</button>
    `;

    panel.querySelector('.qa-copy-btn')!.addEventListener('click', async () => {
      await navigator.clipboard.writeText(shareUrl);
      (panel.querySelector('.qa-copy-btn') as HTMLButtonElement).textContent = '복사됨!';
      setTimeout(() => host.remove(), 2000);
    });

    shadow.append(style, panel);
    document.body.appendChild(host);
  }
}
