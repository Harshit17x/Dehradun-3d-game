import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Run after Vite. The app entry is embedded, but Cesium's runtime assets are
// intentionally left as external files under dist-drive/cesium. Therefore the
// generated HTML is a convenient app snapshot, while `npm run preview` is the
// supported Cesium deployment path.
const root = resolve(import.meta.dirname);
const html = await readFile(resolve(root, 'dist-drive/index.html'), 'utf8');
const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g)];
const entry = scripts.find(([, url]) => /\/assets\/.*\.js$/.test(url));
if (!entry) throw new Error('Expected a Vite JavaScript entry');
const [tag, url] = entry;
const javascript = await readFile(resolve(root, 'dist-drive', url.replace(/^\//, '')), 'utf8');
if (/\bfrom\s*["']\.\.?\//.test(javascript) || /\bimport\s*\(/.test(javascript)) {
  throw new Error('Unexpected external chunk; refusing to emit a non-standalone scene');
}
const bundled = html.replace(tag, () => `<script type="module">\n${javascript.replace(/<\/script/gi, '<\\/script')}\n</script>`);
await writeFile(resolve(root, 'dehradun-drive.html'), bundled);
console.log(`App snapshot: dehradun-drive.html (${(Buffer.byteLength(bundled) / 1024 / 1024).toFixed(2)} MB; serve dist-drive for Cesium assets)`);
