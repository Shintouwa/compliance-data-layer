import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * `pnpm vitest run` is `make test`'s first line and CI's. One config for the
 * whole workspace, so a test added anywhere is picked up without a second
 * registration step.
 *
 * The `@/` alias mirrors `tsconfig.json` `paths`. Both must agree; if they
 * drift, the typecheck and the tests resolve different files.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./apps/web', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**', 'apps/validator/**'],
  },
});
