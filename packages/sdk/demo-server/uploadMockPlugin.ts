import type { Connect, Plugin } from 'vite';
import type { ServerResponse } from 'http';
import busboy from 'busboy';
import fs from 'fs';
import path from 'path';

const UPLOADS_PREFIX = '/uploads/';
const INDEX_FILE = 'index.html';
/** 업로드 파일에 붙이는 CSP — 고유 origin에서 열되 스크립트는 허용 */
const UPLOAD_CSP = 'sandbox allow-scripts';

// busboy는 urlencoded 본문도 받아들이므로 multipart/form-data인지 직접 확인한다
const MULTIPART_FORM_DATA = /^\s*multipart\/form-data\s*(?:;|$)/i;

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
  // 생성되는 목록 페이지(index.html)를 덮어쓰거나 대신 서빙되지 않도록 이름을 바꾼다
  if (cleaned.toLowerCase() === INDEX_FILE) return `${fallback}-${cleaned}`;
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

/** 같은 밀리초에 들어온 업로드가 디렉터리를 공유하지 않도록 아직 없는 타임스탬프 디렉터리를 만든다 */
function createUploadDir(root: string): { ts: number; dir: string } {
  fs.mkdirSync(root, { recursive: true });
  for (let ts = Date.now(); ; ts++) {
    const dir = path.join(root, String(ts));
    try {
      fs.mkdirSync(dir);
      return { ts, dir };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
  }
}

function waitForClose(stream: fs.WriteStream): Promise<void> {
  return new Promise((resolve) => {
    if (stream.closed) resolve();
    else stream.once('close', () => resolve());
  });
}

/** POST /upload — multipart를 파싱해 파일을 저장하고 공유 URL을 반환 */
function createUploadHandler(root: string): Connect.NextHandleFunction {
  return (req, res, next) => {
    if (req.url !== '/upload' || req.method !== 'POST') return next();

    const reject = (status: number, message: string) => {
      req.resume();
      sendText(res, status, message);
    };

    // multipart/form-data가 아니면 디렉터리를 만들기 전에 거른다.
    // (busboy는 urlencoded를 그대로 받아들이고, 그 밖의 형식이나 boundary 누락은 생성자가 동기적으로 throw)
    if (!MULTIPART_FORM_DATA.test(req.headers['content-type'] ?? '')) {
      reject(400, 'Expected a multipart/form-data request');
      return;
    }
    let bb: busboy.Busboy;
    try {
      bb = busboy({ headers: req.headers });
    } catch {
      reject(400, 'Expected a multipart/form-data request');
      return;
    }

    let ts: number;
    let dir: string;
    try {
      ({ ts, dir } = createUploadDir(root));
    } catch {
      reject(500, 'Failed to create upload directory');
      return;
    }

    const saved: string[] = [];
    const outs: fs.WriteStream[] = [];
    let pendingWrites = 0;
    let parsed = false;
    let failed = false;

    // 실패하면 먼저 응답한 뒤 파서와 열린 파일 스트림을 모두 닫고, 전부 닫힌 다음에 디렉터리를 비동기로 지운다.
    // 열리는 중인 스트림이 남은 상태에서 동기 rmSync를 하면 ENOTEMPTY로 throw해 dev 서버가 죽고,
    // busboy를 파기하지 않으면 받는 중이던 파일 스트림이 끝나지 않아 fd가 샌다.
    const fail = (status: number, message: string) => {
      if (failed || res.headersSent) return;
      failed = true;
      req.unpipe(bb);
      req.resume();
      sendText(res, status, message);

      bb.destroy();
      const closed = outs.map(waitForClose);
      for (const out of outs) out.destroy();
      Promise.all(closed)
        .then(() => fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 3 }))
        .catch((err: unknown) => {
          console.warn(`[qa-upload-mock] failed to clean up ${dir}${path.sep}`, err);
        });
    };

    // 파싱이 끝나고 모든 파일이 디스크에 써진 뒤에 목록을 만들고 응답한다
    const complete = () => {
      if (failed || !parsed || pendingWrites > 0) return;
      try {
        fs.writeFileSync(path.join(dir, INDEX_FILE), renderIndex(ts, saved));
      } catch {
        fail(500, 'Failed to save upload index');
        return;
      }

      // 업로드 디렉터리는 작업 디렉터리 밖에 있으므로(vite.config.ts는 OS 임시 디렉터리를 쓴다) 절대 경로로 출력한다
      console.log(`[qa-upload-mock] saved ${saved.length} file(s) → ${dir}${path.sep}`);

      res.setHeader('Content-Type', 'application/json');
      res.statusCode = 200;
      res.end(JSON.stringify({ url: `http://localhost:5173/uploads/${ts}/` }));
    };

    bb.on('file', (_field, stream, info) => {
      if (failed) {
        stream.on('error', () => {});
        stream.resume();
        return;
      }
      const filename = sanitizeFilename(info.filename, `upload-${saved.length + 1}`);
      saved.push(filename);
      pendingWrites++;

      const out = fs.createWriteStream(path.join(dir, filename));
      outs.push(out);
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

    // 본문을 다 받기 전에 클라이언트가 연결을 끊으면 busboy가 끝나지 않으므로 여기서 정리한다
    req.on('close', () => {
      if (!req.complete) fail(400, 'Upload aborted');
    });

    req.pipe(bb);
  };
}

/** <uploadsDir>/<ts>/index.html — 업로드 내용이 아니라 플러그인이 직접 만든 목록 페이지 */
function isGeneratedIndex(root: string, file: string): boolean {
  return path.basename(file) === INDEX_FILE && path.dirname(path.dirname(file)) === root;
}

/**
 * GET /uploads/* — 업로드 파일을 sandbox 헤더와 함께 서빙한다.
 * '/uploads/'로 시작하는 요청은 없는 파일이어도(404) 모두 여기서 응답하고 다음 미들웨어(Vite)로 넘기지 않는다.
 */
function createServeHandler(root: string): Connect.NextHandleFunction {
  return (req, res, next) => {
    if (!req.url?.startsWith(UPLOADS_PREFIX)) return next();

    const resolved = resolveUploadTarget(root, req.url);
    if (!resolved.ok) {
      sendText(res, resolved.status, resolved.status === 400 ? 'Bad Request' : 'Forbidden');
      return;
    }

    let file = resolved.target;
    let stat: fs.Stats | undefined;
    try {
      stat = fs.statSync(file);
      if (stat.isDirectory()) {
        file = path.join(file, INDEX_FILE);
        stat = fs.statSync(file);
      }
    } catch {
      stat = undefined;
    }
    // 없거나 일반 파일이 아니어도 Vite로 넘기지 않는다. 넘기면 Vite가 root에 남은 예전 uploads/ 폴더에서 같은 경로의 파일
    // (확장자가 없으면 '.html'을 붙인 파일)을 sandbox 헤더 없이 서빙하거나 SPA fallback으로 데모 페이지를 돌려준다
    if (!stat?.isFile()) {
      sendText(res, 404, 'Not Found');
      return;
    }

    // 심볼릭 링크로 업로드 디렉터리 밖을 가리키는 경우 차단
    if (!isRealInside(root, resolved.target) || !isRealInside(root, file)) {
      sendText(res, 403, 'Forbidden');
      return;
    }

    res.setHeader('Content-Type', MIME[path.extname(file)] ?? 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // 업로드된 파일은 LAN의 누구나 올릴 수 있는 내용이다 — sandbox로 dev origin과 분리된 고유(opaque) origin에서 연다.
    // 업로드된 QA 리포트(qa-report-*.html)의 재생기가 동작하도록 스크립트만 허용한다 (allow-same-origin은 주지 않으므로
    // 스크립트가 돌아도 dev origin의 쿠키·저장소에는 접근하지 못한다)
    if (!isGeneratedIndex(root, file)) res.setHeader('Content-Security-Policy', UPLOAD_CSP);
    res.end(fs.readFileSync(file));
  };
}

/** 링크를 따라가지 않고, 그 경로에 무엇이든(디렉터리, 파일, 가리키는 곳이 없는 링크 포함) 있는지 확인 */
function entryExists(p: string): boolean {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

/** 플러그인의 api — 테스트가 vite.config.ts가 넘긴 업로드 디렉터리를 확인할 때 쓴다 */
export interface UploadMockPluginApi {
  /** 업로드 파일을 저장하는 디렉터리 (절대 경로) */
  uploadsDir: string;
}

/**
 * `pnpm demo` 전용 업로드 목 서버.
 * RemoteDelivery가 보내는 multipart를 uploadsDir/<timestamp>/ 에 저장하고 GET /uploads/* 로 다시 서빙한다.
 * 업로드 파일은 sandbox 헤더(Content-Security-Policy: sandbox allow-scripts, X-Content-Type-Options: nosniff)를 붙이는
 * GET /uploads/* 로만 서빙하려는 것이고, '/uploads/'로 시작하는 요청은 없는 파일이어도(404) 모두 이 플러그인이 응답한다.
 *
 * uploadsDir는 Vite root와 server.fs.allow 밖이어야 한다 (vite.config.ts는 시작할 때마다 새로 만든 임시 디렉터리를 넘긴다).
 * 그러면 Vite의 root·server.fs.allow 검사 때문에 Vite의 정적 파일 서빙과 /@fs/ 경로는 그 안의 파일을 서빙하지 않는다
 * (Vite 5.4가 fs.allow 검사 없이 JSON으로 답하는 optimized deps의 sourcemap(.map) 요청은 Vite 쪽 예외다).
 * root나 server.fs.allow 안에 두면 Vite가 이 플러그인을 거치지 않는 다른 URL('//uploads/<ts>/<file>', '/@fs/..' 등)로
 * 업로드된 HTML/SVG를 sandbox 헤더 없이 dev origin에서 서빙한다. 예전 버전의 데모는 업로드를 <Vite root>/uploads 에
 * 저장했으므로, configResolved는 그 자리에 무엇이든 남아 있으면 지우라고 경고한다.
 */
export function uploadMockPlugin(uploadsDir: string): Plugin<UploadMockPluginApi> {
  const root = path.resolve(uploadsDir);
  return {
    name: 'qa-upload-mock',
    api: { uploadsDir: root },
    configResolved(config) {
      const legacyDir = path.join(config.root, 'uploads');
      if (!entryExists(legacyDir)) return;
      config.logger.warn(
        [
          `[qa-upload-mock] Found ${legacyDir}. Older versions of the demo saved uploads there.`,
          'Vite can serve files inside its root directly through other URL spellings (e.g. //uploads/<ts>/<file>)',
          'without the "Content-Security-Policy: sandbox" and "X-Content-Type-Options: nosniff" headers that GET /uploads/* adds.',
          `Delete it (uploads are now saved in ${root}).`,
        ].join('\n'),
      );
    },
    configureServer(server) {
      server.middlewares.use(createUploadHandler(root));
      server.middlewares.use(createServeHandler(root));
    },
  };
}
