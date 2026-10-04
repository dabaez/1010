// Bundles the server and the CLI into build/server/. Dependencies stay
// external: they come from node_modules (better-sqlite3 is native).
import { build } from 'esbuild';

await build({
  entryPoints: { main: 'src/server/main.ts', cli: 'src/server/cli.ts' },
  outdir: 'build/server',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  packages: 'external',
  sourcemap: true,
  logLevel: 'info',
});
