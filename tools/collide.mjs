#!/usr/bin/env node
// Collision / clearance check of Mercury against the base board across the insertion path.  node tools/collide.mjs
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.webp': 'image/webp' };
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/favicon')) { res.writeHead(204); return res.end(); }
  const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream', 'cache-control': 'no-store' }); fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const exe = (() => { const b = '/opt/pw-browsers'; for (const d of fs.existsSync(b) ? fs.readdirSync(b) : []) { const c = path.join(b, d, 'chrome-linux', 'chrome'); if (d.startsWith('chromium-') && fs.existsSync(c)) return c; } })();
const browser = await chromium.launch({ executablePath: exe, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
try {
  const page = await browser.newPage(); const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(`http://127.0.0.1:${server.address().port}/collide.html`);
  await page.waitForFunction(() => window.__ready || window.__error, null, { timeout: 240000 });
  const err = await page.evaluate(() => window.__error); if (err) throw new Error(err);
  const res = await page.evaluate(() => window.__collide);
  const mate = await page.evaluate(() => window.__mate);
  console.log('PeriBoard mating fit:', JSON.stringify(mate, null, 1));
  for (const r of res) {
    console.log(`\ninsertion ${r.ins.toFixed(2)}  (${r.n} sample points)  ${r.hits.length ? 'HITS: ' + r.hits.slice(0, 5).map((h) => `${h.pair} ${h.depth_mm}mm`).join(' | ') : 'no penetration'}`);
    if (r.ins === 1) console.log('   tightest clearances under the seated module:', r.minClearance.map((c) => `${c.part} ${c.mm}mm`).join(' | '));
  }
  if (errs.length) console.log('console errors:', errs.slice(0, 3));
} catch (e) { console.error('collide failed:', e.message); process.exitCode = 1; }
finally { await browser.close(); server.close(); }
