import { buildStyles } from './styles.js';
import { excludeFromRecording } from './recordingExclusion.js';

const COPY_LABEL = 'Copy link';

/**
 * 클립보드에 복사. navigator.clipboard는 https(와 localhost)에서만 있고 권한이 거부될 수도 있으므로,
 * 실패하면 예전 방식(document.execCommand('copy'))으로 다시 시도한다. 복사했으면 true.
 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 아래 방법으로 재시도 */
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  excludeFromRecording(textarea);
  document.body.appendChild(textarea);
  textarea.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}

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
      <div class="qa-share-head">
        <div class="qa-share-title">Saved</div>
        <button class="qa-share-close" title="Close" aria-label="Close">&times;</button>
      </div>
      <div class="qa-share-url"></div>
      <button class="qa-copy-btn">${COPY_LABEL}</button>
    `;
    // 서버가 내려준 값이므로 HTML로 해석되지 않도록 textContent로 삽입
    panel.querySelector('.qa-share-url')!.textContent = url;

    const copyBtn = panel.querySelector<HTMLButtonElement>('.qa-copy-btn')!;
    copyBtn.addEventListener('click', () => {
      void copyText(url).then((copied) => {
        copyBtn.textContent = copied ? 'Copied!' : 'Copy failed — select the link above';
        setTimeout(() => { copyBtn.textContent = COPY_LABEL; }, 2000);
      });
    });
    panel.querySelector('.qa-share-close')!.addEventListener('click', () => SharePanel.hide());

    excludeFromRecording(this.host, style, panel);
    shadow.append(style, panel);
    document.body.appendChild(this.host);
  }

  static hide(): void {
    this.host?.remove();
    this.host = null;
  }
}
