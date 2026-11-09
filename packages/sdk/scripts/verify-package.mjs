#!/usr/bin/env node
/**
 * 배포 패키지 검증: 빌드된 SDK를 `pnpm pack`으로 실제 tarball로 만들고, 저장소 밖의 임시 디렉터리에 만든
 * 독립 프로젝트에 npm으로 설치해 소비자 입장에서 확인한다.
 *
 * 1. tarball에 필요한 파일(LICENSE, README.md, 번들, 타입)이 있고 소스맵 외의 불필요한 파일이 없는지
 * 2. 배포되는 .d.ts가 패키지 밖의 모듈(비공개 workspace 패키지 등)을 참조하지 않는지
 * 3. package.json에 workspace: 프로토콜이나 번들에 이미 포함된 런타임 의존성이 남지 않았는지
 * 4. 소비자 프로젝트가 skipLibCheck 없이 moduleResolution bundler / nodenext / node10에서 타입 검사를 통과하는지
 *    (공개 타입이 any로 무너지지 않았는지도 @ts-expect-error로 확인)
 * 5. 설치된 패키지를 브라우저 없이 import해도 throw하지 않는지 (SSR 환경에서의 import)
 *
 * 사용법: pnpm -F qa-recorder build && pnpm -F qa-recorder verify:package
 * QA_RECORDER_KEEP_CONSUMER=1 이면 임시 디렉터리를 지우지 않는다.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sdkDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(sdkDir, '../..');
const pkg = JSON.parse(fs.readFileSync(path.join(sdkDir, 'package.json'), 'utf8'));
const tsVersion = JSON.parse(
  fs.readFileSync(path.join(sdkDir, 'node_modules/typescript/package.json'), 'utf8'),
).version;

// 공개 API를 소비자 입장에서 사용하는 코드. 타입이 any로 무너지면 @ts-expect-error가 "unused"로 실패한다.
const CONSUMER_SOURCE = `
import { QARecorder } from 'qa-recorder';
import type {
  QARecorderConfig, RecorderMode, ConsoleEntry, ConsoleLevel,
  HARDocument, HAREntry, HARLog, HARTimings,
} from 'qa-recorder';

const mode: RecorderMode = 'heavy';
const levels: ConsoleLevel[] = ['error', 'warn'];
const config: QARecorderConfig = {
  endpoint: 'https://example.com/upload',
  uploadTimeout: 30_000,
  mode,
  consoleLevels: levels,
  maskKeys: ['token'],
};

// @ts-expect-error — mode는 정해진 문자열만 받는다
const badConfig: QARecorderConfig = { mode: 'ultra' };
void badConfig;

QARecorder.setup(config);
const instance: QARecorder | null = QARecorder.getInstance();
const recorder = new QARecorder(config);
const ready: Promise<void> = recorder.init();
void ready;

const entries: HAREntry[] = recorder.getNetworkEntries();
const first = entries[0];
if (first) {
  const status: number = first.response.status;
  const url: string = first.request.url;
  const timings: HARTimings = first.timings;
  // @ts-expect-error — status는 number
  const wrong: string = first.response.status;
  void status; void url; void timings; void wrong;
}

const doc: HARDocument = { log: { version: '1.2', creator: { name: 'x', version: '1' }, entries } };
const log: HARLog = doc.log;
const consoleEntry: ConsoleEntry | undefined = undefined;
void log; void consoleEntry; void instance;

recorder.destroy();
`;

const failures = [];
const check = (ok, message) => {
  if (ok) console.log(`  ok   ${message}`);
  else {
    console.log(`  FAIL ${message}`);
    failures.push(message);
  }
};
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

if (!fs.existsSync(path.join(sdkDir, 'dist/index.d.ts'))) {
  console.error('dist/ is missing — run `pnpm -F qa-recorder build` first.');
  process.exit(1);
}

// 저장소 밖(OS 임시 디렉터리)에 만들어 workspace의 node_modules나 tsconfig가 해석에 끼어들지 않게 한다
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-recorder-consumer-'));
if (work.startsWith(repoRoot + path.sep)) throw new Error('consumer dir must be outside the repository');

try {
  console.log(`\n[1/5] pnpm pack → ${work}`);
  run('pnpm', ['pack', '--pack-destination', work], sdkDir);
  const tarball = fs.readdirSync(work).find((f) => f.endsWith('.tgz'));
  if (!tarball) throw new Error('pnpm pack produced no tarball');
  const files = run('tar', ['-tzf', path.join(work, tarball)]).split('\n').filter(Boolean)
    .map((f) => f.replace(/^package\//, ''));

  for (const required of ['package.json', 'LICENSE', 'README.md', 'dist/index.d.ts',
    'dist/qa-recorder.esm.js', 'dist/qa-recorder.umd.js', 'dist/types/har.d.ts']) {
    check(files.includes(required), `tarball contains ${required}`);
  }
  const unexpected = files.filter((f) => !['package.json', 'LICENSE', 'README.md'].includes(f) && !f.startsWith('dist/'));
  check(unexpected.length === 0, `tarball has no files outside dist/ ${unexpected.length ? `(${unexpected.join(', ')})` : ''}`);
  check(!files.some((f) => f.includes('__tests__')), 'tarball has no test files');

  console.log('\n[2/5] packed package.json and declaration imports');
  const extract = path.join(work, 'extract');
  fs.mkdirSync(extract);
  run('tar', ['-xzf', path.join(work, tarball), '-C', extract]);
  const packedDir = path.join(extract, 'package');
  const packedPkg = JSON.parse(fs.readFileSync(path.join(packedDir, 'package.json'), 'utf8'));
  check(!JSON.stringify(packedPkg).includes('workspace:'), 'no workspace: protocol in packed package.json');
  const runtimeDeps = Object.keys(packedPkg.dependencies ?? {});
  check(runtimeDeps.length === 0,
    `no runtime dependencies (rrweb/fflate are bundled into dist) ${runtimeDeps.length ? `found: ${runtimeDeps.join(', ')}` : ''}`);
  check(packedPkg.exports?.['.'] && Object.keys(packedPkg.exports['.'])[0] === 'types',
    '"types" is the first export condition');

  const bareImports = new Set();
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.d.ts')) {
        const src = fs.readFileSync(full, 'utf8');
        for (const m of src.matchAll(/(?:from\s+|import\s*\(\s*|reference\s+types=)['"]([^'"]+)['"]/g)) {
          if (!m[1].startsWith('.')) bareImports.add(`${path.relative(packedDir, full)} → ${m[1]}`);
        }
      }
    }
  };
  walk(path.join(packedDir, 'dist'));
  check(bareImports.size === 0,
    `declarations import only relative paths ${bareImports.size ? `found: ${[...bareImports].join('; ')}` : ''}`);
  check(fs.readFileSync(path.join(packedDir, 'LICENSE'), 'utf8').includes('MIT License'), 'LICENSE is the MIT license text');

  console.log(`\n[3/5] install into a standalone project (typescript@${tsVersion})`);
  const consumer = path.join(work, 'consumer');
  fs.mkdirSync(consumer);
  fs.writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({
    name: 'qa-recorder-consumer-check', private: true, type: 'module',
  }, null, 2));
  run('npm', ['install', '--no-audit', '--no-fund', '--no-package-lock',
    path.join(work, tarball), `typescript@${tsVersion}`], consumer);

  fs.writeFileSync(path.join(consumer, 'index.ts'), CONSUMER_SOURCE);
  const resolutions = {
    bundler: { module: 'ESNext', moduleResolution: 'Bundler' },
    nodenext: { module: 'NodeNext', moduleResolution: 'NodeNext' },
    node10: { module: 'ESNext', moduleResolution: 'Node10' },
  };
  console.log('\n[4/5] tsc --noEmit without skipLibCheck');
  for (const [name, opts] of Object.entries(resolutions)) {
    fs.writeFileSync(path.join(consumer, `tsconfig.${name}.json`), JSON.stringify({
      compilerOptions: {
        ...opts, target: 'ES2020', lib: ['ES2020', 'DOM', 'DOM.Iterable'],
        strict: true, noEmit: true, skipLibCheck: false,
      },
      files: ['index.ts'],
    }, null, 2));
    try {
      run(path.join(consumer, 'node_modules/.bin/tsc'), ['-p', `tsconfig.${name}.json`], consumer);
      check(true, `moduleResolution ${name}`);
    } catch (err) {
      console.log(`${err.stdout ?? ''}${err.stderr ?? ''}`);
      check(false, `moduleResolution ${name}`);
    }
  }

  console.log('\n[5/5] import the installed package in Node (no DOM)');
  fs.writeFileSync(path.join(consumer, 'smoke.mjs'),
    "const m = await import('qa-recorder');\n" +
    "if (typeof m.QARecorder !== 'function') throw new Error('QARecorder export missing');\n" +
    "console.log('imported', Object.keys(m).join(','));\n");
  try {
    run('node', ['smoke.mjs'], consumer);
    check(true, 'ESM entry imports without a DOM');
  } catch (err) {
    console.log(`${err.stdout ?? ''}${err.stderr ?? ''}`);
    check(false, 'ESM entry imports without a DOM');
  }
} finally {
  if (process.env.QA_RECORDER_KEEP_CONSUMER) console.log(`\nkept ${work}`);
  else fs.rmSync(work, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`\n${failures.length} package check(s) failed`);
  process.exit(1);
}
console.log('\nAll package checks passed');
