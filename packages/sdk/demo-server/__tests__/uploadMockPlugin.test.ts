// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  createServer,
  loadConfigFromFile,
  type Connect,
  type Plugin,
  type ResolvedConfig,
  type ViteDevServer,
} from 'vite';
import { uploadMockPlugin, type UploadMockPluginApi } from '../uploadMockPlugin.js';

interface RawResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

interface Part {
  filename: string;
  content: string;
}

const SECRET = 'TOP-SECRET-OUTSIDE-UPLOADS';
const BOUNDARY = '----qa-upload-mock-boundary';
/** 플러그인 미들웨어가 모두 next()로 넘긴 요청에 하네스가 보내는 응답 본문 (Vite였다면 Vite의 미들웨어가 처리했을 요청) */
const FELL_THROUGH = 'Fell through the plugin middlewares';

let tmpRoot: string;
let uploadsDir: string;
let server: http.Server;
let port: number;
let receivedUrls: string[];

/** 플러그인이 등록한 미들웨어만으로 실제 http 서버를 구성 (connect처럼 순서대로 next 호출) */
async function startServer(dir: string): Promise<http.Server> {
  const handlers: Connect.NextHandleFunction[] = [];
  const fakeServer = {
    middlewares: {
      use: (fn: Connect.NextHandleFunction) => {
        handlers.push(fn);
      },
    },
  };
  const hook = uploadMockPlugin(dir).configureServer;
  const configure = typeof hook === 'function' ? hook : hook?.handler;
  await configure?.(fakeServer as unknown as ViteDevServer);

  const srv = http.createServer((req, res) => {
    receivedUrls.push(req.url ?? '');
    let i = 0;
    const next = (err?: unknown): void => {
      if (err) {
        res.statusCode = 500;
        res.end(String(err));
        return;
      }
      const handler = handlers[i++];
      if (!handler) {
        res.statusCode = 404;
        res.end(FELL_THROUGH);
        return;
      }
      // connect와 동일하게 동기 throw는 500으로 변환
      try {
        handler(req as Connect.IncomingMessage, res, next);
      } catch (e) {
        next(e);
      }
    };
    next();
  });
  await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', resolve));
  return srv;
}

/** 경로를 정규화하지 않고 그대로 보내는 요청 (port를 주지 않으면 플러그인 미들웨어만으로 만든 서버로 보낸다) */
function request(
  rawPath: string,
  opts: { method?: string; headers?: http.OutgoingHttpHeaders; body?: Buffer | string; port?: number } = {},
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: opts.port ?? port,
        path: rawPath,
        method: opts.method ?? 'GET',
        headers: opts.headers,
        agent: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    req.on('error', reject);
    req.end(opts.body);
  });
}

/** 본문 일부만 보내고 요청을 열어 둔다 (끝내거나 끊는 것은 호출한 쪽에서) */
function openUpload(
  headers: http.OutgoingHttpHeaders,
  partialBody: Buffer,
): { req: http.ClientRequest; response: Promise<RawResponse> } {
  const req = http.request({
    host: '127.0.0.1',
    port,
    path: '/upload',
    method: 'POST',
    headers,
    agent: false,
  });
  const response = new Promise<RawResponse>((resolve, reject) => {
    req.on('response', (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () =>
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        }),
      );
    });
    req.on('error', reject);
  });
  // 연결을 일부러 끊는 테스트에서 unhandled rejection이 되지 않도록
  response.catch(() => {});
  req.write(partialBody);
  return { req, response };
}

function multipart(parts: Part[]): { body: Buffer; headers: http.OutgoingHttpHeaders } {
  const body = Buffer.from(
    parts
      .map(
        (p, i) =>
          `--${BOUNDARY}\r\n` +
          `Content-Disposition: form-data; name="file${i}"; filename="${p.filename}"\r\n` +
          'Content-Type: application/octet-stream\r\n\r\n' +
          `${p.content}\r\n`,
      )
      .join('') + `--${BOUNDARY}--\r\n`,
  );
  return {
    body,
    headers: {
      'Content-Type': `multipart/form-data; boundary=${BOUNDARY}`,
      'Content-Length': body.length,
    },
  };
}

