import { buildStyles } from './styles.js';

export type ButtonState = 'idle' | 'recording';

export class FloatingButton {
  private host: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;

  constructor(private readonly onClick: () => void, private readonly zIndex = 2147483647) {}

  mount(): void {
    this.host = document.createElement('div');
    this.host.setAttribute('id', 'qa-recorder-root');
    this.shadow = this.host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = buildStyles(this.zIndex);

    const btn = document.createElement('button');
    btn.className = 'qa-floating-btn';
    btn.title = 'Start QA recording';
    btn.innerHTML = this._idleHTML();

    this._attachDrag(btn);

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

  private _attachDrag(btn: HTMLButtonElement): void {
    let wasDragged = false;

    btn.addEventListener('click', () => {
      if (wasDragged) { wasDragged = false; return; }
      this.onClick();
    });

    btn.addEventListener('mousedown', (e: MouseEvent) => {
      if (e.button !== 0) return;

      // Snapshot current position before switching to top/left.
      // Must use 'auto' (not '') to override bottom/right from the CSS class.
      const rect = btn.getBoundingClientRect();
      btn.style.bottom = 'auto';
      btn.style.right  = 'auto';
      btn.style.left   = rect.left + 'px';
      btn.style.top    = rect.top  + 'px';

      const startX = e.clientX;
      const startY = e.clientY;
      const origX  = rect.left;
      const origY  = rect.top;
      let dragged  = false;

      e.preventDefault(); // prevent text selection while dragging

      const onMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (!dragged && Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        dragged = true;
        btn.style.cursor = 'grabbing';

        const newX = Math.max(0, Math.min(window.innerWidth  - rect.width,  origX + dx));
        const newY = Math.max(0, Math.min(window.innerHeight - rect.height, origY + dy));
        btn.style.left = newX + 'px';
        btn.style.top  = newY + 'px';
      };

      const onUp = () => {
        if (dragged) wasDragged = true;
        btn.style.cursor = '';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
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
    `;
  }
}
