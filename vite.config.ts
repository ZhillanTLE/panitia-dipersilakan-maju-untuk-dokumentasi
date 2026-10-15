import { createHash } from 'node:crypto';
import { createReadStream, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import react from '@vitejs/plugin-react';
import type { Connect, Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

// CLAUDE.md rule 7: offline only, no cloud calls. The production page may load
// nothing from another origin, which this policy enforces in the browser.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  // WebAssembly needs 'wasm-unsafe-eval' to compile the speech runtime; it allows no JS eval.
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

// Multi-threaded WebAssembly needs a cross-origin isolated page.
const ISOLATION_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

// Serves the repo's modelpack/ folder at ./modelpack/ in dev and preview, so the team can
// run the model without installing a pack. Production installs packs from a local folder.
function modelpackFolder(): Plugin {
  const root = resolve(import.meta.dirname, 'modelpack');
  const serve: Connect.NextHandleFunction = (req, res, next) => {
    const path = decodeURIComponent((req.url ?? '').split('?')[0]);
    const file = resolve(root, '.' + path);
    if (!file.startsWith(root + sep)) return next();
    let size: number;
    try {
      const stat = statSync(file);
      if (!stat.isFile()) return next();
      size = stat.size;
    } catch {
      return next();
    }
    res.setHeader('Content-Type', file.endsWith('.json') ? 'application/json' : 'application/octet-stream');
    res.setHeader('Content-Length', String(size));
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    if (req.method === 'HEAD') return res.end();
    createReadStream(file).pipe(res);
  };
  return {
    name: 'dengarbaca-modelpack-folder',
    configureServer(server) {
      server.middlewares.use('/modelpack', serve);
    },
    configurePreviewServer(server) {
      server.middlewares.use('/modelpack', serve);
    },
  };
}

// Emits sw.js with a precache list of every built file, so the app keeps working in
// airplane mode after one visit. Written by hand to avoid a PWA plugin dependency.
function offlineShell(): Plugin {
  return {
    name: 'dengarbaca-offline-shell',
    apply: 'build',
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: CONTENT_SECURITY_POLICY },
          injectTo: 'head-prepend',
        },
      ];
    },
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle)
        .filter((file) => !file.endsWith('.map'))
        .sort();
      const urls = ['./', ...files.map((file) => `./${file}`), './favicon.svg', './manifest.webmanifest'];
      const version = createHash('sha256').update(files.join('\n')).digest('hex').slice(0, 12);
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: serviceWorker(urls, version) });
    },
  };
}

function serviceWorker(urls: string[], version: string): string {
  return `// Generated at build time by vite.config.ts. Do not edit.
const CACHE = 'dengarbaca-${version}';
const PRECACHE = ${JSON.stringify(urls)};

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

// Responses served from the cache keep the page cross-origin isolated, so the speech
// runtime can use threads offline and on hosts that cannot set headers.
const isolate = (response) => {
  if (!response || response.type === 'opaque' || response.status === 0) return response;
  const headers = new Headers(response.headers);
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
};

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  // Model packs are large and live in the browser's private storage, not in this cache.
  if (url.pathname.includes('/modelpack/')) return;
  const shell = new URL('./', self.registration.scope).href;
  event.respondWith(
    caches
      .match(request, { ignoreSearch: true, ignoreVary: true })
      .then((hit) => hit || (request.mode === 'navigate' ? caches.match(shell, { ignoreVary: true }) : undefined))
      .then((hit) => hit || fetch(request))
      .then(isolate),
  );
});
`;
}

export default defineConfig({
  base: './',
  plugins: [react(), offlineShell(), modelpackFolder()],
  server: { headers: ISOLATION_HEADERS },
  preview: { headers: ISOLATION_HEADERS },
  // The speech runtime ships its own WebAssembly; pre-bundling it breaks the file references.
  optimizeDeps: { exclude: ['onnxruntime-web'] },
  worker: { format: 'es' },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
