import { createHash } from 'node:crypto';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

// CLAUDE.md rule 7: offline only, no cloud calls. The production page may load
// nothing from another origin, which this policy enforces in the browser.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
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

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  const shell = new URL('./', self.registration.scope).href;
  event.respondWith(
    caches
      .match(request, { ignoreSearch: true, ignoreVary: true })
      .then((hit) => hit || (request.mode === 'navigate' ? caches.match(shell, { ignoreVary: true }) : undefined))
      .then((hit) => hit || fetch(request)),
  );
});
`;
}

export default defineConfig({
  base: './',
  plugins: [react(), offlineShell()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
