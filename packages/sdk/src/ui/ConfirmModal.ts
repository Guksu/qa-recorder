import { BASE_STYLES } from './styles.js';

export interface ConfirmResult {
  confirmed: boolean;
  memo: string;
}

export class ConfirmModal {
  static show(message: string): Promise<ConfirmResult> {
    return new Promise((resolve) => {
      const host = document.createElement('div');
      const shadow = host.attachShadow({ mode: 'open' });

      const style = document.createElement('style');
      style.textContent = BASE_STYLES + `
        .qa-memo-label {
          display: block;
          font-size: 12px;
          color: #64748b;
          margin: 12px 0 6px;
        }
        .qa-memo-textarea {
          width: 100%;
          height: 72px;
          padding: 8px 10px;
          border: 1px solid #e2e8f0;
          border-radius: 6px;
          font-size: 12px;
          font-family: inherit;
          resize: vertical;
          outline: none;
          box-sizing: border-box;
          color: #0f172a;
        }
        .qa-memo-textarea:focus { border-color: #ef4444; }
      `;

      const overlay = document.createElement('div');
      overlay.className = 'qa-modal-overlay';
      overlay.innerHTML = `
        <div class="qa-modal">
          <h3>${message}</h3>
          <p>The last 20 minutes of DOM session and network log will be downloaded.</p>
          <label class="qa-memo-label">Bug memo (optional)</label>
          <textarea class="qa-memo-textarea" id="qa-memo" placeholder="Describe what happened..."></textarea>
          <div class="qa-modal-actions">
            <button class="qa-btn qa-btn-secondary" id="cancel">Cancel</button>
            <button class="qa-btn qa-btn-primary" id="confirm">Save</button>
          </div>
        </div>
      `;

      const cleanup = (confirmed: boolean) => {
        const textarea = shadow.querySelector<HTMLTextAreaElement>('#qa-memo');
        const memo = confirmed ? (textarea?.value.trim() ?? '') : '';
        host.remove();
        resolve({ confirmed, memo });
      };

      overlay.querySelector('#confirm')!.addEventListener('click', () => cleanup(true));
      overlay.querySelector('#cancel')!.addEventListener('click', () => cleanup(false));

      shadow.append(style, overlay);
      document.body.appendChild(host);
    });
  }
}