async function upload(
  parts: Part[],
  target: { port?: number; uploadsDir?: string } = {},
): Promise<{ res: RawResponse; base: string; dir: string }> {
  const { body, headers } = multipart(parts);
  const res = await request('/upload', { method: 'POST', headers, body, port: target.port });
  expect(res.status).toBe(200);
  const base = new URL(JSON.parse(res.body).url).pathname;
  return { res, base, dir: path.join(target.uploadsDir ?? uploadsDir, base.slice('/uploads/'.length)) };
}

/** 플러그인이 이번 테스트에서 연 파일 쓰기 스트림 목록 */
function writeStreams(): fs.WriteStream[] {
  return createWriteStreamSpy.mock.results
    .filter((r) => r.type === 'return')
    .map((r) => r.value as fs.WriteStream);
}

/** 열린 파일 스트림이 하나도 남지 않아야 한다 (fd 누수 방지) */
async function expectAllWriteStreamsClosed(): Promise<void> {
  await vi.waitFor(() => {
    expect(writeStreams().filter((s) => !s.closed)).toEqual([]);
  });
}

/** 실패한 업로드의 디렉터리는 응답 뒤에 비동기로 정리된다 */
async function waitForEmptyUploads(): Promise<void> {
  await vi.waitFor(() => {
    expect(fs.readdirSync(uploadsDir)).toEqual([]);
  });
}

let createWriteStreamSpy: MockInstance<typeof fs.createWriteStream>;

beforeEach(async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  createWriteStreamSpy = vi.spyOn(fs, 'createWriteStream');
  // macOS의 /tmp 심볼릭 링크 등을 피하기 위해 실제 경로 기준으로 사용
  tmpRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'qa-upload-mock-')));
  uploadsDir = path.join(tmpRoot, 'uploads');
  fs.mkdirSync(uploadsDir);
  fs.writeFileSync(path.join(tmpRoot, 'secret.txt'), SECRET);
  receivedUrls = [];
  server = await startServer(uploadsDir);
  port = (server.address() as AddressInfo).port;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('uploadMockPlugin — GET /uploads/* 경로 제한', () => {
  it('테스트 클라이언트는 .. 경로를 정규화하지 않고 그대로 전송한다', async () => {
    await request('/uploads/../secret.txt');
    expect(receivedUrls).toEqual(['/uploads/../secret.txt']);
  });

  it.each([
    ['/uploads/../x'],
    ['/uploads/../secret.txt'],
    ['/uploads/a/../../secret.txt'],
    ['/uploads/%2e%2e/secret.txt'],
    ['/uploads/%2E%2E/secret.txt'],
    ['/uploads/..%2fsecret.txt'],
    ['/uploads/..%2Fsecret.txt'],
    ['/uploads/%2e%2e%2fsecret.txt'],
    ['/uploads/..\\secret.txt'],
    ['/uploads/a\\..\\..\\secret.txt'],
    ['/uploads/..%5csecret.txt'],
    ['/uploads/..%5Csecret.txt'],
    ['/uploads/../secret.txt?x=1'],
  ])('.. 세그먼트로 디렉터리를 벗어나는 경로는 403으로 거부한다: %s', async (rawPath) => {
    const res = await request(rawPath);
    expect(res.status).toBe(403);
    expect(res.body).not.toContain(SECRET);
  });

  it('../를 여러 번 반복해 루트까지 올라가는 경로도 403으로 거부한다', async () => {
    const rawPath = `/uploads/${'../'.repeat(20)}${tmpRoot.slice(1)}/secret.txt`;
    const res = await request(rawPath);
    expect(receivedUrls).toEqual([rawPath]);
    expect(res.status).toBe(403);
    expect(res.body).not.toContain(SECRET);
  });

  it('절대 경로가 섞인 요청은 403으로 거부한다', async () => {
    const secretPath = path.join(tmpRoot, 'secret.txt');
    for (const rawPath of [
      `/uploads/${secretPath}`,
      `/uploads/${encodeURIComponent(secretPath)}`,
    ]) {
      const res = await request(rawPath);
      expect(res.status).toBe(403);
      expect(res.body).not.toContain(SECRET);
    }
  });

  it('업로드 디렉터리와 접두사만 같은 형제 디렉터리는 거부한다', async () => {
    const sibling = `${uploadsDir}-evil`;
    fs.mkdirSync(sibling);
    fs.writeFileSync(path.join(sibling, 'secret.txt'), SECRET);

    const res = await request(`/uploads/${sibling}/secret.txt`);
    expect(res.status).toBe(403);
    expect(res.body).not.toContain(SECRET);
  });

  it('NUL 바이트(%00)가 포함된 경로는 400으로 거부한다', async () => {
    const { base } = await upload([{ filename: 'network.har', content: '{}' }]);
    for (const rawPath of [`${base}network.har%00.txt`, '/uploads/%00']) {
      const res = await request(rawPath);
      expect(res.status).toBe(400);
    }
  });

  it('잘못된 퍼센트 인코딩은 400으로 거부한다', async () => {
    const res = await request('/uploads/%E0%A4%A');
    expect(res.status).toBe(400);
  });

  it('업로드 디렉터리 밖을 가리키는 심볼릭 링크 파일은 403으로 거부한다', async () => {
    fs.symlinkSync(path.join(tmpRoot, 'secret.txt'), path.join(uploadsDir, 'link.txt'));

    const res = await request('/uploads/link.txt');
    expect(res.status).toBe(403);
    expect(res.body).not.toContain(SECRET);
  });

  it('업로드 디렉터리 밖을 가리키는 심볼릭 링크 디렉터리의 index.html도 거부한다', async () => {
    const outside = path.join(tmpRoot, 'outside');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'index.html'), SECRET);
    fs.symlinkSync(outside, path.join(uploadsDir, 'linkdir'));

    const res = await request('/uploads/linkdir/');
    expect(res.status).toBe(403);
    expect(res.body).not.toContain(SECRET);
  });
});

