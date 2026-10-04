// Serves the built Astro site. Astro writes /archive as archive/index.html.
// Hashed assets under /_astro/ are cached forever; pages are revalidated.

import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import type { Context } from 'hono';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.xml': 'application/xml',
  '.webmanifest': 'application/manifest+json',
};

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function resolveFile(root: string, urlPath: string): Promise<string | null> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const full = normalize(join(root, decoded));
  if (full !== root && !full.startsWith(root + sep)) return null;
  for (const candidate of [full, join(full, 'index.html'), full + '.html']) {
    if (await isFile(candidate)) return candidate;
  }
  return null;
}

export async function serveStatic(c: Context, root: string, urlPath: string): Promise<Response> {
  const file = await resolveFile(root, urlPath);
  if (!file) {
    const notFound = await resolveFile(root, '/404.html');
    const body = notFound ? await readFile(notFound) : 'not found';
    return c.body(body, 404, { 'content-type': TYPES['.html']! });
  }
  // /archive → /archive/ so relative links behave.
  if (file.endsWith(sep + 'index.html') && !urlPath.endsWith('/') && !urlPath.endsWith('.html')) {
    return c.redirect(urlPath + '/', 301);
  }
  const type = TYPES[extname(file)] ?? 'application/octet-stream';
  const cache = urlPath.startsWith('/_astro/') ? 'public, max-age=31536000, immutable' : 'no-cache';
  return c.body(await readFile(file), 200, { 'content-type': type, 'cache-control': cache });
}
