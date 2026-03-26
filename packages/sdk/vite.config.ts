import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import busboy from 'busboy';
import fs from 'fs';
import path from 'path';

const UPLOADS_DIR = path.resolve(__dirname, 'demo/uploads');

function uploadMockPlugin(): Plugin {
  return {
    name: 'qa-upload-mock',
    configureServer(server) {
      // POST /upload — parse multipart, save files, return URL
      server.middlewares.use((req, res, next) => {
        if (req.url !== '/upload' || req.method !== 'POST') return next();

        const ts = Date.now();
        const dir = path.join(UPLOADS_DIR, String(ts));
        fs.mkdirSync(dir, { recursive: true });

        const saved: { filename: string }[] = [];

        const bb = busboy({ headers: req.headers as Record<string, string> });

        bb.on('file', (_field, stream, info) => {
          const dest = path.join(dir, info.filename);
          saved.push({ filename: info.filename });
          stream.pipe(fs.createWriteStream(dest));
        });

        bb.on('finish', () => {
          // Generate a simple index page listing the saved files
          const links = saved
            .map((f) => `<li><a href="/uploads/${ts}/${f.filename}">${f.filename}</a></li>`)
            .join('\n');
          const html = `<!DOCTYPE html>
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
          fs.writeFileSync(path.join(dir, 'index.html'), html);

          console.log(`[qa-upload-mock] saved ${saved.length} file(s) → demo/uploads/${ts}/`);

          res.setHeader('Content-Type', 'application/json');
          res.statusCode = 200;
          res.end(JSON.stringify({ url: `http://localhost:5173/uploads/${ts}/` }));
        });

        req.pipe(bb);
      });

      // Serve /uploads/* — Vite doesn't auto-serve subdirectories, so handle manually
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/uploads/')) return next();

        const rel = req.url.replace('/uploads/', '');
        const target = path.join(UPLOADS_DIR, rel || '');

        if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
          const index = path.join(target, 'index.html');
          if (fs.existsSync(index)) {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.end(fs.readFileSync(index));
            return;
          }
        }
        if (fs.existsSync(target) && fs.statSync(target).isFile()) {
          const ext = path.extname(target);
          const mime: Record<string, string> = {
            '.html': 'text/html; charset=utf-8',
            '.json': 'application/json',
            '.har':  'application/json',
          };
          res.setHeader('Content-Type', mime[ext] ?? 'application/octet-stream');
          res.end(fs.readFileSync(target));
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [uploadMockPlugin()],
});