describe('uploadMockPlugin — 정상 업로드와 조회', () => {
  it('업로드 후 { url } 형태의 JSON을 반환한다', async () => {
    const { res, base } = await upload([{ filename: 'network.har', content: '{}' }]);
    expect(res.headers['content-type']).toBe('application/json');
    expect(JSON.parse(res.body)).toEqual({ url: `http://localhost:5173${base}` });
    expect(base).toMatch(/^\/uploads\/\d+\/$/);
  });

  it('/uploads/<ts>/ 요청은 생성된 index.html을 반환한다', async () => {
    const { base } = await upload([
      { filename: 'qa-session.rr.json', content: '[]' },
      { filename: 'qa-network.har', content: '{"log":{}}' },
    ]);

    const res = await request(base);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(res.body).toContain(`<a href="${base}qa-session.rr.json">qa-session.rr.json</a>`);
    expect(res.body).toContain(`<a href="${base}qa-network.har">qa-network.har</a>`);
  });

  it('/uploads/<ts>/<file> 요청은 기존 MIME 매핑으로 파일을 반환한다', async () => {
    const { base } = await upload([
      { filename: 'qa-session.rr.json', content: '[1,2,3]' },
      { filename: 'qa-network.har', content: '{"log":{}}' },
      { filename: 'memo.txt', content: 'hello' },
    ]);

    const har = await request(`${base}qa-network.har`);
    expect(har.status).toBe(200);
    expect(har.headers['content-type']).toBe('application/json');
    expect(har.body).toBe('{"log":{}}');

    const session = await request(`${base}qa-session.rr.json`);
    expect(session.headers['content-type']).toBe('application/json');
    expect(session.body).toBe('[1,2,3]');

    const memo = await request(`${base}memo.txt`);
    expect(memo.headers['content-type']).toBe('application/octet-stream');
    expect(memo.body).toBe('hello');
  });

  it('쿼리스트링이 붙은 요청도 같은 파일을 반환한다', async () => {
    const { base } = await upload([{ filename: 'qa-network.har', content: '{}' }]);

    expect((await request(`${base}?v=1`)).status).toBe(200);
    const res = await request(`${base}qa-network.har?download=1`);
    expect(res.status).toBe(200);
    expect(res.body).toBe('{}');
  });

  it('공백이 포함된 파일명은 인코딩된 링크로 조회할 수 있다', async () => {
    const { base } = await upload([{ filename: 'my report.har', content: '{}' }]);

    const index = await request(base);
    expect(index.body).toContain(`href="${base}my%20report.har"`);
    const res = await request(`${base}my%20report.har`);
    expect(res.status).toBe(200);
    expect(res.body).toBe('{}');
  });

  it('업로드 디렉터리에 없는 경로는 다음 미들웨어로 넘기지 않고 플러그인이 404로 답한다', async () => {
    // 전제: 플러그인이 넘긴 요청에는 하네스의 마지막 핸들러가 FELL_THROUGH로 답한다
    expect((await request('/not-uploads')).body).toBe(FELL_THROUGH);

    const { base } = await upload([{ filename: 'qa-network.har', content: '{}' }]);
    fs.mkdirSync(path.join(uploadsDir, 'dir', 'index.html'), { recursive: true });

    for (const rawPath of [
      '/uploads/12345/missing.har',
      `${base}missing.har`,
      // 확장자를 뺀 경로 — Vite로 넘어가면 html fallback이 '.html'을 붙인 파일을 찾는다
      `${base}qa-network`,
      // index.html이 없는 업로드 디렉터리 자체
      '/uploads/',
      // 있지만 일반 파일이 아닌 경우 (index.html이 디렉터리)
      '/uploads/dir/',
    ]) {
      const res = await request(rawPath);
      expect({ rawPath, status: res.status, body: res.body }).toEqual({ rawPath, status: 404, body: 'Not Found' });
      expect(res.headers['content-type']).toBe('text/plain; charset=utf-8');
    }
  });
});

