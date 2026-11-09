import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    // e2e/는 실제 브라우저에서 Playwright로 실행한다 (pnpm test:e2e)
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
});
