import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    restoreMocks: true,
    clearMocks: true,
    coverage: {
      provider: 'v8',
      // This isomorphic query adapter is consumed by both clients; count its
      // actual implementation rather than only the web compatibility export.
      include: ['lib/**/*.ts', 'packages/domain/**/*.ts', 'packages/data/**/*.ts', 'packages/features/**/*.ts', 'expo/lib/analytics-dashboard-query.ts', 'expo/lib/profile-catalog-query.ts', 'expo/lib/profile-catalog-pages.ts'],
      exclude: ['lib/types/**'],
      reporter: ['text', 'json-summary'],
      thresholds: {
        statements: 55,
        branches: 46,
        functions: 50,
        lines: 55,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      'server-only': path.resolve(__dirname, 'tests/server-only.ts'),
    },
  },
});
