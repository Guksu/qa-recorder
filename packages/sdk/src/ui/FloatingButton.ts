import { BASE_STYLES } from './styles.js';

export type ButtonState = 'idle' | 'recording';

export class FloatingButton {
  private host: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;

  constructor(private readonly onClick: () => void) {}

  mount(): void {
    this.host = document.createElement('div');
    this.host.setAttribute('id', 'qa-recorder-root');
    this.shadow = this.host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = BASE_STYLES;

    const btn = document.createElement('button');
    btn.className = 'qa-floating-btn';
    btn.title = 'Start QA recording';
    btn.innerHTML = this._idleHTML();
    btn.addEventListener('click', this.onClick);

    this.shadow.append(style, btn);
    document.body.appendChild(this.host);
  }

  setState(state: ButtonState): void {
    const btn = this.shadow?.querySelector('button');
    if (!btn) return;
    if (state === 'recording') {
      btn.title = 'Stop and save recording';
      btn.classList.add('qa-floating-btn--recording');
      btn.innerHTML = this._recordingHTML();
    } else {
      btn.title = 'Start QA recording';
      btn.classList.remove('qa-floating-btn--recording');
      btn.innerHTML = this._idleHTML();
    }
  }

  unmount(): void {
    this.host?.remove();
    this.host = null;
    this.shadow = null;
  }

  private _idleHTML(): string {
    return `
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="8"/>
      </svg>
      <span class="qa-idle-label">QA Recorder</span>
    `;
  }

  private _recordingHTML(): string {
    return `
      <span class="qa-rec-dot"></span>
      <span class="qa-rec-label">REC</span>
      <span class="qa-rec-divider"></span>
      <span class="qa-save-label">Save</span>
    `;
  }
}
