import FILES from './assets.gen.js';

const decoded = new Map();
function body(path) {
  if (!decoded.has(path)) decoded.set(path, Uint8Array.from(atob(FILES[path].b64), (c) => c.charCodeAt(0)));
  return decoded.get(path);
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
    let path = url.pathname;
    if (path.endsWith('/')) path += 'index.html';
    if (!FILES[path]) path = '/index.html'; // single-page fallback
    const hashed = path.startsWith('/assets/');
    return new Response(request.method === 'HEAD' ? null : body(path), {
      headers: {
        'content-type': FILES[path].type,
        'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate',
        'x-content-type-options': 'nosniff',
      },
    });
  },
};
