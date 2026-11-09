#!/usr/bin/env node
/**
 * E2E 테스트용 로컬 서버. 외부 샘플 API나 CDN에 의존하지 않도록 필요한 것을 모두 여기서 제공한다.
 *
 *   GET  /                    테스트용 앱 페이지 (e2e/fixtures/app.html)
 *   GET  /sdk/*               현재 체크아웃에서 빌드한 SDK (packages/sdk/dist) — 먼저 `pnpm build`
 *   GET  /api/items           JSON 응답
 *   GET  /api/missing         404 응답
 *   POST /api/echo            받은 본문을 JSON으로 돌려준다 (XHR 테스트용)
 *   GET  /api/slow?ms=        ms만큼 늦게 응답
 *   GET  /api/stream/<id>?type=  응답 헤더만 바로 보내고 본문은 아래 제어 endpoint로 나중에 보낸다 (type: 응답 content-type)
 *   POST /__stream/<id>/push  요청 본문의 텍스트를 그 스트림에 보낸다
 *   POST /__stream/<id>/end   그 스트림을 끝낸다
 *   GET  /__streams           열린 스트림 id 목록 (헤더를 보냈는지 확인용)
 *   POST /upload?mode=&delay= 녹화기의 업로드 endpoint. mode: ok(기본) | error(500) | slow(delay ms 후 ok) | hang(응답 없음)
 *   GET  /uploads/<id>/<field>  받은 파일 (report는 text/html)
 *   GET  /__uploads           받은 업로드 목록과 중간에 끊긴 업로드 수 (테스트 확인용)
 *   POST /__reset             목록 초기화
 *
 * 포트: E2E_PORT (기본 4319)
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import busboy from 'busboy';

const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(here, '../dist');
const port = Number(process.env.E2E_PORT ?? 4319);

/** @type {{ id: number; mode: string; fields: Record<string, { filename?: string; text: string }> }[]} */
let uploads = [];
let aborted = 0;
let started = 0;
/** 본문을 나중에 보내는 응답 (/api/stream/<id>) */
const streams = new Map();

const MIME = { '.js': 'text/javascript; charset=utf-8', '.map': 'application/json', '.html': 'text/html; charset=utf-8' };

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

function handleUpload(req, res, url) {
  const mode = url.searchParams.get('mode') ?? 'ok';
  const delay = Number(url.searchParams.get('delay') ?? 0);
  started++;
  const fields = {};
  let finished = false;
  // 클라이언트가 응답 전에 연결을 끊으면(AbortController, 탭 닫기) 끊긴 업로드로 센다
  res.on('close', () => { if (!finished) aborted++; });

  const bb = busboy({ headers: req.headers });
  bb.on('file', (name, stream, info) => {
    const chunks = [];
    stream.on('data', (c) => chunks.push(c));
    stream.on('end', () => { fields[name] = { filename: info.filename, text: Buffer.concat(chunks).toString('utf8') }; });
  });
  bb.on('field', (name, value) => { fields[name] = { text: value }; });
  bb.on('close', () => {
    const id = uploads.length + 1;
    const respond = () => {
      if (res.destroyed) return;
      uploads.push({ id, mode, fields });
      finished = true;
      if (mode === 'error') send(res, 500, { error: 'upload storage is down' });
      else send(res, 200, { url: `http://localhost:${port}/uploads/${id}/report` });
    };
    if (mode === 'hang') return; // 응답하지 않는다 — 클라이언트의 시간 초과나 취소를 기다린다
    if (mode === 'slow') setTimeout(respond, delay);
    else respond();
  });
  req.pipe(bb);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  const { pathname } = url;

  if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    return send(res, 200, fs.readFileSync(path.join(here, 'fixtures/app.html'), 'utf8'), MIME['.html']);
  }
  if (req.method === 'GET' && pathname.startsWith('/sdk/')) {
    const file = path.resolve(distDir, pathname.slice('/sdk/'.length));
    if (!file.startsWith(distDir + path.sep) || !fs.existsSync(file)) return send(res, 404, 'not found', 'text/plain');
    return send(res, 200, fs.readFileSync(file), MIME[path.extname(file)] ?? 'application/octet-stream');
  }
  if (pathname === '/api/items') return send(res, 200, { items: [{ id: 1, name: 'apple' }, { id: 2, name: 'pear' }] });
  if (pathname === '/api/missing') return send(res, 404, { error: 'not found' });
  if (pathname === '/api/echo' && req.method === 'POST') return send(res, 200, { received: await readBody(req) });
  if (pathname === '/api/slow') {
    return setTimeout(() => send(res, 200, { slow: true }), Number(url.searchParams.get('ms') ?? 500));
  }
  const streamMatch = /^\/api\/stream\/(\w+)$/.exec(pathname);
  if (streamMatch) {
    res.writeHead(200, { 'content-type': url.searchParams.get('type') ?? 'application/json', 'cache-control': 'no-store' });
    res.flushHeaders(); // 본문 없이 헤더만 먼저 보낸다 — 브라우저의 fetch()는 여기서 resolve한다
    streams.set(streamMatch[1], res);
    res.on('close', () => streams.delete(streamMatch[1]));
    return;
  }
  const controlMatch = /^\/__stream\/(\w+)\/(push|end)$/.exec(pathname);
  if (controlMatch && req.method === 'POST') {
    const target = streams.get(controlMatch[1]);
    if (!target) return send(res, 404, { error: 'no such stream' });
    if (controlMatch[2] === 'push') target.write(await readBody(req));
    else target.end();
    return send(res, 200, { ok: true });
  }
  if (pathname === '/__streams') return send(res, 200, { open: [...streams.keys()] });
  if (pathname === '/upload' && req.method === 'POST') return handleUpload(req, res, url);
  const uploadMatch = /^\/uploads\/(\d+)\/(\w+)$/.exec(pathname);
  if (uploadMatch && req.method === 'GET') {
    const upload = uploads.find((u) => u.id === Number(uploadMatch[1]));
    const field = upload?.fields[uploadMatch[2]];
    if (!field) return send(res, 404, 'not found', 'text/plain');
    return send(res, 200, field.text, uploadMatch[2] === 'report' ? MIME['.html'] : 'application/json');
  }
  if (pathname === '/__uploads') return send(res, 200, { uploads, aborted, started });
  if (pathname === '/__reset' && req.method === 'POST') {
    uploads = [];
    aborted = 0;
    started = 0;
    return send(res, 200, { ok: true });
  }
  send(res, 404, 'not found', 'text/plain');
});

server.listen(port, '127.0.0.1', () => {
  console.log(`[e2e] fixture server on http://localhost:${port} (sdk from ${distDir})`);
});
