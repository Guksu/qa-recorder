import type { HARLog, HAREntry } from '@qa-recorder/shared';

export class HARViewer {
  static generate(harLog: HARLog): string {
    const entriesJson = JSON.stringify(harLog.entries);
    return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>QA Network Log</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 12px; background: #fff; color: #202124; }
    header { padding: 12px 16px; border-bottom: 1px solid #dadce0; display: flex; align-items: center; gap: 12px; background: #f8f9fa; }
    header h1 { font-size: 14px; font-weight: 600; color: #3c4043; }
    header span { font-size: 11px; color: #80868b; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    thead { position: sticky; top: 0; background: #f1f3f4; z-index: 1; }
    th { padding: 6px 8px; text-align: left; font-weight: 500; color: #5f6368; border-bottom: 1px solid #dadce0; user-select: none; }
    td { padding: 4px 8px; border-bottom: 1px solid #f1f3f4; vertical-align: middle; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    tr.entry:hover { background: #e8f0fe; cursor: pointer; }
    tr.entry.selected { background: #d2e3fc; }
    .col-method { width: 64px; }
    .col-status { width: 56px; }
    .col-time   { width: 72px; text-align: right; }
    .col-size   { width: 72px; text-align: right; }
    .col-type   { width: 140px; }
    .col-url    { width: auto; }
    .badge { display: inline-block; padding: 1px 5px; border-radius: 3px; font-weight: 600; font-size: 11px; }
    .m-get    { background: #e6f4ea; color: #137333; }
    .m-post   { background: #e8f0fe; color: #1967d2; }
    .m-put    { background: #fef7e0; color: #b06000; }
    .m-patch  { background: #fef7e0; color: #b06000; }
    .m-delete { background: #fce8e6; color: #c5221f; }
    .m-other  { background: #f1f3f4; color: #5f6368; }
    .s-2xx { color: #137333; font-weight: 600; }
    .s-3xx { color: #1967d2; font-weight: 600; }
    .s-4xx { color: #b06000; font-weight: 600; }
    .s-5xx { color: #c5221f; font-weight: 600; }
    #detail { border-top: 2px solid #dadce0; background: #fafafa; max-height: 320px; overflow: auto; }
    .detail-tabs { display: flex; border-bottom: 1px solid #dadce0; background: #f1f3f4; }
    .tab { padding: 8px 16px; cursor: pointer; font-size: 12px; color: #5f6368; border-bottom: 2px solid transparent; }
    .tab.active { color: #1967d2; border-bottom-color: #1967d2; }
    .detail-panel { display: none; padding: 12px 16px; }
    .detail-panel.active { display: block; }
    .hdr-table { width: 100%; border-collapse: collapse; }
    .hdr-table td { padding: 2px 8px 2px 0; vertical-align: top; }
    .hdr-name { color: #5f6368; width: 240px; }
    .hdr-val  { color: #202124; word-break: break-all; white-space: pre-wrap; }
    .body-pre { white-space: pre-wrap; word-break: break-all; font-family: monospace; font-size: 12px; line-height: 1.5; color: #202124; }
    .empty { color: #80868b; font-style: italic; }
    #container { display: flex; flex-direction: column; height: 100vh; overflow: hidden; }
    #list-wrap { flex: 1; overflow: auto; }
  </style>
</head>
<body>
  <div id="container">
    <header>
      <h1>QA Network Log</h1>
      <span id="summary"></span>
    </header>
    <div id="list-wrap">
      <table>
        <thead>
          <tr>
            <th class="col-method">Method</th>
            <th class="col-status">Status</th>
            <th class="col-url">URL</th>
            <th class="col-type">Type</th>
            <th class="col-size">Size</th>
            <th class="col-time">Time</th>
          </tr>
        </thead>
        <tbody id="tbody"></tbody>
      </table>
    </div>
    <div id="detail" style="display:none">
      <div class="detail-tabs">
        <div class="tab active" data-tab="req-headers">Request Headers</div>
        <div class="tab" data-tab="res-headers">Response Headers</div>
        <div class="tab" data-tab="res-body">Response Body</div>
      </div>
      <div id="req-headers" class="detail-panel active"></div>
      <div id="res-headers" class="detail-panel"></div>
      <div id="res-body" class="detail-panel"></div>
    </div>
  </div>
  <script>
    const ENTRIES = ${entriesJson};
    let selected = null;

    function methodClass(m) {
      const map = { GET:'m-get', POST:'m-post', PUT:'m-put', PATCH:'m-patch', DELETE:'m-delete' };
      return map[m.toUpperCase()] || 'm-other';
    }
    function statusClass(s) {
      if (s < 300) return 's-2xx';
      if (s < 400) return 's-3xx';
      if (s < 500) return 's-4xx';
      return 's-5xx';
    }
    function fmtSize(bytes) {
      if (bytes < 0) return '-';
      if (bytes < 1024) return bytes + ' B';
      return (bytes / 1024).toFixed(1) + ' KB';
    }
    function fmtTime(ms) { return Math.round(ms) + ' ms'; }
    function escHtml(s) {
      return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }
    function renderHeaders(headers) {
      if (!headers || !headers.length) return '<span class="empty">헤더 없음</span>';
      return '<table class="hdr-table">' +
        headers.map(h =>
          '<tr><td class="hdr-name">' + escHtml(h.name) + '</td><td class="hdr-val">' + escHtml(h.value) + '</td></tr>'
        ).join('') + '</table>';
    }

    const tbody = document.getElementById('tbody');
    const detail = document.getElementById('detail');
    document.getElementById('summary').textContent = ENTRIES.length + '건';

    ENTRIES.forEach((e, i) => {
      const tr = document.createElement('tr');
      tr.className = 'entry';
      tr.dataset.idx = i;
      const mimeType = e.response.content.mimeType.split(';')[0];
      tr.innerHTML =
        '<td class="col-method"><span class="badge ' + methodClass(e.request.method) + '">' + escHtml(e.request.method) + '</span></td>' +
        '<td class="col-status ' + statusClass(e.response.status) + '">' + e.response.status + '</td>' +
        '<td class="col-url" title="' + escHtml(e.request.url) + '">' + escHtml(e.request.url) + '</td>' +
        '<td class="col-type">' + escHtml(mimeType) + '</td>' +
        '<td class="col-size">' + fmtSize(e.response.bodySize) + '</td>' +
        '<td class="col-time">' + fmtTime(e.time) + '</td>';
      tr.addEventListener('click', () => showDetail(i, tr));
      tbody.appendChild(tr);
    });

    function showDetail(idx, tr) {
      if (selected) selected.classList.remove('selected');
      if (selected === tr) { selected = null; detail.style.display = 'none'; return; }
      selected = tr;
      tr.classList.add('selected');
      const e = ENTRIES[idx];
      document.getElementById('req-headers').innerHTML = renderHeaders(e.request.headers);
      document.getElementById('res-headers').innerHTML = renderHeaders(e.response.headers);
      const body = e.response.content.text;
      let bodyHtml;
      if (!body) {
        bodyHtml = '<span class="empty">응답 본문 없음</span>';
      } else {
        try {
          bodyHtml = '<pre class="body-pre">' + escHtml(JSON.stringify(JSON.parse(body), null, 2)) + '</pre>';
        } catch {
          bodyHtml = '<pre class="body-pre">' + escHtml(body) + '</pre>';
        }
      }
      document.getElementById('res-body').innerHTML = bodyHtml;
      detail.style.display = 'block';
    }

    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.detail-panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(tab.dataset.tab).classList.add('active');
      });
    });
  </script>
</body>
</html>`;
  }
}
