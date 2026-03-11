import { BASE_STYLES } from './styles.js';

export class ConfirmModal {
  static show(message: string): Promise<boolean> {
    return new Promise((resolve) => {
      const host = document.createElement('div');
      const shadow = host.attachShadow({ mode: 'closed' });

      const style = document.createElement('style');
      style.textContent = BASE_STYLES;

      const overlay = document.createElement('div');
      overlay.className = 'qa-modal-overlay';
      overlay.innerHTML = `
        <div class="qa-modal">
          <h3>${message}</h3>
          <div class="qa-modal-actions">
            <button class="qa-btn qa-btn-secondary" id="cancel">취소</button>
            <button class="qa-btn qa-btn-primary" id="confirm">확인</button>
          </div>
        </div>
      `;

      const cleanup = (result: boolean) => {
        host.remove();
        resolve(result);
      };

      overlay.querySelector('#confirm')!.addEventListener('click', () => cleanup(true));
      overlay.querySelector('#cancel')!.addEventListener('click', () => cleanup(false));

      shadow.append(style, overlay);
      document.body.appendChild(host);
    });
  }
}
