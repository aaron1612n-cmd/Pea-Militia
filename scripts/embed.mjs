// Bundles dist/ into a module the Worker imports, so the whole site ships as one Worker script.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json',
  '.woff2': 'font/woff2', '.glb': 'model/gltf-binary', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};
const files = {};
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else files['/' + relative('dist', p).split('\\').join('/')] = { type: TYPES[extname(p)] || 'application/octet-stream', b64: readFileSync(p).toString('base64') };
  }
};
walk('dist');
writeFileSync('worker/assets.gen.js', `export default ${JSON.stringify(files)};\n`);
console.log(`embedded ${Object.keys(files).length} files`);