describe('uploadMockPlugin — POST /upload 입력 검증', () => {
  it('파일명의 HTML은 index.html에서 이스케이프된다', async () => {
    const filename = '<img src=x onerror=alert(1)>.har';
    const { base, dir } = await upload([{ filename, content: '{}' }]);

    const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;.har</a>');
    expect(html).toContain(`href="${base}${encodeURIComponent(filename)}"`);

    // 인코딩된 링크로 원본 파일을 받을 수 있어야 한다
    const res = await request(`${base}${encodeURIComponent(filename)}`);
    expect(res.status).toBe(200);
    expect(res.body).toBe('{}');
  });

  it('따옴표가 포함된 파일명이 href 속성을 깨지 않는다', async () => {
    const filename = `x' onmouseover='alert(1).har`;
    const { dir } = await upload([{ filename, content: '{}' }]);

    const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
    expect(html).not.toContain("x' onmouseover");
    expect(html).toContain('x&#39; onmouseover=&#39;alert(1).har</a>');
  });

  it("파일명이 '..' 또는 '.'이면 대체 이름으로 업로드 디렉터리 안에 저장한다", async () => {
    const before = fs.readdirSync(tmpRoot).sort();
    const { base, dir } = await upload([
      { filename: '..', content: 'dotdot' },
      { filename: '.', content: 'dot' },
    ]);

    expect(fs.readdirSync(dir).sort()).toEqual(['index.html', 'upload-1', 'upload-2']);
    expect(fs.readFileSync(path.join(dir, 'upload-1'), 'utf8')).toBe('dotdot');
    expect(fs.readFileSync(path.join(dir, 'upload-2'), 'utf8')).toBe('dot');
    expect(fs.readdirSync(tmpRoot).sort()).toEqual(before);

    const res = await request(base);
    expect(res.body).toContain('>upload-1</a>');
    expect(res.body).toContain('>upload-2</a>');
  });

  it('경로가 포함된 파일명은 basename만 사용한다', async () => {
    const { dir } = await upload([{ filename: '../../evil.txt', content: 'evil' }]);

    expect(fs.readdirSync(dir).sort()).toEqual(['evil.txt', 'index.html']);
    expect(fs.existsSync(path.join(tmpRoot, 'evil.txt'))).toBe(false);
  });

  it('multipart가 아닌 POST는 400을 반환하고 디렉터리를 만들지 않는다', async () => {
    const json = await request('/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"a":1}',
    });
    expect(json.status).toBe(400);

    const noType = await request('/upload', { method: 'POST', body: 'plain' });
    expect(noType.status).toBe(400);

    // busboy는 urlencoded도 파싱하므로 생성자가 throw하지 않는다 — 별도로 거부해야 한다
    const urlencoded = await request('/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'a=b',
    });
    expect(urlencoded.status).toBe(400);

    const mixed = await request('/upload', {
      method: 'POST',
      headers: { 'Content-Type': `multipart/mixed; boundary=${BOUNDARY}` },
      body: `--${BOUNDARY}--\r\n`,
    });
    expect(mixed.status).toBe(400);

    expect(fs.readdirSync(uploadsDir)).toEqual([]);
  });

  it('Content-Type 대소문자와 무관하게 multipart/form-data 업로드를 받는다', async () => {
    const { body } = multipart([{ filename: 'network.har', content: '{}' }]);
    const res = await request('/upload', {
      method: 'POST',
      headers: {
        'Content-Type': `Multipart/Form-Data; boundary=${BOUNDARY}`,
        'Content-Length': body.length,
      },
      body,
    });
    expect(res.status).toBe(200);
  });

  it("업로드 파일명 'index.html'은 생성되는 목록 페이지를 덮어쓰지 않도록 이름을 바꿔 저장한다", async () => {
    const attack = '<script>alert(document.domain)</script>';
    const { base, dir } = await upload([
      { filename: 'index.html', content: attack },
      { filename: 'INDEX.HTML', content: attack },
    ]);

    expect(fs.readdirSync(dir).sort()).toEqual([
      'index.html',
      'upload-1-index.html',
      'upload-2-INDEX.HTML',
    ]);
    const index = await request(base);
    expect(index.status).toBe(200);
    expect(index.body).not.toContain('<script>');
    expect(index.body).toContain(`<a href="${base}upload-1-index.html">upload-1-index.html</a>`);
  });

  it('같은 밀리초에 들어온 업로드는 서로 다른 디렉터리에 저장한다', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    const first = await upload([{ filename: 'a.har', content: 'first' }]);
    const second = await upload([{ filename: 'b.har', content: 'second' }]);
    vi.mocked(Date.now).mockRestore();

    expect(first.base).not.toBe(second.base);
    expect(fs.readdirSync(first.dir).sort()).toEqual(['a.har', 'index.html']);
    expect(fs.readdirSync(second.dir).sort()).toEqual(['b.har', 'index.html']);
  });

  it('잘린 multipart 본문은 400을 반환하고 디렉터리를 남기지 않는다', async () => {
    const { body, headers } = multipart([{ filename: 'network.har', content: '{}' }]);
    const truncated = body.subarray(0, body.length - `--${BOUNDARY}--\r\n`.length);

    const res = await request('/upload', {
      method: 'POST',
      headers: { ...headers, 'Content-Length': truncated.length },
      body: truncated,
    });
    expect(res.status).toBe(400);
    await waitForEmptyUploads();

    // 서버는 계속 요청을 처리할 수 있어야 한다
    await upload([{ filename: 'network.har', content: '{}' }]);
  });
});

