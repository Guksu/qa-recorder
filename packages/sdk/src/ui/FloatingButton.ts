import { buildStyles } from './styles.js';
import { excludeFromRecording } from './recordingExclusion.js';

export type ButtonState = 'idle' | 'recording';

export class FloatingButton {
  private host: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;
  private state: ButtonState = 'idle';
  /** body가 생기기 전에 mount()된 경우 DOMContentLoaded에서 실행할 마운트 */
  private pendingMount: (() => void) | null = null;

  constructor(private readonly onClick: () => void, private readonly zIndex = 2147483647) {}

  mount(): void {
    // 이미 마운트됐거나 마운트를 기다리는 중이면 버튼을 하나 더 만들지 않는다
    if (this.host || this.pendingMount) return;
    // <head>의 script에서 init()하면 body가 아직 없다 — HTML 파싱이 끝나면 붙인다
    if (!document.body) {
      this.pendingMount = () => {
        this.pendingMount = null;
        this.mount();
      };
      document.addEventListener('DOMContentLoaded', this.pendingMount, { once: true });
      return;
    }

    this.host = document.createElement('div');
    this.host.setAttribute('id', 'qa-recorder-root');
    this.shadow = this.host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = buildStyles(this.zIndex);

    const btn = document.createElement('button');
    btn.className = 'qa-floating-btn';

    this._attachDrag(btn);

    excludeFromRecording(this.host, style, btn);
    this.shadow.append(style, btn);
    document.body.appendChild(this.host);
    // 마운트 전에 setState()로 정한 상태를 반영
    this._render(btn);
  }

  setState(state: ButtonState): void {
    this.state = state;
    const btn = this.shadow?.querySelector('button');
    if (btn) this._render(btn);
  }

  unmount(): void {
    if (this.pendingMount) {
      document.removeEventListener('DOMContentLoaded', this.pendingMount);
      this.pendingMount = null;
    }
    this.host?.remove();
    this.host = null;
    this.shadow = null;
  }

  private _render(btn: HTMLButtonElement): void {
    if (this.state === 'recording') {
      btn.title = 'Stop and save recording';
      btn.classList.add('qa-floating-btn--recording');
      btn.innerHTML = this._recordingHTML();
    } else {
      btn.title = 'Start QA recording';
      btn.classList.remove('qa-floating-btn--recording');
      btn.innerHTML = this._idleHTML();
    }
  }

  private _attachDrag(btn: HTMLButtonElement): void {
    let wasDragged = false;

    btn.addEventListener('click', () => {
      if (wasDragged) { wasDragged = false; return; }
      this.onClick();
    });

    // pointer 이벤트라 마우스·터치·펜 모두로 끌어 옮길 수 있다 (터치에서 화면이 스크롤되지 않게 CSS touch-action: none)
    btn.addEventListener('pointerdown', (e: PointerEvent) => {
      // 마우스는 왼쪽 버튼만 (터치·펜의 button도 0)
      if (e.button !== 0) return;
      // 지난 드래그를 버튼 밖에서 끝내 click이 오지 않았으면 표시가 남아 다음 클릭을 삼킨다 — 새로 누를 때 지운다
      wasDragged = false;

      // Snapshot current position before switching to top/left.
      // Must use 'auto' (not '') to override bottom/right from the CSS class.
      const rect = btn.getBoundingClientRect();
      btn.style.bottom = 'auto';
      btn.style.right  = 'auto';
      btn.style.left   = rect.left + 'px';
      btn.style.top    = rect.top  + 'px';

      const pointerId = e.pointerId;
      const startX = e.clientX;
      const startY = e.clientY;
      const origX  = rect.left;
      const origY  = rect.top;
      let dragged  = false;

      e.preventDefault(); // prevent text selection while dragging

      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return; // 다른 손가락·포인터는 무시
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

      const onUp = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        if (dragged) wasDragged = true;
        btn.style.cursor = '';
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onUp);
      };

      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
      // 브라우저가 제스처를 가져가면(pointercancel) 드래그를 끝낸다
      document.addEventListener('pointercancel', onUp);
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
