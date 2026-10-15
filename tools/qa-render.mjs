#!/usr/bin/env node
// Headless QA renderer (software WebGL via SwiftShader; no GPU needed).
//   node tools/qa-render.mjs --only=base --view=top --mode=footprint --out=qa-out/base-fp.png
//   node tools/qa-render.mjs --only=base --suite          # standard set of views into qa-out/
// Options mirror src/qa.js: only, view, mode, az, el, ins, exp, w, h, cam, fov, post, dof, ao, env, shadow.
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.glb': 'model/gltf-binary', '.css': 'text/css' };

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/favicon')) { res.writeHead(204); return res.end(); }
  const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const exe = (() => {
  const base = '/opt/pw-browsers';
  for (const d of fs.existsSync(base) ? fs.readdirSync(base) : []) {
    const c = path.join(base, d, 'chrome-linux', 'chrome'); if (d.startsWith('chromium-') && fs.existsSync(c)) return c;
  }
  return undefined; // fall back to playwright's own resolution (macOS etc.)
})();
const browser = await chromium.launch({ executablePath: exe, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });

async function shot(params, out) {
  const page = await browser.newPage({ viewport: { width: 1800, height: 1200 } });
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}/qa.html?${new URLSearchParams(params)}`);
  await page.waitForFunction(() => window.__ready || window.__error, null, { timeout: 180000 });
  const err = await page.evaluate(() => window.__error);
  if (err) { await page.close(); throw new Error(err); }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await page.locator('canvas').screenshot({ path: out });
  const stats = await page.evaluate(() => window.__stats);
  await page.close();
  const post = stats.post ? ` post=${Object.entries(stats.post).filter(([, v]) => v).map(([k]) => k).join('+') || 'none'} passes=${stats.passes}` : ' post=off';
  console.log(`${out}  meshes=${stats.meshes} tris=${stats.triangles} calls=${stats.drawCalls}${post} frameMs=${stats.frameMs} ${stats.canvas.join('x')}${errs.length ? '  CONSOLE ERRORS: ' + errs.slice(0, 3).join(' | ') : ''}`);
  return stats;
}

try {
  const only = args.only || 'all';
  if (args.suite) {
    const dir = path.resolve(ROOT, args.dir || 'qa-out');
    const p = (extra) => ({ only, ...extra });
    await shot(p({ view: 'top', mode: 'footprint' }), `${dir}/${only}-top-footprint.png`);
    await shot(p({ view: 'top', mode: 'photo' }), `${dir}/${only}-top-photo.png`);
    await shot(p({ view: 'oblique', az: 35, el: 35 }), `${dir}/${only}-obl-a.png`);
    await shot(p({ view: 'oblique', az: -40, el: 25 }), `${dir}/${only}-obl-b.png`);
    await shot(p({ view: 'oblique', az: 15, el: 10 }), `${dir}/${only}-low.png`);
    await shot(p({ view: 'oblique', az: 30, el: -30 }), `${dir}/${only}-under.png`);
  } else {
    const { out = 'qa-out/out.png', ...params } = args;
    await shot(params, path.resolve(ROOT, out));
  }
} catch (e) { console.error('QA render failed:', e.message); process.exitCode = 1; }
finally { await browser.close(); server.close(); }