describe('uploadMockPlugin — 실패한 업로드 정리', () => {
  it('파일 파트가 많은 본문이 중간에 잘려도 서버가 죽지 않고 디렉터리를 정리한다', async () => {
    const parts = Array.from({ length: 300 }, (_, i) => ({ filename: `f${i}.har`, content: 'x' }));
    const { body, headers } = multipart(parts);
    const truncated = body.subarray(0, body.length - `--${BOUNDARY}--\r\n`.length);

    const res = await request('/upload', {
      method: 'POST',
      headers: { ...headers, 'Content-Length': truncated.length },
      body: truncated,
    });
    expect(res.status).toBe(400);
    await waitForEmptyUploads();
    await expectAllWriteStreamsClosed();

    await upload([{ filename: 'network.har', content: '{}' }]);
  });

  it('파일 저장이 실패해도(ENAMETOOLONG) 서버가 죽지 않고 디렉터리를 정리한다', async () => {
    const parts = [
      { filename: `${'a'.repeat(300)}.har`, content: '{}' },
      ...Array.from({ length: 200 }, (_, i) => ({ filename: `f${i}.har`, content: 'x' })),
    ];
    const { body, headers } = multipart(parts);

    const res = await request('/upload', { method: 'POST', headers, body });
    expect(res.status).toBe(500);
    await waitForEmptyUploads();
    await expectAllWriteStreamsClosed();

    await upload([{ filename: 'network.har', content: '{}' }]);
  });

  it('실패 시점에 받는 중이던 파일 파트의 스트림도 닫는다 (fd 누수 방지)', async () => {
    const { body, headers } = multipart([
      { filename: 'ok.har', content: '{}' },
      { filename: `${'a'.repeat(300)}.har`, content: '{}' },
      { filename: 'pending.har', content: 'x'.repeat(64) },
    ]);
    // 세 번째 파트의 내용 중간까지만 보내고 요청은 열어 둔다
    const partial = body.subarray(0, body.length - `\r\n--${BOUNDARY}--\r\n`.length - 32);
    const { req, response } = openUpload(headers, partial);

    try {
      const res = await response;
      expect(res.status).toBe(500);
      expect(writeStreams().length).toBeGreaterThanOrEqual(2);
      // 연결이 아직 열려 있어도 받는 중이던 파일의 스트림까지 닫혀야 한다
      await expectAllWriteStreamsClosed();
      await waitForEmptyUploads();
    } finally {
      req.destroy();
    }
  });

  it('클라이언트가 업로드 도중 연결을 끊으면 스트림을 닫고 디렉터리를 정리한다', async () => {
    const { body, headers } = multipart([{ filename: 'network.har', content: 'x'.repeat(256) }]);
    const { req } = openUpload(headers, body.subarray(0, body.length - 128));

    await vi.waitFor(() => expect(writeStreams().length).toBe(1));
    req.destroy();

    await expectAllWriteStreamsClosed();
    await waitForEmptyUploads();
    await upload([{ filename: 'network.har', content: '{}' }]);
  });
});

