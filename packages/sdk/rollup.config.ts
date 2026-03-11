import { defineConfig } from 'rollup';
import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';

export default defineConfig([
  // ESM 빌드 (npm 패키지용)
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/qa-recorder.esm.js',
      format: 'esm',
      sourcemap: true,
    },
    external: ['recordrtc'],
    plugins: [resolve(), typescript({ tsconfig: './tsconfig.json' })],
  },
  // UMD 빌드 (script 태그 삽입용 - RecordRTC 번들 포함)
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/qa-recorder.umd.js',
      format: 'umd',
      name: 'QARecorder',
      sourcemap: true,
    },
    plugins: [resolve({ browser: true }), typescript({ tsconfig: './tsconfig.json' })],
  },
]);
