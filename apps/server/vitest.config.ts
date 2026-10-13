import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { conditions: ['development'] },
  ssr: { resolve: { conditions: ['development'] } },
  test: {
    // `pnpm test` runs the server and web suites at once: half the cores each keeps the machine
    // responsive. Tests that start processes (eval fixtures and harness) set longer timeouts.
    maxWorkers: '50%',
    testTimeout: 15_000,
  },
});
