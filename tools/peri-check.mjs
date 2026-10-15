#!/usr/bin/env node
// peri-check: builds the kit in headless Chromium and reports the PeriBoard part tree, metadata and budgets.
import { chromium } from 'playwright-core';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.webp': 'image/webp', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream', 'cache-control': 'no-store' }); fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = '/opt/pw-browsers'; let exe;
for (const d of fs.existsSync(base) ? fs.readdirSync(base) : []) { const c = path.join(base, d, 'chrome-linux', 'chrome'); if (d.startsWith('chromium-') && fs.existsSync(c)) exe = c; }
const browser = await chromium.launch({ executablePath: exe, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const page = await browser.newPage(); const errs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text()); }); page.on('pageerror', (e) => errs.push(String(e)));
await page.goto(`http://127.0.0.1:${server.address().port}/qa.html?only=peri&view=top`);
await page.waitForFunction(() => window.__ready || window.__error, null, { timeout: 120000 });
const out = await page.evaluate(async () => {
  const { makeContext } = await import('/src/lib/context.js'); const ctx = await makeContext();
  const peri = (await import('/src/parts/peri.js')).build(ctx); const T = ctx.THREE;
  const rows = []; let meshes = 0, tris = 0, missing = [];
  const walk = (o, d) => {
    if (o.isMesh || o.isInstancedMesh) { meshes++; const g = o.geometry; tris += ((g.index ? g.index.count : g.attributes.position.count) / 3) * (o.isInstancedMesh ? o.count : 1); }
    if (o.userData && o.userData.label) rows.push(' '.repeat(d * 2) + `${o.name} | ${o.userData.kind} | ${o.userData.status} | ${o.userData.label}`);
    o.children.forEach((c) => walk(c, d + 1));
  };
  walk(peri, 0);
  for (const c of peri.children) if (!(c.userData && c.userData.label) && c.name !== 'pcb') missing.push(c.name || c.type);
  const box = new T.Box3().setFromObject(peri); const s = box.getSize(new T.Vector3());
  return { rows, meshes, tris: Math.round(tris), missing, size: [s.x, s.y, s.z].map((v) => +v.toFixed(2)), min: [box.min.x, box.min.y, box.min.z].map((v) => +v.toFixed(2)), anchors: peri.userData.anchors };
});
console.log(out.rows.join('\n')); console.log({ meshes: out.meshes, tris: out.tris, missingMeta: out.missing, bboxSize: out.size, bboxMin: out.min, anchors: out.anchors }); console.log(errs.length ? 'CONSOLE: ' + errs.join(' | ') : 'no console errors');
await browser.close(); server.close();