describe('uploadMockPlugin — 업로드된 내용의 격리', () => {
  it('업로드된 HTML 파일은 기존 MIME으로 주되 sandbox CSP(고유 origin, 스크립트만 허용)와 nosniff로 격리한다', async () => {
    const { base } = await upload([
      { filename: 'evil.html', content: '<script>alert(document.domain)</script>' },
      { filename: 'qa-network.har', content: '{}' },
    ]);

    const evil = await request(`${base}evil.html`);
    expect(evil.status).toBe(200);
    expect(evil.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(evil.headers['content-security-policy']).toBe('sandbox allow-scripts');
    expect(evil.headers['x-content-type-options']).toBe('nosniff');

    const har = await request(`${base}qa-network.har`);
    expect(har.headers['content-security-policy']).toBe('sandbox allow-scripts');
    expect(har.headers['x-content-type-options']).toBe('nosniff');
  });

  it('생성된 목록 페이지는 sandbox 없이 서빙한다', async () => {
    const { base } = await upload([{ filename: 'qa-network.har', content: '{}' }]);

    for (const url of [base, `${base}index.html`]) {
      const res = await request(url);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
      expect(res.headers['content-security-policy']).toBeUndefined();
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    }
  });
});

describe('uploadMockPlugin — Vite root에 남은 예전 uploads 경고 (configResolved)', () => {
  let viteRoot: string;
  let legacy: string;

  beforeEach(() => {
    viteRoot = path.join(tmpRoot, 'demo');
    fs.mkdirSync(viteRoot);
    legacy = path.join(viteRoot, 'uploads');
  });

  /** root와 logger만 있는 설정으로 configResolved를 호출하고 logger.warn으로 남긴 메시지를 돌려준다 */
  async function configResolvedWarnings(): Promise<string[]> {
    const warn = vi.fn<(msg: string) => void>();
    const hook = uploadMockPlugin(uploadsDir).configResolved;
    const handler = typeof hook === 'function' ? hook : hook?.handler;
    await handler?.({ root: viteRoot, logger: { warn } } as unknown as ResolvedConfig);
    return warn.mock.calls.map(([msg]) => msg);
  }

  it.each<[string, () => void]>([
    [
      '업로드가 남은 디렉터리',
      () => {
        fs.mkdirSync(path.join(legacy, '1700000000000'), { recursive: true });
        fs.writeFileSync(path.join(legacy, '1700000000000', 'evil.html'), '<script>alert(1)</script>');
      },
    ],
    ['일반 파일', () => fs.writeFileSync(legacy, '')],
    ['가리키는 곳이 없는 심볼릭 링크', () => fs.symlinkSync(path.join(tmpRoot, 'missing'), legacy)],
  ])('Vite root에 uploads(%s)가 있으면 지우라고 한 번 경고한다', async (_kind, createLegacy) => {
    createLegacy();

    const warnings = await configResolvedWarnings();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(`Found ${legacy}. Older versions of the demo saved uploads there.`);
    expect(warnings[0]).toContain('//uploads/<ts>/<file>');
    expect(warnings[0]).toContain('Content-Security-Policy: sandbox');
    expect(warnings[0]).toContain('Delete it');
  });

  it('Vite root에 uploads가 없으면 경고하지 않는다', async () => {
    expect(await configResolvedWarnings()).toEqual([]);
  });
});

/** pnpm 워크스페이스를 흉내 낸 임시 디렉터리 구조 */
interface Workspace {
  /** pnpm-workspace.yaml이 있는 워크스페이스 루트 — Vite의 기본 server.fs.allow가 된다 */
  dir: string;
  /** Vite root (packages/sdk/demo) */
  demoRoot: string;
  /** pnpm이 만드는 링크 node_modules/.pnpm/node_modules/qa-recorder -> packages/sdk */
  alias: string;
}

function createWorkspace(dir: string): Workspace {
  const pkgDir = path.join(dir, 'packages', 'sdk');
  const demoRoot = path.join(pkgDir, 'demo');
  const alias = path.join(dir, 'node_modules', '.pnpm', 'node_modules', 'qa-recorder');
  fs.mkdirSync(demoRoot, { recursive: true });
  fs.mkdirSync(path.dirname(alias), { recursive: true });
  fs.writeFileSync(path.join(dir, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n");
  fs.writeFileSync(path.join(pkgDir, 'package.json'), '{ "name": "qa-recorder" }\n');
  fs.writeFileSync(path.join(demoRoot, 'index.html'), '<!DOCTYPE html>\n<title>demo</title>\n');
  // pnpm처럼 상대 경로 링크(../../../packages/sdk)로 만든다
  fs.symlinkSync(path.relative(path.dirname(alias), pkgDir), alias, 'dir');
  return { dir, demoRoot, alias };
}

/** '/@fs/<절대 경로>' URL (Vite가 파일 시스템 경로를 직접 서빙하는 경로) */
function fsUrl(file: string): string {
  return `/@fs/${encodeURI(file.replace(/\\/g, '/').replace(/^\//, ''))}`;
}

describe('uploadMockPlugin — Vite dev 서버 위에서의 격리', () => {
  const PAYLOAD = 'PWNED-BY-UPLOADED-CONTENT';

  let ws: Workspace;
  let viteUploads: string;
  let vite: ViteDevServer;
  let viteHttp: http.Server;
  let vitePort: number;

  beforeEach(async () => {
    // vite.config.ts와 같은 배치: Vite root(demo/)는 pnpm 워크스페이스(= server.fs.allow) 안에 있고,
    // 업로드 디렉터리는 워크스페이스 밖의 별도 임시 디렉터리다
    ws = createWorkspace(path.join(tmpRoot, 'workspace'));
    viteUploads = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'qa-upload-mock-uploads-')));
    // Vite 5는 port 0을 기본 포트로 바꾸므로 middlewareMode로 같은 미들웨어 스택을 임의 포트의 서버에 붙인다
    vite = await createServer({
      configFile: false,
      root: ws.demoRoot,
      logLevel: 'silent',
      plugins: [uploadMockPlugin(viteUploads)],
      optimizeDeps: { noDiscovery: true },
      server: { middlewareMode: true, ws: false, watch: null },
    });
    viteHttp = http.createServer(vite.middlewares);
    await new Promise<void>((resolve) => viteHttp.listen(0, '127.0.0.1', resolve));
    vitePort = (viteHttp.address() as AddressInfo).port;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => viteHttp.close(() => resolve()));
    await vite.close();
    fs.rmSync(viteUploads, { recursive: true, force: true });
  });

  it('/uploads/ 경로는 sandbox와 함께 서빙하고, /@fs/·다른 URL 표기·pnpm 링크를 거친 예전 위치로는 업로드 내용이 나가지 않는다', async () => {
    const { base } = await upload(
      [
        { filename: 'evil.html', content: `<script>document.title='${PAYLOAD}'</script>` },
        { filename: 'evil.svg', content: `<svg xmlns="http://www.w3.org/2000/svg" onload="alert('${PAYLOAD}')"/>` },
      ],
      { port: vitePort, uploadsDir: viteUploads },
    );
    const ts = base.slice('/uploads/'.length, -1);
    const get = (rawPath: string) => request(rawPath, { port: vitePort, headers: { Accept: 'text/html' } });

    // 전제: pnpm-workspace.yaml이 있으므로 server.fs.allow는 워크스페이스 루트다
    expect(vite.config.server.fs.allow).toContain(ws.dir);

    for (const file of ['evil.html', 'evil.svg']) {
      const res = await get(`${base}${file}`);
      expect(res.status).toBe(200);
      expect(res.body).toContain(PAYLOAD);
      expect(res.headers['content-security-policy']).toBe('sandbox allow-scripts');
      expect(res.headers['x-content-type-options']).toBe('nosniff');

      // 업로드 디렉터리는 server.fs.allow 밖이므로 /@fs/로 직접 요청하면 Vite가 403으로 거부한다
      const direct = await get(fsUrl(path.join(viteUploads, ts, file)));
      expect({ file, status: direct.status }).toEqual({ file, status: 403 });
      expect(direct.body).not.toContain(PAYLOAD);
    }

    // 확장자를 뺀 경로는 Vite(html fallback)로 넘어가지 않고 플러그인이 404로 답한다
    const extensionless = await get(`/uploads/${ts}/evil`);
    expect({ status: extensionless.status, body: extensionless.body }).toEqual({ status: 404, body: 'Not Found' });

    for (const rawPath of [
      // 플러그인이 처리하지 않는 표기 — Vite의 미들웨어로 넘어간다
      `//uploads/${ts}/evil.html`,
      `/%75ploads/${ts}/evil.html`,
      `//uploads/${ts}/evil.svg`,
      `/%75ploads/${ts}/evil.svg`,
      // pnpm 링크를 거친 예전 업로드 위치(demo/uploads)
      fsUrl(path.join(ws.alias, 'demo', 'uploads', ts, 'evil.html')),
      fsUrl(path.join(ws.alias, 'demo', 'uploads', ts, 'evil.svg')),
    ]) {
      const res = await get(rawPath);
      expect({ rawPath, leaked: res.body.includes(PAYLOAD) }).toEqual({ rawPath, leaked: false });
    }
  });
});

