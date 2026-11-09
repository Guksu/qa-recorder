import { BASE_STYLES } from './styles.js';
import { excludeFromRecording } from './recordingExclusion.js';

export interface ConfirmResult {
  confirmed: boolean;
  memo: string;
}

export interface ConfirmModalOptions {
  /** 취소 신호 (녹화기 destroy() 등). 취소되면 확인창을 닫고 { confirmed: false }로 끝난다 */
  signal?: AbortSignal;
}

export class ConfirmModal {
  static show(message: string, options: ConfirmModalOptions = {}): Promise<ConfirmResult> {
    const { signal } = options;
    return new Promise((resolve) => {
      if (signal?.aborted) {
        resolve({ confirmed: false, memo: '' });
        return;
      }
      const host = document.createElement('div');
      host.setAttribute('data-qa', 'confirm-modal');
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
          resize: none;
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
          <h3></h3>
          <label class="qa-memo-label">Bug memo (optional)</label>
          <textarea class="qa-memo-textarea" id="qa-memo" placeholder="Describe what happened..."></textarea>
          <div class="qa-modal-actions">
            <button class="qa-btn qa-btn-secondary" id="cancel">Cancel</button>
            <button class="qa-btn qa-btn-primary" id="confirm">Save</button>
          </div>
        </div>
      `;

      // 문구를 HTML로 해석하지 않도록 textContent로 넣는다
      overlay.querySelector('h3')!.textContent = message;

      let settled = false;
      const cleanup = (confirmed: boolean) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', onAbort);
        const textarea = shadow.querySelector<HTMLTextAreaElement>('#qa-memo');
        const memo = confirmed ? (textarea?.value.trim() ?? '') : '';
        host.remove();
        resolve({ confirmed, memo });
      };
      const onAbort = () => cleanup(false);
      signal?.addEventListener('abort', onAbort);

      overlay.querySelector('#confirm')!.addEventListener('click', () => cleanup(true));
      overlay.querySelector('#cancel')!.addEventListener('click', () => cleanup(false));

      excludeFromRecording(host, style, overlay);
      shadow.append(style, overlay);
      document.body.appendChild(host);
    });
  }
}
