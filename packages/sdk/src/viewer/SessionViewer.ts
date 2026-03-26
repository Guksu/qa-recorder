export class SessionViewer {
  static generate(events: unknown[]): string {
    const eventsJson = JSON.stringify(events);
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
      background: #fff;
      color: #1a202c;
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    /* ── Header ── */
    header {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 0 20px;
      height: 52px;
      background: #fff;
      border-bottom: 1px solid #e2e8f0;
      flex-shrink: 0;
    }

    .header-brand {
      display: flex;
      align-items: center;
      gap: 8px;
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
      letter-spacing: 0.02em;
    }

    .header-meta {
      font-size: 12px;
      color: #94a3b8;
      padding-left: 16px;
      border-left: 1px solid #e2e8f0;
    }

    .header-controls {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-left: auto;
    }

    /* Play / Pause button */
    #btn-play {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 16px;
      border: none;
      border-radius: 8px;
      background: #ef4444;
      color: #fff;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s, transform 0.1s;
    }
    #btn-play:hover { background: #dc2626; }
    #btn-play:active { transform: scale(0.97); }
    #btn-play svg { width: 14px; height: 14px; fill: currentColor; flex-shrink: 0; }

    /* Speed segmented control */
    .speed-control {
      display: flex;
      background: #f1f5f9;
      border-radius: 8px;
      padding: 3px;
      gap: 2px;
    }
    .speed-control button {
      padding: 4px 12px;
      border: none;
      border-radius: 6px;
      background: transparent;
      color: #94a3b8;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
    }
    .speed-control button.active {
      background: #fff;
      color: #0f172a;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    .speed-control button:not(.active):hover { color: #475569; }

    /* ── Player area ── */
    #player-wrap {
      flex: 1;
      overflow: hidden;
      background: #f8fafc;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 28px;
    }

    #player {
      position: relative;
      border-radius: 6px;
      overflow: hidden;
      box-shadow: 0 4px 24px rgba(0,0,0,0.1), 0 1px 4px rgba(0,0,0,0.06);
    }

    .replayer-wrapper {
      position: relative;
      transform-origin: top left;
    }
    .replayer-wrapper iframe { border: none; }
    .replayer-mouse,
    .replayer-mouse-tail {
      position: absolute !important;
      top: 0;
      left: 0;
      pointer-events: none;
      z-index: 1;
    }
  </style>
</head>
<body>
  <header>
    <div class="header-brand">
      <span class="brand-dot"></span>
      <span class="brand-name">QA Session Replay</span>
    </div>
    <span class="header-meta" id="meta"></span>
    <div class="header-controls">
      <button id="btn-play">
        <svg id="icon-play" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
        <svg id="icon-pause" viewBox="0 0 24 24" style="display:none"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
        <span id="btn-play-label">Play</span>
      </button>
      <div class="speed-control">
        <button id="btn-1x" class="active" onclick="setSpeed(1)">1×</button>
        <button id="btn-2x" onclick="setSpeed(2)">2×</button>
        <button id="btn-4x" onclick="setSpeed(4)">4×</button>
      </div>
    </div>
  </header>

  <div id="player-wrap">
    <div id="player"></div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/rrweb@1.1.3/dist/rrweb.min.js"></script>
  <script>
    const events = ${eventsJson};

    // Duration from first to last event
    const duration = events.length > 1
      ? ((events[events.length - 1].timestamp - events[0].timestamp) / 1000)
      : 0;
    const mins = Math.floor(duration / 60);
    const secs = Math.floor(duration % 60);
    const durStr = mins > 0 ? mins + 'm ' + secs + 's' : secs + 's';
    document.getElementById('meta').textContent =
      events.length.toLocaleString() + ' events · ' + durStr;

    const playerWrap = document.getElementById('player-wrap');
    const player    = document.getElementById('player');

    const replayer = new rrweb.Replayer(events, {
      root: player,
      skipInactive: true,
      speed: 1,
      showWarning: false,
      showDebug: false,
    });

    function fitToContainer() {
      const iframe = player.querySelector('iframe');
      if (!iframe) return;
      const iframeW = iframe.offsetWidth  || 1280;
      const iframeH = iframe.offsetHeight || 720;
      const wrapW   = playerWrap.clientWidth  - 56;
      const wrapH   = playerWrap.clientHeight - 56;
      const scale   = Math.min(1, wrapW / iframeW, wrapH / iframeH);
      const wrapper = player.querySelector('.replayer-wrapper');
      if (wrapper) {
        wrapper.style.transform = 'scale(' + scale + ')';
        wrapper.style.transformOrigin = 'top left';
        player.style.width  = Math.round(iframeW * scale) + 'px';
        player.style.height = Math.round(iframeH * scale) + 'px';
      }
    }

    requestAnimationFrame(() => requestAnimationFrame(fitToContainer));
    window.addEventListener('resize', fitToContainer);

    let playing = false;
    const btnPlay   = document.getElementById('btn-play');
    const iconPlay  = document.getElementById('icon-play');
    const iconPause = document.getElementById('icon-pause');
    const btnLabel  = document.getElementById('btn-play-label');

    btnPlay.onclick = () => {
      if (playing) {
        replayer.pause();
        playing = false;
        iconPlay.style.display  = '';
        iconPause.style.display = 'none';
        btnLabel.textContent = 'Play';
      } else {
        replayer.play();
        playing = true;
        iconPlay.style.display  = 'none';
        iconPause.style.display = '';
        btnLabel.textContent = 'Pause';
        requestAnimationFrame(() => requestAnimationFrame(fitToContainer));
      }
    };

    function setSpeed(s) {
      replayer.setConfig({ speed: s });
      ['1x', '2x', '4x'].forEach(id => {
        document.getElementById('btn-' + id).classList.remove('active');
      });
      document.getElementById('btn-' + s + 'x').classList.add('active');
    }
  </script>
</body>
</html>`;
  }
}
