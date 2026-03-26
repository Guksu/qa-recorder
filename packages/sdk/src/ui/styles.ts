export const BASE_STYLES = `
  :host {
    all: initial;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }

  /* ── Floating Button ── */
  .qa-floating-btn {
    position: fixed;
    bottom: 24px;
    right: 24px;
    height: 44px;
    padding: 0 18px;
    border-radius: 999px;
    background: #1e293b;
    border: 1px solid rgba(255,255,255,0.08);
    cursor: pointer;
    box-shadow: 0 4px 16px rgba(0,0,0,0.4), 0 1px 4px rgba(0,0,0,0.2);
    display: flex;
    align-items: center;
    gap: 8px;
    z-index: 2147483647;
    transition: background 0.2s ease, box-shadow 0.2s ease, transform 0.15s ease;
    white-space: nowrap;
  }
  .qa-floating-btn:hover {
    background: #0f172a;
    box-shadow: 0 6px 24px rgba(0,0,0,0.5);
    transform: translateY(-1px);
  }
  .qa-floating-btn:active { transform: translateY(0); }

  /* idle 아이콘 */
  .qa-floating-btn svg {
    width: 20px;
    height: 20px;
    fill: #94a3b8;
    flex-shrink: 0;
  }
  .qa-idle-label {
    font-size: 13px;
    font-weight: 500;
    color: #94a3b8;
    letter-spacing: 0.01em;
  }

  /* recording state */
  .qa-rec-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #ef4444;
    flex-shrink: 0;
    animation: qa-blink 1.4s ease-in-out infinite;
  }
  @keyframes qa-blink {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0.3; }
  }
  .qa-rec-label {
    font-size: 11px;
    font-weight: 700;
    color: #ef4444;
    letter-spacing: 0.08em;
  }
  .qa-rec-divider {
    width: 1px;
    height: 14px;
    background: rgba(255,255,255,0.15);
    flex-shrink: 0;
  }
  .qa-save-label {
    font-size: 13px;
    font-weight: 500;
    color: #f1f5f9;
    letter-spacing: 0.01em;
  }

  /* ── Modal ── */
  .qa-modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.55);
    backdrop-filter: blur(3px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 2147483647;
    animation: qa-fade-in 0.15s ease;
  }
  @keyframes qa-fade-in {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
  .qa-modal {
    background: #fff;
    border-radius: 16px;
    padding: 24px;
    max-width: 340px;
    width: 90%;
    box-shadow: 0 24px 48px rgba(0,0,0,0.18), 0 4px 12px rgba(0,0,0,0.1);
    animation: qa-slide-up 0.18s ease;
  }
  @keyframes qa-slide-up {
    from { opacity: 0; transform: translateY(8px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .qa-modal h3 { margin: 0 0 6px; font-size: 15px; font-weight: 600; color: #0f172a; }
  .qa-modal p  { margin: 0; font-size: 13px; color: #64748b; line-height: 1.5; }
  .qa-modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 20px; }
  .qa-btn {
    padding: 8px 18px;
    border-radius: 8px;
    border: none;
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
    transition: background 0.15s ease, transform 0.1s ease;
  }
  .qa-btn:active { transform: scale(0.97); }
  .qa-btn-primary { background: #ef4444; color: #fff; }
  .qa-btn-primary:hover { background: #dc2626; }
  .qa-btn-secondary { background: #f1f5f9; color: #475569; }
  .qa-btn-secondary:hover { background: #e2e8f0; }

  /* ── Progress Bar ── */
  .qa-progress-bar-wrap {
    position: fixed;
    bottom: 80px;
    right: 24px;
    width: 210px;
    background: #1e293b;
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 12px;
    padding: 12px 14px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.3);
    z-index: 2147483647;
  }
  .qa-progress-track { height: 4px; background: rgba(255,255,255,0.1); border-radius: 2px; overflow: hidden; }
  .qa-progress-fill {
    height: 100%;
    background: linear-gradient(90deg, #ef4444, #f97316);
    border-radius: 2px;
    transition: width 0.3s ease;
    animation: qa-progress-shimmer 1.5s linear infinite;
    background-size: 200% 100%;
  }
  @keyframes qa-progress-shimmer {
    0%   { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }
  .qa-progress-label { font-size: 11px; color: #94a3b8; margin-top: 8px; text-align: right; }

  /* ── Share Panel ── */
  .qa-share-panel {
    position: fixed;
    bottom: 80px;
    right: 24px;
    width: 280px;
    background: #1e293b;
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 14px;
    padding: 16px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.3);
    z-index: 2147483647;
    animation: qa-slide-up 0.18s ease;
  }
  .qa-share-title { font-size: 11px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 8px; }
  .qa-share-url { font-size: 12px; color: #cbd5e1; word-break: break-all; margin-bottom: 12px; line-height: 1.5; }
  .qa-copy-btn {
    width: 100%;
    padding: 9px;
    background: #ef4444;
    color: #fff;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
    transition: background 0.15s ease;
  }
  .qa-copy-btn:hover { background: #dc2626; }
`;
