#!/usr/bin/env node
// Print the browser viewer's OWN camera for each preset at a given aspect, so the Cycles camera (tools/blender/render.py, a port of
// src/main.js frameFor) can be checked against it number by number instead of by eye.
//
//   node tools/blender/viewer-camera.mjs [--size=1920x1080] [--sidecar=renders/hero.json[,renders/low.json,...]] [--json]
//
// Loads index.html headless (software WebGL), waits for the viewer, sets the camera aspect to --size and asks the viewer's exported
// frameFor(boardPoints(), dirFromAzEl(az, el), fill) for every VIEWS preset. Prints position and target in the glTF frame (mm, +y up)
// and converted to Blender's frame (m, Z up: x, -z, y) as render.py writes them in `view.camera_pos_m` / `view.target_m`.
// With --sidecar it reads those render.py sidecars and prints the difference per view (mm), exit code 1 if any differs by more than 1 mm.
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const [W, H] = String(args.size || '1920x1080').toLowerCase().split('x').map(Number);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/favicon')) { res.writeHead(204); return res.end(); }
  let p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname)); if (p.endsWith('/')) p += 'index.html';
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream', 'cache-control': 'no-store' }); fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const exe = (() => { const b = '/opt/pw-browsers'; for (const d of fs.existsSync(b) ? fs.readdirSync(b) : []) { const c = path.join(b, d, 'chrome-linux', 'chrome'); if (d.startsWith('chromium-') && fs.existsSync(c)) return c; } })();
const browser = await chromium.launch({ executablePath: exe, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
let code = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html?quality=low`);
  await page.waitForFunction(() => window.__viewerReady, null, { timeout: 180000 });
  const views = await page.evaluate(([w, h]) => {
    const U = window.__unijack, out = {};
    const a0 = U.camera.aspect; U.camera.aspect = w / h; U.camera.updateProjectionMatrix();   // frameFor reads camera.fov and camera.aspect
    for (const [name, v] of Object.entries(U.VIEWS)) {
      const f = U.frameFor(U.boardPoints(), U.dirFromAzEl(v.az, v.el), v.fill);
      out[name] = { az: v.az, el: v.el, fill: v.fill, fov: U.camera.fov, pos_gltf_mm: f.pos.toArray(), tgt_gltf_mm: f.tgt.toArray(), dist_mm: f.dist };
    }
    U.camera.aspect = a0; U.camera.updateProjectionMatrix();
    return out;
  }, [W, H]);
  const toBlender = ([x, y, z]) => [x / 1000, -z / 1000, y / 1000];
  for (const v of Object.values(views)) { v.camera_pos_m = toBlender(v.pos_gltf_mm); v.target_m = toBlender(v.tgt_gltf_mm); }
  if (args.json) console.log(JSON.stringify({ size: [W, H], views }, null, 1));
  else for (const [n, v] of Object.entries(views)) console.log(`${n.padEnd(6)} az ${v.az} el ${v.el} fill ${v.fill} fov ${v.fov}  pos_m ${v.camera_pos_m.map((x) => x.toFixed(5)).join(' ')}  target_m ${v.target_m.map((x) => x.toFixed(5)).join(' ')}  dist ${(v.dist_mm / 1000).toFixed(5)}`);
  if (args.sidecar) {
    for (const f of String(args.sidecar).split(',').filter(Boolean)) {
      const sc = JSON.parse(fs.readFileSync(path.resolve(ROOT, f), 'utf8')); const sv = sc.view, v = views[sv.name];
      if (!v) { console.log(`${f}: view '${sv.name}' is not a viewer preset`); continue; }
      if (sc.size[0] !== W || sc.size[1] !== H) console.log(`${f}: rendered at ${sc.size.join('x')}, compared at ${W}x${H} (pass --size=${sc.size.join('x')})`);
      const d = (a, b) => Math.hypot(...a.map((x, i) => x - b[i])) * 1000;
      const dp = d(sv.camera_pos_m, v.camera_pos_m), dt = d(sv.target_m, v.target_m), dd = Math.abs(sv.distance_m - v.dist_mm / 1000) * 1000;
      const ok = dp <= 1 && dt <= 1; if (!ok) code = 1;
      console.log(`${f}: ${sv.name}  camera differs by ${dp.toFixed(3)} mm, target by ${dt.toFixed(3)} mm, distance by ${dd.toFixed(3)} mm  ${ok ? 'OK (<= 1 mm)' : 'DIFFERS'}`);
    }
  }
} finally { await browser.close(); server.close(); }
process.exit(code);