/** child가 dir 자신이거나 그 하위 경로인지 */
function isInsideDir(dir: string, child: string): boolean {
  const rel = path.relative(dir, child);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

describe('uploadMockPlugin — 실제 vite.config.ts', () => {
  it('`pnpm demo` 설정은 Vite root와 저장소 밖에 소유자 전용(0700) 임시 업로드 디렉터리를 만든다', async () => {
    // 설정 파일을 CJS로 불러오면서 Vite가 console.warn으로 남기는 CJS API 안내는 이 테스트와 무관하다
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sdkDir = fileURLToPath(new URL('../..', import.meta.url));
    const repoRoot = path.resolve(sdkDir, '../..');

    const loaded = await loadConfigFromFile(
      { command: 'serve', mode: 'development' },
      path.join(sdkDir, 'vite.config.ts'),
      sdkDir,
      'silent',
    );
    const plugins = (loaded?.config.plugins ?? []) as Plugin<UploadMockPluginApi>[];
    const uploads = plugins.find((p) => p?.name === 'qa-upload-mock')?.api?.uploadsDir;
    if (!uploads) throw new Error('vite.config.ts does not register the qa-upload-mock plugin');

    try {
      // Vite root(demo/)나 저장소(= server.fs.allow인 워크스페이스 루트) 안이면 Vite가 업로드 파일을 sandbox 헤더 없이 서빙할 수 있다
      for (const dir of [path.join(sdkDir, 'demo'), repoRoot]) {
        expect({ dir, inside: isInsideDir(dir, uploads) }).toEqual({ dir, inside: false });
      }
      const stat = fs.lstatSync(uploads);
      expect(stat.isDirectory()).toBe(true);
      if (process.platform !== 'win32') expect((stat.mode & 0o777).toString(8)).toBe('700');
    } finally {
      // 설정이 엉뚱한 경로(예: 저장소 안)를 가리키게 바뀐 경우 그 디렉터리를 지우지 않도록, 이 설정이 만든 임시 디렉터리일 때만 지운다
      const createdByConfig =
        path.dirname(uploads) === fs.realpathSync(os.tmpdir()) || path.dirname(uploads) === path.resolve(os.tmpdir());
      if (createdByConfig && path.basename(uploads).startsWith('qa-recorder-demo-uploads-')) {
        fs.rmSync(uploads, { recursive: true, force: true });
      }
    }
  });
});
