import { BASE_STYLES } from './styles.js';

export class FloatingButton {
  private host: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;

  constructor(private readonly onClick: () => void) {}

  mount(): void {
    this.host = document.createElement('div');
    this.host.setAttribute('id', 'qa-recorder-root');
    this.shadow = this.host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = BASE_STYLES;

    const btn = document.createElement('button');
    btn.className = 'qa-floating-btn';
    btn.title = 'QA 녹화 저장';
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="8"/>
      </svg>
    `;
    btn.addEventListener('click', this.onClick);

    this.shadow.append(style, btn);
    document.body.appendChild(this.host);
  }

  unmount(): void {
    this.host?.remove();
    this.host = null;
    this.shadow = null;
  }
}
