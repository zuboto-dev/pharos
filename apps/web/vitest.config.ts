import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { conditions: ['development'] },
  test: {
    environment: 'happy-dom',
    setupFiles: ['./vitest.setup.ts'],
    // `pnpm test` runs the server and web suites at once: half the cores each keeps the machine
    // responsive. Rendering a whole page (ProjectPage, the history drawer) can take seconds while
    // it is busy, so tests get 20s rather than 5s.
    maxWorkers: '50%',
    testTimeout: 20_000,
  },
});
