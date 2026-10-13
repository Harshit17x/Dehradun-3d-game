import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Run after Vite. The production entry has no external assets or dynamic
// imports, so embedding its one JS chunk creates a genuinely offline scene.
const root = resolve(import.meta.dirname);
const html = await readFile(resolve(root, 'dist-drive/index.html'), 'utf8');
const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g)];
if (scripts.length !== 1) throw new Error('Expected one self-contained production JavaScript entry');
const [tag, url] = scripts[0];
const javascript = await readFile(resolve(root, 'dist-drive', url.replace(/^\//, '')), 'utf8');
if (/\bfrom\s*["']\.\.?\//.test(javascript) || /\bimport\s*\(/.test(javascript)) {
  throw new Error('Unexpected external chunk; refusing to emit a non-standalone scene');
}
const bundled = html.replace(tag, () => `<script type="module">\n${javascript.replace(/<\/script/gi, '<\\/script')}\n</script>`);
await writeFile(resolve(root, 'dehradun-drive.html'), bundled);
console.log(`Offline scene: dehradun-drive.html (${(Buffer.byteLength(bundled) / 1024 / 1024).toFixed(2)} MB)`);
