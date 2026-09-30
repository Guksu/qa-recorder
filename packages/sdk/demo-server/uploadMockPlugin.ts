import type { Connect, Plugin } from 'vite';
import type { ServerResponse } from 'http';
import busboy from 'busboy';
import fs from 'fs';
import path from 'path';

const UPLOADS_PREFIX = '/uploads/';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json',
  '.har':  'application/json',
};

type ResolveResult = { ok: true; target: string } | { ok: false; status: 400 | 403 };

/** target이 root 자신이거나 root 하위 경로인지 확인 (접두사만 같은 형제 디렉터리는 제외) */
function isInside(root: string, target: string): boolean {
  return target === root || target.startsWith(root + path.sep);
}

/** 심볼릭 링크를 모두 풀었을 때도 root 하위인지 확인 */
function isRealInside(root: string, target: string): boolean {
  return isInside(fs.realpathSync(root), fs.realpathSync(target));
}

/**
 * GET /uploads/* 의 URL을 업로드 디렉터리 내부의 절대 경로로 변환한다.
 * 디렉터리 밖을 가리키면 403, 해석할 수 없는 URL이면 400.
 */
function resolveUploadTarget(root: string, url: string): ResolveResult {
  // 쿼리스트링/해시는 파일 경로가 아니므로 제거
  const pathname = url.replace(/[?#][\s\S]*$/, '');
  let rel: string;
  try {
    rel = decodeURIComponent(pathname.slice(UPLOADS_PREFIX.length));
  } catch {
    return { ok: false, status: 400 };
  }
  if (rel.includes('\0')) return { ok: false, status: 400 };

  // 플랫폼과 무관하게 '\'도 구분자로 보고 '..' 세그먼트를 거부
  if (rel.split(/[\\/]/).includes('..')) return { ok: false, status: 403 };

  // 절대 경로('/etc/passwd' 등)가 섞여도 최종 결과로 판정
  const target = path.resolve(root, rel);
  if (!isInside(root, target)) return { ok: false, status: 403 };
  return { ok: true, target };
}

/**
 * 업로드 파일명을 디렉터리 안에 안전하게 저장할 수 있는 이름으로 정리한다.
 * busboy가 기본으로 basename을 적용하지만 '', '.', '..'은 그대로 올 수 있다.
 */
function sanitizeFilename(name: string | undefined, fallback: string): string {
  const base = (name ?? '').split(/[\\/]/).pop() ?? '';
  // NUL 등 제어 문자는 fs 호출을 실패시키므로 제거
  const cleaned = base.replace(/[\x00-\x1f\x7f]/g, '').trim();
  if (cleaned === '' || cleaned === '.' || cleaned === '..') return fallback;
  return cleaned;
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

function sendText(res: ServerResponse, status: number, message: string): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end(message);
}

function renderIndex(ts: number, filenames: string[]): string {
  // 파일명은 사용자 입력이므로 텍스트는 HTML 이스케이프, href는 URL 인코딩
  const links = filenames
    .map((name) => {
      const href = `/uploads/${ts}/${encodeURIComponent(name)}`;
      return `<li><a href="${escapeHtml(href)}">${escapeHtml(name)}</a></li>`;
    })
    .join('\n');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Upload saved</title>
  <style>
    body { font-family: -apple-system, sans-serif; max-width: 600px; margin: 60px auto; padding: 0 20px; color: #1a202c; }
    h2 { color: #0f172a; margin-bottom: 6px; }
    p  { color: #64748b; font-size: 14px; margin: 0 0 20px; }
    ul { list-style: none; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    li a {
      display: block; padding: 12px 16px; background: #f8fafc;
      border: 1px solid #e2e8f0; border-radius: 8px; text-decoration: none;
      color: #3b82f6; font-size: 14px; font-family: monospace;
    }
    li a:hover { background: #eff6ff; border-color: #bfdbfe; }
  </style>
</head>
<body>
  <h2>✅ Upload received</h2>
  <p>Saved at ${new Date(ts).toLocaleString()}</p>
  <ul>${links}</ul>
</body>
</html>`;
}

/** POST /upload — multipart를 파싱해 파일을 저장하고 공유 URL을 반환 */
function createUploadHandler(root: string): Connect.NextHandleFunction {
  return (req, res, next) => {
    if (req.url !== '/upload' || req.method !== 'POST') return next();

    // multipart가 아니면 busboy 생성자가 동기적으로 throw — 디렉터리를 만들기 전에 거른다
    let bb: busboy.Busboy;
    try {
      bb = busboy({ headers: req.headers });
    } catch {
      req.resume();
      sendText(res, 400, 'Expected a multipart/form-data request');
      return;
    }

    const ts = Date.now();
    const dir = path.join(root, String(ts));
    fs.mkdirSync(dir, { recursive: true });

    const saved: string[] = [];
    let pendingWrites = 0;
    let parsed = false;
    let failed = false;

    // 실패 시 요청을 버리고 만들던 디렉터리를 지운다
    const fail = (status: number, message: string) => {
      if (failed || res.headersSent) return;
      failed = true;
      req.unpipe(bb);
      req.resume();
      fs.rmSync(dir, { recursive: true, force: true });
      sendText(res, status, message);
    };

    // 파싱이 끝나고 모든 파일이 디스크에 써진 뒤에 목록을 만들고 응답한다
    const complete = () => {
      if (failed || !parsed || pendingWrites > 0) return;
      try {
        fs.writeFileSync(path.join(dir, 'index.html'), renderIndex(ts, saved));
      } catch {
        fail(500, 'Failed to save upload index');
        return;
      }

      console.log(
        `[qa-upload-mock] saved ${saved.length} file(s) → ${path.relative(process.cwd(), dir)}/`,
      );

      res.setHeader('Content-Type', 'application/json');
      res.statusCode = 200;
      res.end(JSON.stringify({ url: `http://localhost:5173/uploads/${ts}/` }));
    };

    bb.on('file', (_field, stream, info) => {
      if (failed) {
        stream.resume();
        return;
      }
      const filename = sanitizeFilename(info.filename, `upload-${saved.length + 1}`);
      saved.push(filename);
      pendingWrites++;

      const out = fs.createWriteStream(path.join(dir, filename));
      out.on('finish', () => {
        pendingWrites--;
        complete();
      });
      out.on('error', () => {
        // 남은 데이터를 흘려보내야 busboy가 멈추지 않는다
        stream.unpipe(out);
        stream.resume();
        fail(500, 'Failed to save uploaded file');
      });
      // 본문이 중간에 끊기면 busboy가 파일 스트림을 에러로 파기한다 — 리스너가 없으면 프로세스가 죽는다
      stream.on('error', () => {
        out.destroy();
        fail(400, 'Malformed multipart body');
      });
      stream.pipe(out);
    });

    bb.on('error', () => fail(400, 'Malformed multipart body'));

    bb.on('finish', () => {
      parsed = true;
      complete();
    });

    req.pipe(bb);
  };
}

/** GET /uploads/* — Vite가 하위 디렉터리를 자동 서빙하지 않으므로 직접 처리 */
function createServeHandler(root: string): Connect.NextHandleFunction {
  return (req, res, next) => {
    if (!req.url?.startsWith(UPLOADS_PREFIX)) return next();

    const resolved = resolveUploadTarget(root, req.url);
    if (!resolved.ok) {
      sendText(res, resolved.status, resolved.status === 400 ? 'Bad Request' : 'Forbidden');
      return;
    }

    let file = resolved.target;
    let stat: fs.Stats;
    try {
      stat = fs.statSync(file);
      if (stat.isDirectory()) {
        file = path.join(file, 'index.html');
        stat = fs.statSync(file);
      }
    } catch {
      return next();
    }
    if (!stat.isFile()) return next();

    // 심볼릭 링크로 업로드 디렉터리 밖을 가리키는 경우 차단
    if (!isRealInside(root, resolved.target) || !isRealInside(root, file)) {
      sendText(res, 403, 'Forbidden');
      return;
    }

    res.setHeader('Content-Type', MIME[path.extname(file)] ?? 'application/octet-stream');
    res.end(fs.readFileSync(file));
  };
}

/**
 * `pnpm demo` 전용 업로드 목 서버.
 * RemoteDelivery가 보내는 multipart를 uploadsDir/<timestamp>/ 에 저장하고 다시 서빙한다.
 */
export function uploadMockPlugin(uploadsDir: string): Plugin {
  const root = path.resolve(uploadsDir);
  return {
    name: 'qa-upload-mock',
    configureServer(server) {
      server.middlewares.use(createUploadHandler(root));
      server.middlewares.use(createServeHandler(root));
    },
  };
}
