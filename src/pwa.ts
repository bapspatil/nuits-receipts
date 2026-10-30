import { ICON_PNG } from './app-icons';
import { PALETTE } from './tokens';

// What the install needs: a manifest, icons, and a service worker that only answers
// when the phone is offline, or when another app shares files to it. It caches no app
// data and never sits in the path of an online page request, so it cannot swallow the
// Basic challenge or the Access redirect.

export const SHARE_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'] as const;

// Stable paths for the icons. They hold no data, and iOS and the browser fetch them
// without the page's credentials, so these (and /favicon.svg) answer without sign-in.
export const ICON_PATHS = {
  '/apple-touch-icon.png': 'apple180',
  '/icons/icon-192.png': 'icon192',
  '/icons/icon-512.png': 'icon512',
  '/icons/icon-maskable-512.png': 'maskable512',
} as const;
export type IconPath = keyof typeof ICON_PATHS;
export const PUBLIC_PATHS: ReadonlySet<string> = new Set([...Object.keys(ICON_PATHS), '/favicon.svg']);

const iconBytes = new Map<string, Uint8Array>();
export function iconResponse(path: IconPath): Response {
  let bytes = iconBytes.get(path);
  if (!bytes) {
    bytes = Uint8Array.from(atob(ICON_PNG[ICON_PATHS[path]]), (c) => c.charCodeAt(0));
    iconBytes.set(path, bytes);
  }
  return new Response(bytes, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' } });
}

// A Home Screen label is about 12 characters wide.
export function shortName(appName: string): string {
  if (appName.length <= 12) return appName;
  const first = appName.split(/\s+/)[0]!;
  return (first.length <= 12 ? first : appName.slice(0, 12)).trim();
}

// The header bar's background, and the page's.
export const THEME_COLOR = PALETTE.grey0;
const BACKGROUND_COLOR = PALETTE.grey50;

// The manifest is JSON, which the base-path rewriter does not touch: every URL carries the base here.
export function manifest(appName: string, base: string): string {
  const icon = (path: IconPath, size: number, purpose: string) => ({
    src: base + path,
    sizes: `${size}x${size}`,
    type: 'image/png',
    purpose,
  });
  return JSON.stringify({
    id: base + '/',
    name: appName,
    short_name: shortName(appName),
    start_url: base + '/',
    scope: base + '/',
    display: 'standalone',
    theme_color: THEME_COLOR,
    background_color: BACKGROUND_COLOR,
    icons: [
      icon('/icons/icon-192.png', 192, 'any'),
      icon('/icons/icon-512.png', 512, 'any'),
      icon('/icons/icon-maskable-512.png', 512, 'maskable'),
    ],
    shortcuts: [{ name: 'Add a receipt', short_name: 'Add', url: base + '/add' }],
    // Android's share sheet: the service worker stashes the files and opens Add.
    share_target: {
      action: base + '/share',
      method: 'POST',
      enctype: 'multipart/form-data',
      params: { files: [{ name: 'files', accept: [...SHARE_TYPES] }] },
    },
  });
}

// The page's side of the install: register the worker next to this script, at the default scope.
export const APP_JS = `(() => {
  if (!('serviceWorker' in navigator)) return;
  const url = new URL('../sw.js', document.currentScript.src);
  navigator.serviceWorker.register(url.href).catch(() => {});
})();`;

const OFFLINE_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline</title><style>html{background:${PALETTE.grey50};color:${PALETTE.grey950};font:16px/1.5 system-ui,sans-serif}body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box}main{max-width:24rem}h1{font-size:26px;line-height:1.15;margin:0 0 12px}p{margin:0 0 16px;color:${PALETTE.grey700}}a{display:inline-block;padding:12px 20px;border-radius:4px;background:${PALETTE.petrol900};color:${PALETTE.grey0};text-decoration:none;font-weight:600}a:focus-visible{outline:2px solid ${PALETTE.petrol900};outline-offset:2px}</style></head><body><main><h1>You're offline</h1><p>This app needs a connection. Nothing is saved on this device.</p><a href="">Try again</a></main></body></html>`;

// maxFiles is the Add page's limit, so a share never stashes more than the form takes.
export const swJs = (maxFiles: number) => `const STASH = 'nuits-share';
const TYPES = ${JSON.stringify(SHARE_TYPES)};
const MAX = ${maxFiles};
const scope = self.registration.scope;
const sharePath = new URL('share', scope).pathname;
const OFFLINE = ${JSON.stringify(OFFLINE_HTML)};
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
// Files shared from another app wait in Cache Storage for the Add page. Nothing is sent anywhere.
async function share(request) {
  try {
    const form = await request.formData();
    const files = form.getAll('files').filter((f) => f instanceof File && TYPES.includes(f.type)).slice(0, MAX);
    await caches.delete(STASH);
    const cache = await caches.open(STASH);
    await Promise.all(files.map((f, i) => cache.put(new URL('shared/' + i, scope).href, new Response(f, { headers: { 'Content-Type': f.type, 'X-Name': encodeURIComponent(f.name) } }))));
  } catch (error) {}
  return Response.redirect(new URL('add?shared=1', scope).href, 303);
}
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method === 'POST' && new URL(request.url).pathname === sharePath) {
    event.respondWith(share(request));
  } else if (request.mode === 'navigate' && !self.navigator.onLine) {
    event.respondWith(new Response(OFFLINE, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } }));
  }
});
`;
