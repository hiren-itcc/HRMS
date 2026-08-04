import path from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Frontend tests (docs/09 §testing). Vitest rather than Jest because the app is
 * already a Vite-compatible React tree and Jest would need a second transform
 * pipeline over the same files.
 *
 * Deliberately no `@vitejs/plugin-react`. Its job is Fast Refresh and the Babel
 * pipeline, neither of which a test run uses, and its current major requires
 * Vite 8 while Vitest bundles Vite 7 — installing it produces either a type
 * error or `ERR_PACKAGE_PATH_NOT_EXPORTED` at startup, depending which of the
 * two you pin. esbuild compiles the JSX on its own; `jsx: 'automatic'` below is
 * all it needs, matching `"jsx": "react-jsx"` in tsconfig.
 *
 * `jsdom`, not a browser: these are component and unit tests. The five golden
 * end-to-end flows in docs/09 are a separate layer and still unbuilt — they
 * need a seeded database and a running API, which CI cannot yet provide.
 */
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: {
    // Mirrors the `@/*` path in tsconfig. Without it every import in a test
    // resolves relative to the test file and nothing loads.
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    // Next's build output and the Turbo cache are not test material.
    exclude: ['**/node_modules/**', '**/.next/**', '**/.turbo/**'],
  },
});
