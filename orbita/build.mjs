// Builds the standalone Orbita page into public/orbita.html (Vite copies it to dist/ on deploy).
// Run from the repo root: npm run build:orbita   (uses the esbuild that ships with Vite)
import * as esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const r = await esbuild.build({
  entryPoints: [path.join(here, 'src/main.js')], bundle: true, format: 'esm', write: false,
  external: ['three', 'three/addons/*'], target: 'es2022', charset: 'utf8', legalComments: 'none',
  minify: !process.argv.includes('--dev'),
});
const js = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const frag = fs.readFileSync(path.join(here, 'src/index.frag.html'), 'utf8').replace('/*__SCRIPT__*/', () => js);
const html = '<!doctype html>\n<html lang="pl">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
  + frag.replace('<div id="stage">', '</head>\n<body>\n<div id="stage">') + '\n</body>\n</html>\n';
const out = path.join(here, '../public/orbita.html');
fs.writeFileSync(out, html);
console.log(`orbita: ${(html.length / 1024).toFixed(1)} KB -> ${path.relative(process.cwd(), out)}`);
