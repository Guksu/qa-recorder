import { defineConfig } from 'vite';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { uploadMockPlugin } from './demo-server/uploadMockPlugin';

// 업로드 파일은 dev 서버를 시작(재시작 포함)할 때마다 새로 만드는 비공개(0700) 임시 디렉터리에 저장한다.
// 이 디렉터리는 Vite root(demo/)와 server.fs.allow(워크스페이스 루트) 밖이므로 Vite의 정적 파일 서빙과 /@fs/ 경로는 이 디렉터리를 서빙하지 않는다.
// (Vite 5.4의 optimized deps sourcemap(.map) 요청은 예외 — demo-server/uploadMockPlugin.ts의 JSDoc 참고)
// 이름도 시작할 때마다 새로 정해지는 임의의 이름이라 다른 누군가가 미리 만들어 둔 디렉터리를 이어서 쓰는 일이 없다.
// 업로드는 재시작하면 이어지지 않는다 (돌려주는 URL도 어차피 이 dev 서버가 떠 있는 동안만 동작한다).
const UPLOADS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-recorder-demo-uploads-'));

export default defineConfig({
  plugins: [uploadMockPlugin(UPLOADS_DIR)],
});
