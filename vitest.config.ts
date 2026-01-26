import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/main/preload.ts',
        'src/main/index.ts', // Electron main process - requires e2e testing
        'src/**/*-cli.ts', // CLI scripts
      ],
    },
    testTimeout: 10000,
    hookTimeout: 10000,
  },
});
