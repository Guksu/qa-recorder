import type { HARLog } from '@qa-recorder/shared';
import type { ConsoleEntry } from '../console/ConsoleCapture.js';
import { toScriptJson } from './scriptJson.js';

export class HARViewer {
  static generate(harLog: HARLog, consoleLogs: ConsoleEntry[] = []): string {
    const entriesJson = toScriptJson(harLog.entries);
    const consoleJson = toScriptJson(consoleLogs);
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>QA Network Log</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 12px;
      background: #fff;
      color: #202124;
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    /* ── Toolbar ── */
    #toolbar {
      height: 28px;
      min-height: 28px;
      border-bottom: 1px solid #dadce0;
      background: #f1f3f4;
      display: flex;
      align-items: center;
      padding: 0 8px;
      gap: 16px;
      flex-shrink: 0;
    }
    #toolbar-title {
      font-size: 11px;
      font-weight: 600;
      color: #5f6368;
      letter-spacing: 0.03em;
    }
    #summary {
      font-size: 11px;
      color: #80868b;
    }
    #filter-input {
      margin-left: auto;
      height: 20px;
      padding: 0 8px;
      border: 1px solid #dadce0;
      border-radius: 3px;
      font-size: 11px;
      outline: none;
      width: 180px;
      background: #fff;
      color: #202124;
    }
    #filter-input:focus { border-color: #1a73e8; }

    /* ── Main split ── */
    #main {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    #list-wrap {
      flex: 1;
      overflow: auto;
      min-height: 80px;
    }

    /* ── Table ── */
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    thead {
      position: sticky;
      top: 0;
      background: #f1f3f4;
      z-index: 1;
    }
    th {
      padding: 5px 8px;
      text-align: left;
      font-weight: 500;
      font-size: 11px;
      color: #5f6368;
      border-bottom: 1px solid #dadce0;
      user-select: none;
      white-space: nowrap;
    }
    td {
      padding: 3px 8px;
      border-bottom: 1px solid #f1f3f4;
      vertical-align: middle;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    tr.entry { cursor: pointer; }
    tr.entry:hover { background: #f8f9fa; }
    tr.entry.selected { background: #d2e3fc !important; }
    tr.entry.selected td { border-bottom-color: #c5d8f6; }
    tr.entry.hidden { display: none; }

    .col-name   { width: auto; }
    .col-method { width: 56px; }
    .col-status { width: 56px; }
    .col-type   { width: 100px; }
    .col-size   { width: 70px; text-align: right; }
    .col-time   { width: 70px; text-align: right; }
    .col-bar    { width: 120px; }

    .method-badge {
      display: inline-block;
      padding: 1px 4px;
      border-radius: 2px;
      font-weight: 600;
      font-size: 10px;
      letter-spacing: 0.02em;
    }
    .m-get    { background: #e6f4ea; color: #137333; }
    .m-post   { background: #e8f0fe; color: #1967d2; }
    .m-put    { background: #fef7e0; color: #b06000; }
    .m-patch  { background: #fef7e0; color: #b06000; }
    .m-delete { background: #fce8e6; color: #c5221f; }
    .m-other  { background: #f1f3f4; color: #5f6368; }

    .s-2xx { color: #137333; font-weight: 500; }
    .s-3xx { color: #1967d2; font-weight: 500; }
    .s-4xx { color: #b06000; font-weight: 500; }
    .s-5xx { color: #c5221f; font-weight: 500; }

    /* Waterfall */
    .bar-wrap { height: 12px; background: #f1f3f4; border-radius: 2px; overflow: hidden; position: relative; }
    .bar-wait    { height: 100%; background: #4285f4; border-radius: 2px; position: absolute; }
    .bar-receive { height: 100%; background: #34a853; border-radius: 2px; position: absolute; }

    /* ── Resize handle ── */
    #resize-handle {
      height: 4px;
      min-height: 4px;
      background: #dadce0;
      cursor: row-resize;
      flex-shrink: 0;
      display: none;
    }
    #resize-handle:hover { background: #1a73e8; }
    #resize-handle.visible { display: block; }

    /* ── Detail panel ── */
    #detail {
      display: none;
      flex-shrink: 0;
      height: 320px;
      min-height: 120px;
      background: #fff;
      border-top: 1px solid #dadce0;
      overflow: hidden;
      flex-direction: column;
    }
    #detail.visible {
      display: flex;
    }

    /* Tabs */
    .detail-tabs {
      display: flex;
      border-bottom: 1px solid #dadce0;
      background: #fff;
      flex-shrink: 0;
    }
    .tab {
      padding: 8px 16px;
      cursor: pointer;
      font-size: 12px;
      color: #5f6368;
      border-bottom: 2px solid transparent;
      white-space: nowrap;
      user-select: none;
    }
    .tab:hover { color: #202124; background: #f8f9fa; }
    .tab.active { color: #1a73e8; border-bottom-color: #1a73e8; font-weight: 500; }
    .close-btn {
      margin-left: auto;
      padding: 6px 12px;
      cursor: pointer;
      color: #80868b;
      font-size: 16px;
      line-height: 1;
      display: flex;
      align-items: center;
    }
    .close-btn:hover { color: #202124; }

    /* Panels */
    .detail-panel { display: none; overflow: auto; flex: 1; }
    .detail-panel.active { display: block; }
    .panel-inner { padding: 12px 16px; }

    /* General section */
    .section { margin-bottom: 2px; }
    .section-header {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 16px;
      background: #f8f9fa;
      border-bottom: 1px solid #f1f3f4;
      cursor: pointer;
      user-select: none;
      font-size: 11px;
      font-weight: 600;
      color: #3c4043;
      letter-spacing: 0.02em;
    }
    .section-header:hover { background: #f1f3f4; }
    .section-arrow { font-size: 10px; color: #80868b; transition: transform 0.15s; }
    .section-arrow.open { transform: rotate(90deg); }
    .section-body { padding: 8px 16px; }
    .section-body.collapsed { display: none; }

    /* KV table */
    .kv-table { width: 100%; border-collapse: collapse; }
    .kv-table tr:hover td { background: #f8f9fa; }
    .kv-table td {
      padding: 3px 0;
      vertical-align: top;
      border: none;
      white-space: normal;
      text-overflow: unset;
      overflow: visible;
      font-size: 12px;
      line-height: 1.5;
    }
    .kv-name {
      color: #5f6368;
      width: 220px;
      padding-right: 12px;
      font-weight: 400;
    }
    .kv-val {
      color: #202124;
      word-break: break-all;
    }
    .kv-label {
      font-size: 10px;
      font-weight: 600;
      color: #80868b;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      padding: 8px 0 4px;
      display: block;
    }

    /* Response body */
    pre.body-pre {
      white-space: pre-wrap;
      word-break: break-all;
      font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
      font-size: 11px;
      line-height: 1.6;
      color: #202124;
      margin: 0;
    }

    /* Timing */
    .timing-row { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
    .timing-label { width: 80px; color: #5f6368; font-size: 11px; flex-shrink: 0; }
    .timing-bar-wrap { flex: 1; height: 10px; background: #f1f3f4; border-radius: 2px; overflow: hidden; }
    .timing-bar { height: 100%; border-radius: 2px; }
    .t-wait    { background: #4285f4; }
    .t-receive { background: #34a853; }
    .timing-val { width: 60px; text-align: right; color: #202124; font-size: 11px; flex-shrink: 0; }

    .empty { color: #80868b; font-style: italic; font-size: 12px; }
    .copy-raw {
      float: right;
      font-size: 11px;
      color: #1a73e8;
      cursor: pointer;
      padding: 2px 4px;
      border-radius: 3px;
    }
    .copy-raw:hover { background: #e8f0fe; }

    /* ── Console panel ── */
    #console-panel {
      flex-shrink: 0;
      border-top: 2px solid #dadce0;
      display: flex;
      flex-direction: column;
      height: 220px;
      min-height: 80px;
      background: #fff;
    }
    #console-toolbar {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 0 12px;
      height: 28px;
      min-height: 28px;
      background: #f1f3f4;
      border-bottom: 1px solid #dadce0;
      font-size: 11px;
      flex-shrink: 0;
    }
    #console-title { font-weight: 600; color: #3c4043; }
    #console-count { color: #80868b; }
    #console-list { overflow: auto; flex: 1; }
    .con-row {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      padding: 3px 12px;
      border-bottom: 1px solid #f8f9fa;
      font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
      font-size: 11px;
      line-height: 1.5;
    }
    .con-row:hover { background: #f8f9fa; }
    .con-row.con-error { background: #fff0f0; border-left: 3px solid #c5221f; }
    .con-row.con-warn  { background: #fffbe6; border-left: 3px solid #b06000; }
    .con-row.con-error:hover { background: #ffe8e8; }
    .con-row.con-warn:hover  { background: #fff5cc; }
    .con-time { color: #80868b; flex-shrink: 0; width: 56px; }
    .con-level {
      flex-shrink: 0;
      width: 40px;
      font-weight: 600;
      font-size: 10px;
      letter-spacing: 0.03em;
    }
    .con-level.lvl-error { color: #c5221f; }
    .con-level.lvl-warn  { color: #b06000; }
    .con-level.lvl-log   { color: #5f6368; }
    .con-level.lvl-info  { color: #1967d2; }
    .con-msg { flex: 1; word-break: break-all; white-space: pre-wrap; color: #202124; }
    .con-stack {
      display: none;
      margin-top: 2px;
      color: #80868b;
      font-size: 10px;
      white-space: pre-wrap;
      word-break: break-all;
    }
    .con-row.expanded .con-stack { display: block; }
    .con-expand { color: #80868b; cursor: pointer; flex-shrink: 0; font-size: 10px; }
    .con-expand:hover { color: #202124; }
    #console-empty { padding: 16px; color: #80868b; font-size: 12px; font-style: italic; }
  </style>
</head>
<body>
  <div id="main">
    <div id="toolbar">
      <span id="toolbar-title">Network</span>
      <span id="summary"></span>
      <input id="filter-input" type="text" placeholder="Filter by URL..." />
    </div>
    <div id="list-wrap">
      <table id="table">
        <thead>
          <tr>
            <th class="col-name">Name</th>
            <th class="col-method">Method</th>
            <th class="col-status">Status</th>
            <th class="col-type">Type</th>
            <th class="col-size">Size</th>
            <th class="col-time">Time</th>
            <th class="col-bar">Waterfall</th>
          </tr>
        </thead>
        <tbody id="tbody"></tbody>
      </table>
    </div>

    <div id="resize-handle"></div>

    <div id="detail">
      <div class="detail-tabs">
        <div class="tab active" data-tab="headers">Headers</div>
        <div class="tab" data-tab="payload">Payload</div>
        <div class="tab" data-tab="response">Response</div>
        <div class="tab" data-tab="timing">Timing</div>
        <div class="close-btn" id="close-detail">✕</div>
      </div>
      <div id="headers" class="detail-panel active"></div>
      <div id="payload" class="detail-panel"></div>
      <div id="response" class="detail-panel"></div>
      <div id="timing" class="detail-panel"></div>
    </div>

    <div id="console-panel">
      <div id="console-toolbar">
        <span id="console-title">Console</span>
        <span id="console-count"></span>
        <label style="margin-left:auto;display:flex;align-items:center;gap:6px;cursor:pointer">
          <input type="checkbox" id="chk-error" checked onchange="renderConsole()"> <span style="color:#c5221f">Errors</span>
        </label>
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
          <input type="checkbox" id="chk-warn" checked onchange="renderConsole()"> <span style="color:#b06000">Warnings</span>
        </label>
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
          <input type="checkbox" id="chk-log" checked onchange="renderConsole()"> <span style="color:#5f6368">Logs</span>
        </label>
      </div>
      <div id="console-list"></div>
    </div>
  </div>

  <script>
    const ENTRIES = ${entriesJson};
    const CONSOLE_LOGS = ${consoleJson};
    let selectedTr = null;
    let selectedIdx = -1;

    /* ── Helpers ── */
    function esc(s) {
      return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function methodClass(m) {
      const map = { GET:'m-get', POST:'m-post', PUT:'m-put', PATCH:'m-patch', DELETE:'m-delete' };
      return map[m.toUpperCase()] || 'm-other';
    }
    function statusClass(s) {
      if (s >= 500) return 's-5xx';
      if (s >= 400) return 's-4xx';
      if (s >= 300) return 's-3xx';
      return 's-2xx';
    }
    function fmtSize(b) {
      if (b < 0) return '-';
      if (b < 1024) return b + ' B';
      return (b / 1024).toFixed(1) + ' KB';
    }
    function fmtTime(ms) { return Math.round(ms) + ' ms'; }
    function simplifyMime(mime) {
      if (!mime) return '-';
      const m = mime.split(';')[0].trim();
      const map = {
        'application/json': 'json',
        'application/x-www-form-urlencoded': 'form',
        'text/html': 'document',
        'text/plain': 'text',
        'text/css': 'css',
        'application/javascript': 'script',
        'text/javascript': 'script',
      };
      return map[m] || m.split('/')[1] || m;
    }
    function getPath(url) {
      try { return new URL(url).pathname; } catch { return url; }
    }
    function tryPrettyJson(text) {
      try {
        const parsed = JSON.parse(text);
        return esc(JSON.stringify(parsed, null, 2));
      } catch { return esc(text); }
    }

    /* ── Build table rows ── */
    const tbody = document.getElementById('tbody');
    const maxTime = ENTRIES.length ? Math.max(...ENTRIES.map(e => e.time), 1) : 1;

    ENTRIES.forEach((e, i) => {
      const tr = document.createElement('tr');
      tr.className = 'entry';
      tr.dataset.idx = i;
      tr.dataset.url = e.request.url.toLowerCase();

      const waitPct   = Math.min(100, (e.timings.wait    / maxTime) * 100);
      const recvPct   = Math.min(100, (e.timings.receive / maxTime) * 100);
      const waitLeft  = Math.min(100, ((e.timings.wait - e.timings.receive) / maxTime) * 100);

      tr.innerHTML =
        '<td class="col-name" title="' + esc(e.request.url) + '">' + esc(getPath(e.request.url)) + '</td>' +
        '<td class="col-method"><span class="method-badge ' + methodClass(e.request.method) + '">' + esc(e.request.method) + '</span></td>' +
        '<td class="col-status ' + statusClass(e.response.status) + '">' + e.response.status + '</td>' +
        '<td class="col-type">' + esc(simplifyMime(e.response.content.mimeType)) + '</td>' +
        '<td class="col-size">' + fmtSize(e.response.bodySize) + '</td>' +
        '<td class="col-time">' + fmtTime(e.time) + '</td>' +
        '<td class="col-bar"><div class="bar-wrap">' +
          '<div class="bar-wait" style="left:0;width:' + waitPct + '%"></div>' +
          '<div class="bar-receive" style="left:' + waitLeft + '%;width:' + recvPct + '%"></div>' +
        '</div></td>';

      tr.addEventListener('click', () => selectEntry(i, tr));
      tbody.appendChild(tr);
    });

    /* ── Summary ── */
    const totalTime = ENTRIES.length
      ? ENTRIES.reduce((s, e) => s + e.time, 0)
      : 0;
    document.getElementById('summary').textContent =
      ENTRIES.length + ' requests · ' + Math.round(totalTime) + ' ms';

    /* ── Detail panel ── */
    const detail      = document.getElementById('detail');
    const resizeHandle = document.getElementById('resize-handle');

    function renderKV(pairs) {
      if (!pairs || !pairs.length) return '<span class="empty">None</span>';
      return '<table class="kv-table">' +
        pairs.map(h =>
          '<tr><td class="kv-name">' + esc(h.name) + '</td><td class="kv-val">' + esc(h.value) + '</td></tr>'
        ).join('') + '</table>';
    }

    function makeSection(title, bodyHtml, open) {
      return '<div class="section">' +
        '<div class="section-header" onclick="toggleSection(this)">' +
          '<span class="section-arrow' + (open ? ' open' : '') + '">▶</span>' +
          esc(title) +
        '</div>' +
        '<div class="section-body' + (open ? '' : ' collapsed') + '">' + bodyHtml + '</div>' +
      '</div>';
    }

    window.toggleSection = function(hdr) {
      const arrow = hdr.querySelector('.section-arrow');
      const body  = hdr.nextElementSibling;
      const isOpen = !body.classList.contains('collapsed');
      body.classList.toggle('collapsed', isOpen);
      arrow.classList.toggle('open', !isOpen);
    };

    function selectEntry(idx, tr) {
      if (selectedTr === tr) {
        closeDetail();
        return;
      }
      if (selectedTr) selectedTr.classList.remove('selected');
      selectedTr = tr;
      selectedIdx = idx;
      tr.classList.add('selected');

      const e = ENTRIES[idx];

      /* Headers */
      const generalPairs = [
        { name: 'Request URL',    value: e.request.url },
        { name: 'Request Method', value: e.request.method },
        { name: 'Status Code',    value: e.response.status + (e.response.statusText ? ' ' + e.response.statusText : '') },
      ];
      document.getElementById('headers').innerHTML =
        '<div style="padding-bottom:4px">' +
        makeSection('General', renderKV(generalPairs), true) +
        makeSection('Response Headers (' + e.response.headers.length + ')', renderKV(e.response.headers), true) +
        makeSection('Request Headers (' + e.request.headers.length + ')', renderKV(e.request.headers), true) +
        '</div>';

      /* Payload */
      let payloadHtml = '';
      if (e.request.queryString && e.request.queryString.length) {
        payloadHtml += makeSection('Query String Parameters (' + e.request.queryString.length + ')', renderKV(e.request.queryString), true);
      }
      if (e.request.postData && e.request.postData.text) {
        const bodyText = e.request.postData.text;
        let bodyContent;
        try {
          bodyContent = '<pre class="body-pre">' + tryPrettyJson(bodyText) + '</pre>';
        } catch {
          bodyContent = '<pre class="body-pre">' + esc(bodyText) + '</pre>';
        }
        payloadHtml += makeSection('Request Body', bodyContent, true);
      }
      if (!payloadHtml) {
        payloadHtml = '<div class="panel-inner"><span class="empty">No payload</span></div>';
      }
      document.getElementById('payload').innerHTML = payloadHtml;

      /* Response */
      const body = e.response.content && e.response.content.text;
      let responseHtml;
      if (!body) {
        responseHtml = '<div class="panel-inner"><span class="empty">No response body</span></div>';
      } else {
        responseHtml =
          '<div class="panel-inner">' +
          '<span class="copy-raw" onclick="navigator.clipboard.writeText(ENTRIES[' + idx + '].response.content.text)">Copy</span>' +
          '<pre class="body-pre">' + tryPrettyJson(body) + '</pre>' +
          '</div>';
      }
      document.getElementById('response').innerHTML = responseHtml;

      /* Timing */
      const timings = [
        { label: 'Waiting (TTFB)', val: e.timings.wait,    cls: 't-wait' },
        { label: 'Content Download', val: e.timings.receive, cls: 't-receive' },
      ];
      const maxT = Math.max(...timings.map(t => t.val), 1);
      document.getElementById('timing').innerHTML =
        '<div class="panel-inner">' +
        timings.map(t =>
          '<div class="timing-row">' +
            '<div class="timing-label">' + esc(t.label) + '</div>' +
            '<div class="timing-bar-wrap"><div class="timing-bar ' + t.cls + '" style="width:' + Math.min(100, t.val / maxT * 100) + '%"></div></div>' +
            '<div class="timing-val">' + Math.round(t.val) + ' ms</div>' +
          '</div>'
        ).join('') +
        '<div style="margin-top:8px;padding-top:8px;border-top:1px solid #f1f3f4;font-size:11px;color:#5f6368">Total: <strong style="color:#202124">' + fmtTime(e.time) + '</strong></div>' +
        '</div>';

      detail.classList.add('visible');
      resizeHandle.classList.add('visible');
    }

    function closeDetail() {
      if (selectedTr) selectedTr.classList.remove('selected');
      selectedTr = null;
      selectedIdx = -1;
      detail.classList.remove('visible');
      resizeHandle.classList.remove('visible');
    }

    document.getElementById('close-detail').addEventListener('click', closeDetail);

    /* ── Tab switching ── */
    document.querySelectorAll('.tab[data-tab]').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab[data-tab]').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.detail-panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(tab.dataset.tab).classList.add('active');
      });
    });

    /* ── Filter ── */
    document.getElementById('filter-input').addEventListener('input', function() {
      const q = this.value.toLowerCase();
      document.querySelectorAll('tr.entry').forEach(tr => {
        tr.classList.toggle('hidden', q && !tr.dataset.url.includes(q));
      });
    });

    /* ── Console ── */
    function fmtOffset(ms) {
      const s = Math.floor(ms / 1000);
      const m = Math.floor(s / 60);
      return m > 0
        ? m + ':' + String(s % 60).padStart(2, '0') + '.' + String(Math.floor((ms % 1000) / 10)).padStart(2, '0')
        : s + '.' + String(Math.floor((ms % 1000) / 10)).padStart(2, '0') + 's';
    }

    function renderConsole() {
      const showError = document.getElementById('chk-error').checked;
      const showWarn  = document.getElementById('chk-warn').checked;
      const showLog   = document.getElementById('chk-log').checked;
      const list = document.getElementById('console-list');

      const filtered = CONSOLE_LOGS.filter(e => {
        if (e.level === 'error') return showError;
        if (e.level === 'warn')  return showWarn;
        return showLog;
      });

      document.getElementById('console-count').textContent =
        CONSOLE_LOGS.length + ' entries';

      if (!filtered.length) {
        list.innerHTML = '<div id="console-empty">No console entries</div>';
        return;
      }

      list.innerHTML = filtered.map((e, i) => {
        const hasStack = !!e.stack;
        return '<div class="con-row con-' + e.level + '" id="clog-' + i + '">' +
          '<span class="con-time">' + fmtOffset(e._offsetMs) + '</span>' +
          '<span class="con-level lvl-' + e.level + '">' + e.level.toUpperCase() + '</span>' +
          '<span class="con-msg">' + esc(e.message) +
            (hasStack ? '<div class="con-stack">' + esc(e.stack) + '</div>' : '') +
          '</span>' +
          (hasStack ? '<span class="con-expand" onclick="toggleStack(' + i + ')">▶ stack</span>' : '') +
        '</div>';
      }).join('');
    }

    window.toggleStack = function(i) {
      const row = document.getElementById('clog-' + i);
      row.classList.toggle('expanded');
      const btn = row.querySelector('.con-expand');
      btn.textContent = row.classList.contains('expanded') ? '▼ stack' : '▶ stack';
    };

    renderConsole();

    /* ── Resize ── */
    (function() {
      const handle = document.getElementById('resize-handle');
      const listWrap = document.getElementById('list-wrap');
      let dragging = false, startY = 0, startH = 0;

      handle.addEventListener('mousedown', e => {
        dragging = true;
        startY = e.clientY;
        startH = detail.offsetHeight;
        document.body.style.cursor = 'row-resize';
        document.body.style.userSelect = 'none';
        e.preventDefault();
      });
      document.addEventListener('mousemove', e => {
        if (!dragging) return;
        const delta = startY - e.clientY;
        const newH = Math.max(80, Math.min(window.innerHeight * 0.8, startH + delta));
        detail.style.height = newH + 'px';
      });
      document.addEventListener('mouseup', () => {
        if (!dragging) return;
        dragging = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      });
    })();
  </script>
</body>
</html>`;
  }
}
