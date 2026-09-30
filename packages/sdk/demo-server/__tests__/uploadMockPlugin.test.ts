// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Connect, ViteDevServer } from 'vite';
import { uploadMockPlugin } from '../uploadMockPlugin.js';

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
        res.end('Not Found');
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

/** 경로를 정규화하지 않고 그대로 보내는 요청 */
function request(
  rawPath: string,
  opts: { method?: string; headers?: http.OutgoingHttpHeaders; body?: Buffer | string } = {},
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
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

async function upload(parts: Part[]): Promise<{ res: RawResponse; base: string; dir: string }> {
  const { body, headers } = multipart(parts);
  const res = await request('/upload', { method: 'POST', headers, body });
  expect(res.status).toBe(200);
  const base = new URL(JSON.parse(res.body).url).pathname;
  return { res, base, dir: path.join(uploadsDir, base.slice('/uploads/'.length)) };
}

beforeEach(async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
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

  it('존재하지 않는 파일은 다음 미들웨어로 넘긴다', async () => {
    const res = await request('/uploads/12345/missing.har');
    expect(res.status).toBe(404);
    expect(res.body).toBe('Not Found');
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

    expect(fs.readdirSync(uploadsDir)).toEqual([]);
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
    expect(fs.readdirSync(uploadsDir)).toEqual([]);

    // 서버는 계속 요청을 처리할 수 있어야 한다
    await upload([{ filename: 'network.har', content: '{}' }]);
  });
});
