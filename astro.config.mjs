// @ts-check
import { defineConfig } from 'astro/config';

// Static pages; everything live comes from the server's /api at runtime.
// In development, run the server (`pnpm dev:server`) and `pnpm dev` side by side.
export default defineConfig({
  site: 'https://1010.b4ez.com',
  output: 'static',
  trailingSlash: 'ignore',
  build: { format: 'directory' },
  vite: {
    build: { target: 'es2022' },
    // drand-client is imported lazily (only when someone clicks Verificar).
    // Without this, the dev server optimizes it on first use and that first
    // import fails with "Outdated Optimize Dep".
    optimizeDeps: { include: ['drand-client'] },
    server: {
      proxy: { '/api': 'http://127.0.0.1:8710' },
    },
  },
});
