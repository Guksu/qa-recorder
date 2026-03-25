export const BASE_STYLES = `
  :host {
    all: initial;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }

  .qa-floating-btn {
    position: fixed;
    bottom: 24px;
    right: 24px;
    width: 52px;
    height: 52px;
    border-radius: 50%;
    background: #e53e3e;
    border: none;
    cursor: pointer;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 2147483647;
    transition: transform 0.1s ease;
  }
  .qa-floating-btn:hover { transform: scale(1.1); }
  .qa-floating-btn svg { width: 24px; height: 24px; fill: white; }
  .qa-floating-btn--recording { animation: qa-pulse 1.5s ease-in-out infinite; }
  @keyframes qa-pulse {
    0%, 100% { box-shadow: 0 4px 12px rgba(0,0,0,0.3); }
    50% { box-shadow: 0 4px 20px rgba(229,62,62,0.8); }
  }

  .qa-modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 2147483647;
  }
  .qa-modal {
    background: white;
    border-radius: 12px;
    padding: 24px;
    max-width: 360px;
    width: 90%;
    box-shadow: 0 20px 40px rgba(0,0,0,0.2);
  }
  .qa-modal h3 { margin: 0 0 16px; font-size: 16px; color: #1a202c; }
  .qa-modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 20px; }
  .qa-btn { padding: 8px 16px; border-radius: 6px; border: none; cursor: pointer; font-size: 14px; }
  .qa-btn-primary { background: #e53e3e; color: white; }
  .qa-btn-secondary { background: #edf2f7; color: #4a5568; }

  .qa-progress-bar-wrap {
    position: fixed;
    bottom: 88px;
    right: 24px;
    width: 200px;
    background: white;
    border-radius: 8px;
    padding: 12px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    z-index: 2147483647;
  }
  .qa-progress-track { height: 6px; background: #edf2f7; border-radius: 3px; overflow: hidden; }
  .qa-progress-fill { height: 100%; background: #e53e3e; border-radius: 3px; transition: width 0.3s ease; }
  .qa-progress-label { font-size: 12px; color: #718096; margin-top: 6px; text-align: right; }

  .qa-share-panel {
    position: fixed;
    bottom: 88px;
    right: 24px;
    width: 280px;
    background: white;
    border-radius: 12px;
    padding: 16px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    z-index: 2147483647;
  }
  .qa-share-url { font-size: 12px; color: #4a5568; word-break: break-all; margin-bottom: 12px; }
  .qa-copy-btn { width: 100%; padding: 8px; background: #e53e3e; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; }
`;
