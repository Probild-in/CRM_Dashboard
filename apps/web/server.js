/**
 * Static file server for the built React app.
 *
 * Railway runs this as the `web` service. Dependency-free on purpose: the web
 * workspace ships a bundle, and adding a server framework just to hand back
 * files would be a runtime dependency to patch for no benefit.
 *
 * Two things a plain file server gets wrong for a single-page app, both handled
 * below: unknown paths must fall back to index.html so client-side routes work
 * on a hard refresh, and index.html must never be cached or users keep running
 * the previous deploy's JavaScript.
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist');
const PORT = Number(process.env.PORT) || 4173;

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

/** Resolves a URL path to a file inside dist, refusing anything that escapes it. */
async function resolve(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const candidate = path.resolve(ROOT, `.${decoded}`);

  if (candidate !== ROOT && !candidate.startsWith(ROOT + path.sep)) {
    return null;
  }

  try {
    const info = await stat(candidate);
    if (info.isFile()) return candidate;
  } catch {
    /* falls through to the SPA fallback */
  }
  return null;
}

const server = createServer(async (req, res) => {
  // Liveness, so Railway can health-check the web service too.
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  const file = (await resolve(req.url ?? '/')) ?? path.join(ROOT, 'index.html');
  const ext = path.extname(file);
  const isEntry = file.endsWith('index.html');

  res.writeHead(200, {
    'content-type': CONTENT_TYPES[ext] ?? 'application/octet-stream',
    // Vite fingerprints asset filenames, so they are safe to cache forever.
    // index.html is the pointer to them and must always be revalidated.
    'cache-control': isEntry ? 'no-cache' : 'public, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
  });

  createReadStream(file)
    .on('error', () => {
      res.end();
    })
    .pipe(res);
});

server.listen(PORT, () => {
  console.log(`Probild CRM web serving ${ROOT} on port ${PORT}`);
});
