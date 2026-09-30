import { defineConfig } from 'vite';
import path from 'path';
import { uploadMockPlugin } from './demo-server/uploadMockPlugin';

const UPLOADS_DIR = path.resolve(__dirname, 'demo/uploads');

export default defineConfig({
  plugins: [uploadMockPlugin(UPLOADS_DIR)],
});
