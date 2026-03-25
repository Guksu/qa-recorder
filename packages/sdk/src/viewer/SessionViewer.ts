export class SessionViewer {
  static generate(events: unknown[]): string {
    const eventsJson = JSON.stringify(events);
    return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>QA Session Replay</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #fff; color: #1a202c; height: 100vh; display: flex; flex-direction: column; }
    header { padding: 12px 20px; background: #f7fafc; border-bottom: 1px solid #e2e8f0; display: flex; align-items: center; gap: 16px; flex-shrink: 0; }
    h1 { font-size: 14px; font-weight: 600; color: #e53e3e; }
    #meta { font-size: 12px; color: #718096; }
    #controls { display: flex; gap: 8px; align-items: center; margin-left: auto; }
    button { padding: 6px 14px; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; background: #edf2f7; color: #4a5568; }
    button:hover { background: #e53e3e; color: #fff; }
    button.active { background: #e53e3e; color: #fff; }
    #player-wrap { flex: 1; overflow: hidden; background: #f7fafc; display: flex; align-items: flex-start; justify-content: center; padding: 24px; }
    #player { position: relative; }
    .replayer-wrapper { position: relative; transform-origin: top left; }
    .replayer-mouse, .replayer-mouse-tail { position: absolute !important; top: 0; left: 0; pointer-events: none; z-index: 1; }
  </style>
</head>
<body>
  <header>
    <h1>QA Session Replay</h1>
    <span id="meta"></span>
    <div id="controls">
      <button id="btn-play">▶ 재생</button>
      <button id="btn-1x" class="active">1x</button>
      <button id="btn-2x">2x</button>
    </div>
  </header>
  <div id="player-wrap">
    <div id="player"></div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/rrweb@1.1.3/dist/rrweb.min.js"></script>
  <script>
    const events = ${eventsJson};
    document.getElementById('meta').textContent = events.length + '개 이벤트';

    const playerWrap = document.getElementById('player-wrap');
    const player = document.getElementById('player');

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
      const iframeW = iframe.offsetWidth || 1280;
      const iframeH = iframe.offsetHeight || 720;
      const wrapW = playerWrap.clientWidth - 48;
      const wrapH = playerWrap.clientHeight - 48;
      const scale = Math.min(1, wrapW / iframeW, wrapH / iframeH);
      const wrapper = player.querySelector('.replayer-wrapper');
      if (wrapper) {
        wrapper.style.transform = 'scale(' + scale + ')';
        wrapper.style.transformOrigin = 'top left';
        player.style.width = Math.round(iframeW * scale) + 'px';
        player.style.height = Math.round(iframeH * scale) + 'px';
      }
    }

    // Replayer initializes the iframe synchronously on first paint
    requestAnimationFrame(() => requestAnimationFrame(fitToContainer));
    window.addEventListener('resize', fitToContainer);

    let playing = false;
    const btnPlay = document.getElementById('btn-play');
    btnPlay.onclick = () => {
      if (playing) {
        replayer.pause();
        playing = false;
        btnPlay.textContent = '▶ 재생';
      } else {
        replayer.play();
        playing = true;
        btnPlay.textContent = '⏸ 일시정지';
        requestAnimationFrame(() => requestAnimationFrame(fitToContainer));
      }
    };

    document.getElementById('btn-1x').onclick = () => {
      replayer.setConfig({ speed: 1 });
      document.getElementById('btn-1x').classList.add('active');
      document.getElementById('btn-2x').classList.remove('active');
    };
    document.getElementById('btn-2x').onclick = () => {
      replayer.setConfig({ speed: 2 });
      document.getElementById('btn-2x').classList.add('active');
      document.getElementById('btn-1x').classList.remove('active');
    };
  </script>
</body>
</html>`;
  }
}
