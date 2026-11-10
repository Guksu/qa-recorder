import { buildStyles } from './styles.js';
import { excludeFromRecording } from './recordingExclusion.js';

export interface ProgressBarOptions {
  /**
   * 주면 막대에 취소 버튼을 보이고, 누르면 한 번만 호출한다. 누른 뒤에는 버튼을 비활성화하고
   * 문구를 "Cancelling…"으로 바꾼다 (막대는 호출한 쪽이 작업을 정리한 뒤 닫는다).
   */
  onCancel?: () => void;
}

export class ProgressBar {
  private static host: HTMLElement | null = null;
  private static shadow: ShadowRoot | null = null;

  /**
   * 진행 막대를 표시하고, 이 호출이 띄운 막대만 닫는 함수를 반환한다.
   * 이미 표시 중이면 새로 띄우지 않고 아무것도 하지 않는 함수를 반환한다 — 다른 쪽이 띄운 막대를 닫지 않도록.
   */
  static show(label = 'Uploading...', zIndex = 2147483647, options: ProgressBarOptions = {}): () => void {
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
    const labelEl = wrap.querySelector<HTMLElement>('#label')!;
    labelEl.textContent = label;

    const { onCancel } = options;
    if (onCancel) {
      const row = document.createElement('div');
      row.className = 'qa-progress-row';
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'qa-progress-cancel';
      cancel.textContent = 'Cancel';
      cancel.setAttribute('aria-label', 'Cancel saving');
      cancel.addEventListener('click', () => {
        if (cancel.disabled) return;
        cancel.disabled = true;
        labelEl.textContent = 'Cancelling…';
        onCancel();
      });
      wrap.removeChild(labelEl);
      row.append(cancel, labelEl);
      wrap.appendChild(row);
    }

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
