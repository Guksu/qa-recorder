import { toScriptJson } from './scriptJson.js';

export class SessionViewer {
  static generate(events: unknown[]): string {
    const eventsJson = toScriptJson(events);
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>QA Session Replay</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #f1f5f9;
      color: #0f172a;
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    /* ── Header ── */
    header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 0 20px;
      height: 48px;
      background: #fff;
      border-bottom: 1px solid #e2e8f0;
      flex-shrink: 0;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
    }
    .brand-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #ef4444;
    }
    .brand-name {
      font-size: 13px;
      font-weight: 600;
      color: #0f172a;
      letter-spacing: 0.01em;
    }
    .header-divider {
      width: 1px;
      height: 16px;
      background: #e2e8f0;
      flex-shrink: 0;
    }
    .header-meta {
      font-size: 12px;
      color: #94a3b8;
    }

    /* ── Player area ── */
    #player-wrap {
      flex: 1;
      background: #f1f5f9;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px 24px 0;
      overflow: hidden;
    }
    #player {
      position: relative;
      border-radius: 8px;
      overflow: hidden;
      box-shadow:
        0 0 0 1px rgba(0,0,0,0.06),
        0 4px 6px rgba(0,0,0,0.05),
        0 12px 32px rgba(0,0,0,0.1);
    }
    .replayer-wrapper { position: relative; transform-origin: top left; }
    .replayer-wrapper iframe { border: none; display: block; }
    .replayer-mouse,
    .replayer-mouse-tail {
      position: absolute !important;
      top: 0; left: 0;
      pointer-events: none;
      z-index: 1;
    }

    /* ── Controls ── */
    #controls {
      background: #fff;
      border-top: 1px solid #e2e8f0;
      padding: 0 20px;
      flex-shrink: 0;
      user-select: none;
    }

    /* Timeline */
    #timeline-wrap {
      padding: 16px 0 0;
      cursor: pointer;
      display: flex;
      align-items: center;
      height: 22px;
    }
    #timeline-track {
      width: 100%;
      height: 3px;
      background: #e2e8f0;
      border-radius: 99px;
      position: relative;
      transition: height 0.15s ease;
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
      width: 13px;
      height: 13px;
      background: #ef4444;
      border: 2px solid #fff;
      border-radius: 50%;
      position: absolute;
      right: -6px;
      top: 50%;
      transform: translateY(-50%);
      opacity: 0;
      transition: opacity 0.15s ease;
      box-shadow: 0 1px 4px rgba(0,0,0,0.25);
      pointer-events: none;
    }
    #timeline-wrap:hover #timeline-thumb { opacity: 1; }

    /* Bottom row */
    #controls-row {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 10px 0 14px;
    }

    #btn-play {
      width: 34px;
      height: 34px;
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
    #btn-play svg { width: 14px; height: 14px; fill: currentColor; }

    #time-display {
      font-size: 12px;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
      color: #64748b;
    }
    #t-current { color: #0f172a; font-weight: 500; }

    .controls-right {
      display: flex;
      align-items: center;
      gap: 4px;
      margin-left: auto;
    }
    .speed-btn {
      padding: 4px 10px;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      background: transparent;
      color: #64748b;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.12s;
      line-height: 1;
    }
    .speed-btn:hover { border-color: #94a3b8; color: #334155; }
    .speed-btn.active {
      background: #0f172a;
      border-color: #0f172a;
      color: #fff;
    }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <span class="brand-dot"></span>
      <span class="brand-name">QA Session Replay</span>
    </div>
    <div class="header-divider"></div>
    <span class="header-meta" id="meta"></span>
  </header>

  <div id="player-wrap">
    <div id="player"></div>
  </div>

  <div id="controls">
    <div id="timeline-wrap" id="timeline-wrap">
      <div id="timeline-track">
        <div id="timeline-fill" style="width:0%">
          <div id="timeline-thumb"></div>
        </div>
      </div>
    </div>
    <div id="controls-row">
      <button id="btn-play" title="Play">
        <svg id="icon-play" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
        <svg id="icon-pause" viewBox="0 0 24 24" style="display:none"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
      </button>
      <div id="time-display">
        <span id="t-current">0:00</span>
        <span style="color:#cbd5e1"> / </span>
        <span id="t-total">0:00</span>
      </div>
      <div class="controls-right">
        <button class="speed-btn active" onclick="setSpeed(1)">1×</button>
        <button class="speed-btn" onclick="setSpeed(2)">2×</button>
        <button class="speed-btn" onclick="setSpeed(4)">4×</button>
      </div>
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/rrweb@1.1.3/dist/rrweb.min.js"></script>
  <script>
    const events  = ${eventsJson};
    const totalMs = events.length > 1
      ? events[events.length - 1].timestamp - events[0].timestamp
      : 0;

    // Header meta
    const mins = Math.floor(totalMs / 60000);
    const secs = Math.floor((totalMs % 60000) / 1000);
    document.getElementById('meta').textContent =
      events.length.toLocaleString() + ' events · ' +
      (mins > 0 ? mins + 'm ' : '') + secs + 's';
    document.getElementById('t-total').textContent = fmt(totalMs);

    // Replayer
    const playerWrap = document.getElementById('player-wrap');
    const player     = document.getElementById('player');

    const replayer = new rrweb.Replayer(events, {
      root: player,
      skipInactive: true,
      speed: 1,
      showWarning: false,
      showDebug: false,
    });

    // Fit to container
    function fit() {
      const iframe = player.querySelector('iframe');
      if (!iframe) return;
      const iW = iframe.offsetWidth  || 1280;
      const iH = iframe.offsetHeight || 720;
      const wW = playerWrap.clientWidth  - 48;
      const wH = playerWrap.clientHeight - 48;
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

    // Time tracking
    let playing    = false;
    let speed      = 1;
    let elapsed    = 0;   // ms from start of recording
    let lastWall   = 0;
    let ticker     = null;

    function fmt(ms) {
      const s = Math.floor(ms / 1000);
      return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    }

    function updateUI() {
      const pct = totalMs > 0 ? Math.min(100, elapsed / totalMs * 100) : 0;
      document.getElementById('timeline-fill').style.width = pct + '%';
      document.getElementById('t-current').textContent = fmt(elapsed);
    }

    function startTicker() {
      lastWall = Date.now();
      ticker = setInterval(() => {
        elapsed += (Date.now() - lastWall) * speed;
        lastWall = Date.now();
        if (elapsed >= totalMs) { elapsed = totalMs; stopTicker(); setPlayIcon(false); playing = false; }
        updateUI();
      }, 80);
    }

    function stopTicker() {
      clearInterval(ticker);
      ticker = null;
    }

    function setPlayIcon(isPlaying) {
      document.getElementById('icon-play').style.display  = isPlaying ? 'none' : '';
      document.getElementById('icon-pause').style.display = isPlaying ? '' : 'none';
      document.getElementById('btn-play').title = isPlaying ? 'Pause' : 'Play';
    }

    // Play / Pause
    document.getElementById('btn-play').onclick = () => {
      if (playing) {
        replayer.pause();
        stopTicker();
        playing = false;
        setPlayIcon(false);
      } else {
        replayer.play(elapsed);
        startTicker();
        playing = true;
        setPlayIcon(true);
        requestAnimationFrame(() => requestAnimationFrame(fit));
      }
    };

    // Speed
    window.setSpeed = (s) => {
      speed = s;
      replayer.setConfig({ speed: s });
      if (playing) { stopTicker(); startTicker(); }
      document.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('active'));
      event.target.classList.add('active');
    };

    // Timeline seek
    const timelineWrap  = document.getElementById('timeline-wrap');
    const timelineTrack = document.getElementById('timeline-track');

    function seekTo(e) {
      const rect = timelineTrack.getBoundingClientRect();
      const pct  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      elapsed = pct * totalMs;
      if (playing) {
        stopTicker();
        replayer.play(elapsed);
        startTicker();
      } else {
        replayer.pause(elapsed);
      }
      updateUI();
    }

    let seeking = false;
    timelineWrap.addEventListener('mousedown', (e) => { seeking = true; seekTo(e); });
    document.addEventListener('mousemove',     (e) => { if (seeking) seekTo(e); });
    document.addEventListener('mouseup',       ()  => { seeking = false; });

    updateUI();
  </script>
</body>
</html>`;
  }
}
