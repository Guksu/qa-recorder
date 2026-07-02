import type { HARLog } from '@qa-recorder/shared';
import type { ConsoleEntry } from '../console/ConsoleCapture.js';
import { toScriptJson } from './scriptJson.js';

export class UnifiedViewer {
  static generate(events: unknown[], harLog: HARLog, consoleLogs: ConsoleEntry[], memo = ''): string {
    /* _offsetMs는 녹화 시작 시점 기준이지만 리플레이 타임라인의 원점은
     * EVENTS[0].timestamp(마지막 체크아웃 시점)다. 체크아웃이나 백업 복원 이후에는
     * 두 원점이 어긋나므로, 절대 시각을 기준으로 리플레이 원점 대비 오프셋을 재계산한다. */
    const t0 = events.length ? (events[0] as { timestamp?: unknown }).timestamp : undefined;
    const syncOffset = <T extends { _offsetMs?: number }>(item: T, isoTime: string): T => {
      if (typeof t0 !== 'number') return item;
      const t = Date.parse(isoTime);
      return Number.isNaN(t) ? item : { ...item, _offsetMs: Math.max(0, t - t0) };
    };

    const eventsJson  = toScriptJson(events);
    const entriesJson = toScriptJson(harLog.entries.map((e) => syncOffset(e, e.startedDateTime)));
    const consoleJson = toScriptJson(consoleLogs.map((c) => syncOffset(c, c.timestamp)));
    const memoHtml    = memo
      ? `<div id="qa-memo-section" class="qa-memo"><span class="qa-memo-icon">📝</span><span class="qa-memo-text">${memo.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</span></div>`
      : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>QA Report</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 12px;
      background: #f1f5f9;
      color: #202124;
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    /* ── Header ── */
    header {
      height: 44px;
      min-height: 44px;
      background: #fff;
      border-bottom: 1px solid #e2e8f0;
      display: flex;
      align-items: center;
      padding: 0 16px;
      gap: 12px;
      flex-shrink: 0;
    }
    .brand { display: flex; align-items: center; gap: 8px; }
    .brand-dot { width: 8px; height: 8px; border-radius: 50%; background: #ef4444; }
    .brand-name { font-size: 13px; font-weight: 600; color: #0f172a; }
    .header-divider { width: 1px; height: 16px; background: #e2e8f0; }
    .header-meta { font-size: 11px; color: #94a3b8; }
    .qa-memo {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      background: #fffbeb;
      border: 1px solid #fde68a;
      border-radius: 6px;
      padding: 8px 12px;
      margin: 0 16px 0 0;
      font-size: 12px;
      color: #92400e;
      max-width: 480px;
      flex-shrink: 1;
    }
    .qa-memo-icon { flex-shrink: 0; }
    .qa-memo-text { word-break: break-word; }

    /* ── Main layout ── */
    #main {
      flex: 1;
      display: flex;
      overflow: hidden;
    }

    /* ── Left: replay ── */
    #left {
      display: flex;
      flex-direction: column;
      width: 62%;
      min-width: 320px;
      border-right: 1px solid #e2e8f0;
      background: #f1f5f9;
      overflow: hidden;
    }
    #player-wrap {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px 16px 0;
      overflow: hidden;
    }
    #player {
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 0 0 1px rgba(0,0,0,0.06), 0 4px 24px rgba(0,0,0,0.12);
    }
    .replayer-wrapper { position: relative; transform-origin: top left; }
    .replayer-wrapper iframe { border: none; display: block; }
    .replayer-mouse, .replayer-mouse-tail {
      position: absolute !important;
      top: 0; left: 0;
      pointer-events: none;
      z-index: 1;
    }

    /* Controls */
    #controls {
      background: #fff;
      border-top: 1px solid #e2e8f0;
      padding: 0 16px;
      flex-shrink: 0;
    }
    #timeline-wrap {
      padding: 14px 0 0;
      cursor: pointer;
      display: flex;
      align-items: center;
      height: 20px;
    }
    #timeline-track {
      width: 100%;
      height: 3px;
      background: #e2e8f0;
      border-radius: 99px;
      position: relative;
      transition: height 0.15s;
    }
    #timeline-wrap:hover #timeline-track { height: 5px; }
    #timeline-fill {
      height: 100%;
      background: #ef4444;
      border-radius: 99px;
      position: relative;
      max-width: 100%;
    }
    #timeline-thumb {
      width: 13px; height: 13px;
      background: #ef4444;
      border: 2px solid #fff;
      border-radius: 50%;
      position: absolute;
      right: -6px; top: 50%;
      transform: translateY(-50%);
      opacity: 0;
      transition: opacity 0.15s;
      box-shadow: 0 1px 4px rgba(0,0,0,0.25);
      pointer-events: none;
    }
    #timeline-wrap:hover #timeline-thumb { opacity: 1; }

    /* Timeline markers */
    .tl-marker {
      position: absolute;
      top: 50%;
      transform: translateY(-50%);
      width: 6px; height: 6px;
      border-radius: 50%;
      pointer-events: none;
      z-index: 2;
    }
    .tl-marker-net { background: #4285f4; }
    .tl-marker-err { background: #c5221f; }
    .tl-marker-warn { background: #b06000; }

    #controls-row {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 8px 0 12px;
    }
    #btn-play {
      width: 32px; height: 32px;
      border-radius: 50%;
      border: none;
      background: #0f172a;
      color: #fff;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: background 0.15s, transform 0.1s;
    }
    #btn-play:hover { background: #1e293b; }
    #btn-play:active { transform: scale(0.92); }
    #btn-play svg { width: 13px; height: 13px; fill: currentColor; }
    #time-display {
      font-size: 12px;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
      color: #64748b;
    }
    #t-current { color: #0f172a; font-weight: 500; }
    .controls-right { display: flex; align-items: center; gap: 4px; margin-left: auto; }
    .speed-btn {
      padding: 3px 9px;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      background: transparent;
      color: #64748b;
      font-size: 11px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.12s;
    }
    .speed-btn:hover { border-color: #94a3b8; color: #334155; }
    .speed-btn.active { background: #0f172a; border-color: #0f172a; color: #fff; }

    /* ── Right: network + console ── */
    #right {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      background: #fff;
    }
    .right-tabs {
      display: flex;
      border-bottom: 1px solid #e2e8f0;
      background: #fff;
      flex-shrink: 0;
    }
    .right-tab {
      padding: 10px 16px;
      cursor: pointer;
      font-size: 12px;
      color: #5f6368;
      border-bottom: 2px solid transparent;
      user-select: none;
    }
    .right-tab:hover { color: #202124; background: #f8f9fa; }
    .right-tab.active { color: #1a73e8; border-bottom-color: #1a73e8; font-weight: 500; }
    .right-panel { display: none; flex: 1; overflow: auto; flex-direction: column; }
    .right-panel.active { display: flex; }

    /* Network panel */
    #net-toolbar {
      padding: 6px 12px;
      background: #f8f9fa;
      border-bottom: 1px solid #e2e8f0;
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
      font-size: 11px;
      color: #5f6368;
    }
    #net-filter {
      margin-left: auto;
      height: 20px;
      padding: 0 7px;
      border: 1px solid #dadce0;
      border-radius: 3px;
      font-size: 11px;
      outline: none;
      width: 140px;
    }
    #net-filter:focus { border-color: #1a73e8; }
    #net-table-wrap { flex: 1; overflow: auto; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    thead { position: sticky; top: 0; background: #f1f3f4; z-index: 1; }
    th {
      padding: 5px 8px;
      text-align: left;
      font-weight: 500;
      font-size: 11px;
      color: #5f6368;
      border-bottom: 1px solid #dadce0;
      white-space: nowrap;
    }
    td {
      padding: 3px 8px;
      border-bottom: 1px solid #f1f3f4;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      vertical-align: middle;
      cursor: pointer;
    }
    .col-name   { width: auto; }
    .col-method { width: 52px; }
    .col-status { width: 50px; }
    .col-time   { width: 64px; text-align: right; }
    .method-badge {
      display: inline-block;
      padding: 1px 4px;
      border-radius: 2px;
      font-weight: 600;
      font-size: 10px;
    }
    .m-get    { background: #e6f4ea; color: #137333; }
    .m-post   { background: #e8f0fe; color: #1967d2; }
    .m-put    { background: #fef7e0; color: #b06000; }
    .m-patch  { background: #fef7e0; color: #b06000; }
    .m-delete { background: #fce8e6; color: #c5221f; }
    .m-other  { background: #f1f3f4; color: #5f6368; }
    .s-2xx { color: #137333; }
    .s-3xx { color: #1967d2; }
    .s-4xx { color: #b06000; }
    .s-5xx { color: #c5221f; }
    tr.net-row:hover td { background: #f8f9fa; }
    tr.net-row.net-active td { background: #e8f0fe !important; }
    tr.net-row.net-past td { opacity: 0.45; }
    tr.net-row.net-future td { opacity: 0.7; }
    tr.net-row.net-hidden { display: none; }
    tr.net-row.net-selected td { background: #e8f0fe !important; outline: 1px solid #4285f4; }

    /* Network detail panel */
    #net-detail {
      border-top: 1px solid #e2e8f0;
      background: #fff;
      flex-shrink: 0;
      height: 260px;
      display: none;
      flex-direction: column;
      overflow: hidden;
    }
    #net-detail.visible { display: flex; }
    .detail-tabs {
      display: flex;
      border-bottom: 1px solid #e2e8f0;
      background: #f8f9fa;
      flex-shrink: 0;
      align-items: center;
    }
    .detail-tab {
      padding: 7px 14px;
      cursor: pointer;
      font-size: 11px;
      color: #5f6368;
      border-bottom: 2px solid transparent;
      user-select: none;
    }
    .detail-tab:hover { color: #202124; }
    .detail-tab.active { color: #1a73e8; border-bottom-color: #1a73e8; font-weight: 500; }
    .detail-close {
      margin-left: auto;
      padding: 4px 12px;
      cursor: pointer;
      color: #80868b;
      font-size: 18px;
      line-height: 1;
    }
    .detail-close:hover { color: #202124; }
    .detail-body { flex: 1; overflow: auto; }
    .detail-pane { display: none; }
    .detail-pane.active { display: block; }
    .kv-table { width: 100%; border-collapse: collapse; font-size: 11px; }
    .kv-table td { padding: 3px 12px; border-bottom: 1px solid #f1f3f4; vertical-align: top; word-break: break-all; }
    .kv-table td:first-child { width: 200px; font-weight: 500; color: #5f6368; }
    .kv-section-head {
      padding: 4px 12px;
      background: #f1f3f4;
      font-weight: 600;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #5f6368;
    }
    .body-pre {
      padding: 10px 12px;
      font-family: 'Menlo', 'Monaco', monospace;
      font-size: 11px;
      white-space: pre-wrap;
      word-break: break-all;
      color: #202124;
      margin: 0;
    }
    .timing-row { display: flex; align-items: center; gap: 12px; padding: 5px 12px; font-size: 11px; }
    .timing-label { width: 100px; color: #5f6368; }
    .timing-bar-wrap { flex: 1; background: #f1f3f4; border-radius: 2px; height: 8px; }
    .timing-bar { height: 100%; background: #4285f4; border-radius: 2px; min-width: 2px; }
    .timing-val { width: 60px; text-align: right; color: #202124; font-variant-numeric: tabular-nums; }

    /* Console panel */
    #con-toolbar {
      padding: 6px 12px;
      background: #f8f9fa;
      border-bottom: 1px solid #e2e8f0;
      display: flex;
      align-items: center;
      gap: 10px;
      flex-shrink: 0;
      font-size: 11px;
    }
    #con-list { flex: 1; overflow: auto; }
    .con-row {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      padding: 4px 12px;
      border-bottom: 1px solid #f8f9fa;
      cursor: pointer;
      transition: opacity 0.2s;
    }
    .con-row.con-future { opacity: 0.3; }
    .con-row.con-error { background: #fff0f0; border-left: 3px solid #c5221f; }
    .con-row.con-warn  { background: #fffbe6; border-left: 3px solid #b06000; }
    .con-row:hover { filter: brightness(0.97); }
    .con-time { color: #80868b; flex-shrink: 0; width: 50px; font-family: monospace; font-size: 11px; }
    .con-level {
      flex-shrink: 0; width: 40px;
      font-weight: 700; font-size: 10px; letter-spacing: 0.03em;
    }
    .lvl-error { color: #c5221f; }
    .lvl-warn  { color: #b06000; }
    .lvl-log   { color: #5f6368; }
    .lvl-info  { color: #1967d2; }
    .con-msg { flex: 1; word-break: break-all; white-space: pre-wrap; color: #202124; font-family: monospace; font-size: 11px; }
    #con-empty { padding: 20px; color: #80868b; font-size: 12px; text-align: center; }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <span class="brand-dot"></span>
      <span class="brand-name">QA Report</span>
    </div>
    <div class="header-divider"></div>
    <span class="header-meta" id="meta"></span>
    ${memoHtml}
  </header>

  <div id="main">
    <!-- Left: session replay -->
    <div id="left">
      <div id="player-wrap">
        <div id="player"></div>
      </div>
      <div id="controls">
        <div id="timeline-wrap">
          <div id="timeline-track">
            <div id="timeline-fill" style="width:0%">
              <div id="timeline-thumb"></div>
            </div>
          </div>
        </div>
        <div id="controls-row">
          <button id="btn-play" title="Play">
            <svg id="icon-play"  viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
            <svg id="icon-pause" viewBox="0 0 24 24" style="display:none"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
          </button>
          <div id="time-display">
            <span id="t-current">0:00</span>
            <span style="color:#cbd5e1"> / </span>
            <span id="t-total">0:00</span>
          </div>
          <div class="controls-right">
            <button class="speed-btn active" onclick="setSpeed(1, event)">1×</button>
            <button class="speed-btn" onclick="setSpeed(2, event)">2×</button>
            <button class="speed-btn" onclick="setSpeed(4, event)">4×</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Right: network + console -->
    <div id="right">
      <div class="right-tabs">
        <div class="right-tab active" data-panel="network">
          Network <span id="net-badge" style="font-size:10px;color:#80868b;margin-left:4px"></span>
        </div>
        <div class="right-tab" data-panel="console">
          Console <span id="con-badge" style="font-size:10px;color:#80868b;margin-left:4px"></span>
        </div>
      </div>

      <div id="network" class="right-panel active">
        <div id="net-toolbar">
          <span id="net-summary"></span>
          <input id="net-filter" type="text" placeholder="Filter URL..." />
        </div>
        <div id="net-table-wrap">
          <table>
            <thead>
              <tr>
                <th class="col-name">Name</th>
                <th class="col-method">Method</th>
                <th class="col-status">Status</th>
                <th class="col-time">Time</th>
              </tr>
            </thead>
            <tbody id="net-tbody"></tbody>
          </table>
        </div>
        <div id="net-detail">
          <div class="detail-tabs">
            <div class="detail-tab active" data-pane="pane-headers">Headers</div>
            <div class="detail-tab" data-pane="pane-payload">Payload</div>
            <div class="detail-tab" data-pane="pane-response">Response</div>
            <div class="detail-tab" data-pane="pane-timing">Timing</div>
            <span class="detail-close" id="detail-close">&#x2715;</span>
          </div>
          <div class="detail-body">
            <div id="pane-headers" class="detail-pane active"></div>
            <div id="pane-payload" class="detail-pane"></div>
            <div id="pane-response" class="detail-pane"></div>
            <div id="pane-timing" class="detail-pane"></div>
          </div>
        </div>
      </div>

      <div id="console" class="right-panel">
        <div id="con-toolbar">
          <label style="display:flex;align-items:center;gap:4px;cursor:pointer">
            <input type="checkbox" id="chk-error" checked onchange="renderConsoleFilters()">
            <span style="color:#c5221f;font-weight:600">Errors</span>
          </label>
          <label style="display:flex;align-items:center;gap:4px;cursor:pointer">
            <input type="checkbox" id="chk-warn" checked onchange="renderConsoleFilters()">
            <span style="color:#b06000;font-weight:600">Warnings</span>
          </label>
          <label style="display:flex;align-items:center;gap:4px;cursor:pointer">
            <input type="checkbox" id="chk-log" checked onchange="renderConsoleFilters()">
            <span style="color:#5f6368;font-weight:600">Logs</span>
          </label>
        </div>
        <div id="con-list"></div>
      </div>
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/rrweb@1.1.3/dist/rrweb.min.js"></script>
  <script>
    const EVENTS       = ${eventsJson};
    const NET_ENTRIES  = ${entriesJson};
    const CON_LOGS     = ${consoleJson};

    const totalMs = EVENTS.length > 1
      ? EVENTS[EVENTS.length - 1].timestamp - EVENTS[0].timestamp
      : 0;

    /* ── Header meta ── */
    const mins = Math.floor(totalMs / 60000);
    const secs = Math.floor((totalMs % 60000) / 1000);
    document.getElementById('meta').textContent =
      (mins > 0 ? mins + 'm ' : '') + secs + 's · ' +
      NET_ENTRIES.length + ' requests · ' +
      CON_LOGS.length + ' console entries';
    document.getElementById('t-total').textContent = fmt(totalMs);
    document.getElementById('net-badge').textContent = NET_ENTRIES.length;
    document.getElementById('con-badge').textContent = CON_LOGS.length;

    /* ── Helpers ── */
    function fmt(ms) {
      const s = Math.floor(ms / 1000);
      return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    }
    function esc(s) {
      return String(s)
        .replace(/&/g,'&amp;').replace(/</g,'&lt;')
        .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }
    function methodClass(m) {
      return ({GET:'m-get',POST:'m-post',PUT:'m-put',PATCH:'m-patch',DELETE:'m-delete'})[m.toUpperCase()] || 'm-other';
    }
    function statusClass(s) {
      if (s>=500) return 's-5xx'; if (s>=400) return 's-4xx';
      if (s>=300) return 's-3xx'; return 's-2xx';
    }
    function getPath(url) { try { return new URL(url).pathname; } catch { return url; } }

    /* ── rrweb replayer ── */
    const playerWrap = document.getElementById('player-wrap');
    const player     = document.getElementById('player');

    const replayer = EVENTS.length ? new rrweb.Replayer(EVENTS, {
      root: player, skipInactive: true, speed: 1,
      showWarning: false, showDebug: false,
    }) : null;

    function fit() {
      if (!replayer) return;
      const iframe = player.querySelector('iframe');
      if (!iframe) return;
      const iW = iframe.offsetWidth  || 1280;
      const iH = iframe.offsetHeight || 720;
      const wW = playerWrap.clientWidth  - 32;
      const wH = playerWrap.clientHeight - 32;
      const s  = Math.min(1, wW / iW, wH / iH);
      const wrapper = player.querySelector('.replayer-wrapper');
      if (wrapper) {
        wrapper.style.transform = 'scale(' + s + ')';
        player.style.width  = Math.round(iW * s) + 'px';
        player.style.height = Math.round(iH * s) + 'px';
      }
    }
    requestAnimationFrame(() => requestAnimationFrame(fit));
    window.addEventListener('resize', fit);

    /* ── Playback state ── */
    let playing = false, speed = 1, elapsed = 0, lastWall = 0, ticker = null;

    function updateUI() {
      const pct = totalMs > 0 ? Math.min(100, elapsed / totalMs * 100) : 0;
      document.getElementById('timeline-fill').style.width = pct + '%';
      document.getElementById('t-current').textContent = fmt(elapsed);
      syncPanels(elapsed);
    }

    function startTicker() {
      lastWall = Date.now();
      ticker = setInterval(() => {
        elapsed += (Date.now() - lastWall) * speed;
        lastWall = Date.now();
        if (elapsed >= totalMs) {
          elapsed = totalMs;
          stopTicker();
          setPlayIcon(false);
          playing = false;
        }
        updateUI();
      }, 80);
    }
    function stopTicker() { clearInterval(ticker); ticker = null; }

    function setPlayIcon(p) {
      document.getElementById('icon-play').style.display  = p ? 'none' : '';
      document.getElementById('icon-pause').style.display = p ? '' : 'none';
    }

    document.getElementById('btn-play').onclick = () => {
      if (!replayer) return;
      if (playing) {
        replayer.pause(); stopTicker(); playing = false; setPlayIcon(false);
      } else {
        replayer.play(elapsed); startTicker(); playing = true; setPlayIcon(true);
        requestAnimationFrame(() => requestAnimationFrame(fit));
      }
    };

    window.setSpeed = (s, e) => {
      speed = s;
      if (replayer) replayer.setConfig({ speed: s });
      if (playing) { stopTicker(); startTicker(); }
      document.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
    };

    /* Timeline seek */
    const timelineWrap  = document.getElementById('timeline-wrap');
    const timelineTrack = document.getElementById('timeline-track');
    function seekTo(e) {
      const rect = timelineTrack.getBoundingClientRect();
      const pct  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      elapsed = pct * totalMs;
      if (replayer) {
        if (playing) { stopTicker(); replayer.play(elapsed); startTicker(); }
        else { replayer.pause(elapsed); }
      }
      updateUI();
    }
    let seeking = false;
    timelineWrap.addEventListener('mousedown', e => { seeking = true; seekTo(e); });
    document.addEventListener('mousemove', e => { if (seeking) seekTo(e); });
    document.addEventListener('mouseup', () => { seeking = false; });

    /* ── Network table ── */
    const netTbody = document.getElementById('net-tbody');
    document.getElementById('net-summary').textContent = NET_ENTRIES.length + ' requests';

    NET_ENTRIES.forEach((e, i) => {
      const tr = document.createElement('tr');
      tr.className = 'net-row net-future';
      tr.dataset.idx   = i;
      tr.dataset.start = e._offsetMs || 0;
      tr.dataset.end   = (e._offsetMs || 0) + e.time;
      tr.dataset.url   = e.request.url.toLowerCase();

      tr.innerHTML =
        '<td class="col-name" title="' + esc(e.request.url) + '">' + esc(getPath(e.request.url)) + '</td>' +
        '<td class="col-method"><span class="method-badge ' + methodClass(e.request.method) + '">' + esc(e.request.method) + '</span></td>' +
        '<td class="col-status ' + statusClass(e.response.status) + '">' + e.response.status + '</td>' +
        '<td class="col-time">' + Math.round(e.time) + ' ms</td>';

      tr.addEventListener('click', () => { showNetDetail(i, tr); seekToOffset(parseFloat(tr.dataset.start)); });
      netTbody.appendChild(tr);
    });

    /* URL filter */
    document.getElementById('net-filter').addEventListener('input', function() {
      const q = this.value.toLowerCase();
      document.querySelectorAll('.net-row').forEach(tr => {
        tr.classList.toggle('net-hidden', q && !tr.dataset.url.includes(q));
      });
    });

    /* ── Console list ── */
    function renderConsoleFilters() {
      const showError = document.getElementById('chk-error').checked;
      const showWarn  = document.getElementById('chk-warn').checked;
      const showLog   = document.getElementById('chk-log').checked;
      document.querySelectorAll('.con-row').forEach(row => {
        const lvl = row.dataset.level;
        const hide = (lvl === 'error' && !showError) ||
                     (lvl === 'warn'  && !showWarn)  ||
                     (lvl !== 'error' && lvl !== 'warn' && !showLog);
        row.style.display = hide ? 'none' : '';
      });
    }
    window.renderConsoleFilters = renderConsoleFilters;

    const conList = document.getElementById('con-list');
    if (!CON_LOGS.length) {
      conList.innerHTML = '<div id="con-empty">No console entries recorded</div>';
    } else {
      CON_LOGS.forEach((e, i) => {
        const div = document.createElement('div');
        div.className = 'con-row con-' + e.level + ' con-future';
        div.dataset.offset = e._offsetMs;
        div.dataset.level  = e.level;
        div.innerHTML =
          '<span class="con-time">' + fmt(e._offsetMs) + '</span>' +
          '<span class="con-level lvl-' + e.level + '">' + e.level.toUpperCase() + '</span>' +
          '<span class="con-msg">' + esc(e.message) + '</span>';
        div.addEventListener('click', () => seekToOffset(e._offsetMs));
        conList.appendChild(div);
      });
    }

    /* ── Sync panels with playback time ── */
    function syncPanels(ms) {
      /* Network rows */
      document.querySelectorAll('.net-row').forEach(tr => {
        const start = parseFloat(tr.dataset.start);
        const end   = parseFloat(tr.dataset.end);
        tr.classList.remove('net-active', 'net-past', 'net-future');
        if (ms >= start && ms <= end + 200) {
          tr.classList.add('net-active');
        } else if (ms > end + 200) {
          tr.classList.add('net-past');
        } else {
          tr.classList.add('net-future');
        }
      });

      /* Console rows */
      document.querySelectorAll('.con-row').forEach(row => {
        const offset = parseFloat(row.dataset.offset);
        row.classList.toggle('con-future', ms < offset);
      });
    }

    /* ── Network detail panel ── */
    const netDetail = document.getElementById('net-detail');
    let selectedRow = null;

    function renderKV(pairs) {
      if (!pairs || !pairs.length) return '<p style="padding:8px 12px;color:#80868b;font-size:11px">None</p>';
      return '<table class="kv-table">' +
        pairs.map(p => '<tr><td>' + esc(String(p.name)) + '</td><td>' + esc(String(p.value)) + '</td></tr>').join('') +
        '</table>';
    }

    function tryPrettyJson(s) {
      try { return JSON.stringify(JSON.parse(s), null, 2); } catch(e) { return s; }
    }

    function showNetDetail(idx, tr) {
      if (selectedRow) selectedRow.classList.remove('net-selected');
      selectedRow = tr;
      tr.classList.add('net-selected');

      const e = NET_ENTRIES[idx];

      /* Headers pane */
      document.getElementById('pane-headers').innerHTML =
        '<div class="kv-section-head">General</div>' +
        '<table class="kv-table">' +
        '<tr><td>URL</td><td>' + esc(e.request.url) + '</td></tr>' +
        '<tr><td>Method</td><td>' + esc(e.request.method) + '</td></tr>' +
        '<tr><td>Status</td><td>' + e.response.status + ' ' + esc(e.response.statusText || '') + '</td></tr>' +
        '</table>' +
        '<div class="kv-section-head">Request Headers</div>' + renderKV(e.request.headers) +
        '<div class="kv-section-head">Response Headers</div>' + renderKV(e.response.headers);

      /* Payload pane */
      const body = e.request.postData;
      document.getElementById('pane-payload').innerHTML = body
        ? '<pre class="body-pre">' + esc(tryPrettyJson(body.text || '')) + '</pre>'
        : '<p style="padding:10px 12px;color:#80868b;font-size:11px">No request body</p>';

      /* Response pane */
      const resText = e.response.content && e.response.content.text;
      document.getElementById('pane-response').innerHTML = resText
        ? '<pre class="body-pre">' + esc(tryPrettyJson(resText)) + '</pre>'
        : '<p style="padding:10px 12px;color:#80868b;font-size:11px">No response body</p>';

      /* Timing pane */
      const t = e.timings || {};
      const total = e.time || 0;
      document.getElementById('pane-timing').innerHTML =
        [['Send', t.send || 0], ['Wait (TTFB)', t.wait || 0], ['Receive', t.receive || 0], ['Total', total]]
          .map(([label, ms]) =>
            '<div class="timing-row">' +
            '<span class="timing-label">' + label + '</span>' +
            '<div class="timing-bar-wrap"><div class="timing-bar" style="width:' +
              (total > 0 ? Math.round(ms / total * 100) : 0) + '%"></div></div>' +
            '<span class="timing-val">' + Math.round(ms) + ' ms</span>' +
            '</div>'
          ).join('');

      /* Show panel & reset to Headers tab */
      netDetail.classList.add('visible');
      document.querySelectorAll('.detail-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.detail-pane').forEach(p => p.classList.remove('active'));
      document.querySelector('.detail-tab[data-pane="pane-headers"]').classList.add('active');
      document.getElementById('pane-headers').classList.add('active');
    }

    document.getElementById('detail-close').addEventListener('click', () => {
      netDetail.classList.remove('visible');
      if (selectedRow) { selectedRow.classList.remove('net-selected'); selectedRow = null; }
    });

    document.querySelectorAll('.detail-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.detail-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.detail-pane').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(tab.dataset.pane).classList.add('active');
      });
    });

    /* Seek replay to a specific _offsetMs */
    function seekToOffset(offsetMs) {
      elapsed = Math.max(0, Math.min(totalMs, offsetMs));
      if (replayer) {
        if (playing) { stopTicker(); replayer.play(elapsed); startTicker(); }
        else { replayer.pause(elapsed); }
      }
      updateUI();
    }

    /* ── Right panel tab switching ── */
    document.querySelectorAll('.right-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.right-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.right-panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(tab.dataset.panel).classList.add('active');
      });
    });

    updateUI();
  </script>
</body>
</html>`;
  }
}
