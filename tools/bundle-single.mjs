#!/usr/bin/env node
// Bundle the viewer into ONE self-contained html file (JS minified, CSS inlined, textures + scale.json as data: URIs).
//   node tools/bundle-single.mjs
// Outputs (dist/, git-ignored):
//   unijack-3d.artifact.html   fragment for the Artifact tool (starts with <title>; no <html>/<head>/<body>)
//   unijack-3d.html            complete standalone document (opens from disk, can be emailed)
//   _csp-test.html             standalone + a strict artifact-style Content-Security-Policy, for tools/viewer-shots.mjs --page
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist'); fs.mkdirSync(DIST, { recursive: true });
const TITLE = 'UniJack 3D Model';
const rd = (f) => fs.readFileSync(path.join(ROOT, f));

const alias = {
  name: 'three-alias',
  setup(b) {
    b.onResolve({ filter: /^three$/ }, () => ({ path: path.join(ROOT, 'vendor/three.module.js') }));
    b.onResolve({ filter: /^three\/addons\// }, (a) => ({ path: path.join(ROOT, 'vendor/addons', a.path.slice('three/addons/'.length)) }));
  },
};
const out = await build({ entryPoints: [path.join(ROOT, 'src/main.js')], bundle: true, format: 'esm', target: 'es2022', minify: true, write: false, plugins: [alias], legalComments: 'none', logLevel: 'warning' });
const js = out.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');

const uri = (f) => `data:image/webp;base64,${rd(f).toString('base64')}`;
const assets = {
  'data/scale.json': JSON.parse(rd('data/scale.json')),
  'assets/tex/base-top.webp': uri('assets/tex/base-top.webp'),
  'assets/tex/peri-top.webp': uri('assets/tex/peri-top.webp'),
  'assets/tex/mercury-front.webp': uri('assets/tex/mercury-front.webp'),
  'assets/tex/mercury-back.webp': uri('assets/tex/mercury-back.webp'),
};
// derived surface-finish maps (tools/derive-maps.py); optional: a missing file just leaves that face uniformly matte
for (const f of ['base-top-rm', 'base-top-nrm', 'peri-top-rm', 'peri-top-nrm', 'mercury-front-rm', 'mercury-front-nrm', 'mercury-back-rm'])
  if (fs.existsSync(path.join(ROOT, `assets/tex/derived/${f}.webp`))) assets[`assets/tex/derived/${f}.webp`] = uri(`assets/tex/derived/${f}.webp`);

const index = rd('index.html').toString();
const a = index.indexOf('<div class="app"'), z = index.indexOf('<script type="module"');
if (a < 0 || z < 0) throw new Error('index.html structure changed; bundler cannot find the app markup');
const body = index.slice(a, z).replace('src="./assets/tex/base-top.webp"', `src="${assets['assets/tex/base-top.webp']}"`);
const css = rd('src/viewer.css').toString();

const core = `<style>\n${css}</style>\n${body}<script>window.__UNIJACK_ASSETS=${JSON.stringify(assets)};</script>\n<script type="module">${js}</script>\n`;
const fragment = `<title>${TITLE}</title>\n${core}`;
const doc = (extraHead = '') => `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex"><meta name="description" content="Rotatable, explodable, photo-anchored 3D model of the UniJack kit. Illustrative, not CAD."><title>${TITLE}</title>${extraHead}</head><body>\n${core}</body></html>\n`;
const CSP = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob: data:; style-src 'unsafe-inline'; img-src blob: data:; font-src data:; media-src blob: data:; connect-src blob: data:; worker-src blob:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

fs.writeFileSync(path.join(DIST, 'unijack-3d.artifact.html'), fragment);
fs.writeFileSync(path.join(DIST, 'unijack-3d.html'), doc());
fs.writeFileSync(path.join(DIST, '_csp-test.html'), doc(`<meta http-equiv="Content-Security-Policy" content="${CSP}">`));
const mb = (f) => (fs.statSync(path.join(DIST, f)).size / 1048576).toFixed(2) + ' MB';
console.log(`js ${(js.length / 1048576).toFixed(2)} MB | unijack-3d.artifact.html ${mb('unijack-3d.artifact.html')} | unijack-3d.html ${mb('unijack-3d.html')}`);
