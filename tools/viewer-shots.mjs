#!/usr/bin/env node
// End-to-end viewer check (software WebGL). Loads the page, drives the UI like a user, saves screenshots and reports
// console errors AND warnings, horizontal overflow, clipped or overlapping controls, the canvas height fraction, the parts panel and
// info card geometry, keyboard focus on every tab stop, label occlusion, hidden-part fly-to, the Backdrop (white sweep) toggle, reduced motion,
// context loss, the post chain under ?quality=high (AO and DOF really on; the other sessions drop them on software GL) and the no-WebGL fallback.
//
//   node tools/viewer-shots.mjs [--dir=qa-out/viewer] [--page=index.html]
//        [--widths=320,360,390,768,1024,1440] [--sizes=667x375,844x390,1366x657]    layout checks at these viewports (defaults shown)
//        [--flow=0]   skip the long desktop/mobile interaction flow         [--extra=0]   skip keyboard / reduced-motion / context-loss / no-WebGL sessions
//        [--env=0]    skip the Backdrop (sweep) sessions                        [--post=0]   skip the ?quality=high post-chain session
// Prints a JSON report and a final "FAILED CHECKS" list (exit code 1 if any check failed).
// Timing: software WebGL renders a frame in seconds, so after anything that animates the script waits on window.__unijack.busy() (camera tween,
// explode tween, insertion play, damping) plus a short grace, never on a fixed delay; screenshots after a change wait for a fresh rendered frame.
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const OUT = path.resolve(ROOT, args.dir || 'qa-out/viewer');
const PAGE = args.page || 'index.html';   // e.g. --page=dist/_csp-test.html to test the single-file bundle under a strict CSP
const HEIGHT_FOR = { 320: 568, 360: 740, 390: 844, 412: 915, 768: 1024, 1024: 768, 1280: 800, 1440: 900 };
const widths = String(args.widths || '320,360,390,768,1024,1440').split(',').filter(Boolean).map(Number);
const sizes = [...widths.map((w) => [w, HEIGHT_FOR[w] || 800]), ...String(args.sizes ?? '667x375,844x390,1366x657').split(',').filter(Boolean).map((s) => s.split('x').map(Number))];
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.css': 'text/css', '.glb': 'model/gltf-binary' };
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/favicon')) { res.writeHead(204); return res.end(); }
  let p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname)); if (p.endsWith('/')) p += 'index.html';
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream', 'cache-control': 'no-store' }); fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;
const exe = (() => { const b = '/opt/pw-browsers'; for (const d of fs.existsSync(b) ? fs.readdirSync(b) : []) { const c = path.join(b, d, 'chrome-linux', 'chrome'); if (d.startsWith('chromium-') && fs.existsSync(c)) return c; } })();
const GL = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'];
const browser = await chromium.launch({ executablePath: exe, args: GL });
fs.mkdirSync(OUT, { recursive: true });
const report = [], failures = [];
// camera tween, explode and insertion animations finished, and camera damping at rest. busy() reads a flag the loop refreshes once per tick, so wait for a
// tick that is newer than this call first (right after `controls.autoRotate = false` the flag is stale for one tick and would read "still" while the damping tail runs)
const settled = async (page, extra = 150) => { const t = await page.evaluate(() => window.__unijack.ticks); await page.waitForFunction((t) => window.__unijack.ticks > t && !window.__unijack.busy(), t, { timeout: 120000 }); await page.waitForTimeout(extra); };
// ask the viewer for a frame and wait until it has rendered one (the loop renders on demand; a screenshot right after a change could show the old frame)
const freshFrame = async (page) => { const n = await page.evaluate(() => { const U = window.__unijack, n = U.frames; U.controls.dispatchEvent({ type: 'change' }); return n; }); await page.waitForFunction((n) => window.__unijack.frames > n, n, { timeout: 120000 }); };
const openPanel = async (page) => { if (await page.locator('#parts-panel').isHidden()) { await page.click('#btn-parts'); await page.waitForTimeout(300); } };   // the UI closes the panel after a selection on short stages
const check = (where, name, ok, detail) => { if (!ok) failures.push(`${where}: ${name}${detail !== undefined ? ' -> ' + JSON.stringify(detail) : ''}`); return ok; };

// console output: errors and warnings are both kept; GL driver chatter from software rendering is listed apart so it cannot hide a real warning
const isDriverMsg = (t) => /GL Driver Message|GPU stall|\[\.WebGL|swiftshader|Automatic fallback to software WebGL/i.test(t);
async function session(name, ctxOpts, script, { gl = true, query = '' } = {}) {
  const ctx = await browser.newContext(ctxOpts); const page = await ctx.newPage(); const errors = [], warnings = [], driver = [];
  page.on('console', (m) => { const t = m.text().slice(0, 260); if (m.type() === 'error') errors.push(t); else if (m.type() === 'warning') (isDriverMsg(t) ? driver : warnings).push(t); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + String(e).slice(0, 240)));
  await page.goto(base + PAGE + query);
  if (gl) await page.waitForFunction(() => window.__viewerReady, null, { timeout: 180000 });
  const shot = async (n, opts = {}) => page.screenshot({ path: path.join(OUT, `${name}-${n}.png`), ...opts });
  const entry = { name, result: {} }; report.push(entry);
  try { await script(page, shot, entry.result, name); } catch (e) { check(name, 'session completed without throwing', false, String((e && e.message) || e).split('\n')[0].slice(0, 300)); }
  entry.errors = errors; entry.warnings = warnings; entry.driverWarnings = driver.length;
  entry.overflow = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth, document.documentElement.scrollHeight, innerHeight]);
  check(name, 'console errors', errors.length === 0, errors); check(name, 'console warnings', warnings.length === 0, warnings);
  if (gl) check(name, 'no horizontal overflow', entry.overflow[0] <= entry.overflow[1], entry.overflow);
  await ctx.close();
}

// ---------- in-page helpers (serialised into the page) ----------
const pageHelpers = () => {
  const R = (e) => { const r = e.getBoundingClientRect(); return [Math.round(r.left * 10) / 10, Math.round(r.top * 10) / 10, Math.round(r.right * 10) / 10, Math.round(r.bottom * 10) / 10]; };
  const shown = (e) => e.getClientRects().length > 0 && !e.closest('[hidden]') && getComputedStyle(e).visibility !== 'hidden';
  const name = (e) => e.id || e.dataset?.view || e.dataset?.show || (e.textContent || e.getAttribute('aria-label') || e.tagName).trim().slice(0, 20);
  // rectangle that clips e: the viewport narrowed by every overflow:hidden/auto/scroll ancestor
  const clipOf = (e) => { let c = [0, 0, innerWidth, innerHeight]; for (let a = e.parentElement; a && a !== document.documentElement; a = a.parentElement) { const cs = getComputedStyle(a); if (/(hidden|auto|scroll|clip)/.test(cs.overflowX + cs.overflowY)) { const r = a.getBoundingClientRect(); c = [Math.max(c[0], r.left), Math.max(c[1], r.top), Math.min(c[2], r.right), Math.min(c[3], r.bottom)]; } } return c; };
  const outside = (r, c, tol = 0.6) => r[0] < c[0] - tol || r[1] < c[1] - tol || r[2] > c[2] + tol || r[3] > c[3] + tol;
  return { R, shown, name, clipOf, outside };
};

// layout measurements at the current viewport
const layoutProbe = () => {
  const { R, shown, name, clipOf, outside } = window.__h;
  const vw = innerWidth, vh = innerHeight, out = { vw, vh };
  const stage = R(document.getElementById('stage')); out.stage = stage; out.canvasFraction = +(document.getElementById('c').clientHeight / vh).toFixed(3);
  out.clipped = [];
  for (const e of document.querySelectorAll('button, input, summary, output, label')) { if (!shown(e)) continue; const r = R(e); if (outside(r, clipOf(e))) out.clipped.push(`${name(e)} [${r.join(',')}]`); }
  const chips = [...document.querySelectorAll('.top-actions .chip')].filter(shown), top = document.querySelector('.top');
  out.headerClipped = chips.filter((c) => outside(R(c), [0, 0, vw, R(top)[3]])).map(name);
  const boxes = [...chips.map((c) => [name(c), R(c)]), ['brand', R(document.querySelector('.brand'))]];
  out.headerOverlap = [];
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) { const a = boxes[i][1], b = boxes[j][1]; if (a[0] < b[2] - 0.5 && b[0] < a[2] - 0.5 && a[1] < b[3] - 0.5 && b[1] < a[3] - 0.5) out.headerOverlap.push(boxes[i][0] + '/' + boxes[j][0]); }
  out.scrollableRows = [...document.querySelectorAll('.top-actions, .row')].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.className);
  out.minChipH = Math.min(...[...document.querySelectorAll('.chip')].filter(shown).map((e) => Math.round(R(e)[3] - R(e)[1])));
  out.footnote = { shortVisible: shown(document.querySelector('.note .short')), aboutOpen: document.getElementById('about').open, summaryVisible: shown(document.querySelector('.about summary')) };
  out.headerH = Math.round(R(top)[3]); out.dockH = Math.round(R(document.querySelector('.dock'))[3] - R(document.querySelector('.dock'))[1]);
  return out;
};

// where the selected part lands on screen, and whether the panel or card cover it
const partProbe = () => {
  const { R, shown } = window.__h, U = window.__unijack, T = U.THREE, card = document.getElementById('card'), panel = document.getElementById('parts-panel'), st = R(document.getElementById('stage'));
  const out = { cardShown: shown(card), panelShown: shown(panel), panelPeek: panel.classList.contains('peek') };
  if (out.cardShown) { out.card = R(card); out.cardInStage = out.card[0] >= st[0] - 0.5 && out.card[2] <= st[2] + 0.5 && out.card[1] >= st[1] - 0.5 && out.card[3] <= st[3] + 0.5; const m = document.elementFromPoint((out.card[0] + out.card[2]) / 2, (out.card[1] + out.card[3]) / 2); out.cardOnTop = !!m && card.contains(m); out.cardTitle = card.querySelector('h2')?.textContent; const t = card.querySelector('h2'); out.cardTitleVisible = t ? !(R(t)[1] < R(card)[1] - 0.5 || R(t)[3] > R(card)[3] + 0.5) && R(t)[1] >= st[1] - 0.5 : false; out.cardScrolls = card.querySelector('.card-in').scrollHeight > card.querySelector('.card-in').clientHeight + 1; }
  if (out.panelShown) out.panel = R(panel);
  if (out.card && out.panel) out.cardOverlapsPanel = out.card[0] < out.panel[2] - 0.5 && out.panel[0] < out.card[2] - 0.5 && out.card[1] < out.panel[3] - 0.5 && out.panel[1] < out.card[3] - 0.5;
  return out;
};
// share of a part's vertices (sampled) whose line to the camera first meets the part itself
const visibleShare = (partLabel) => {
  const U = window.__unijack, T = U.THREE, kit = U.kit, cam = U.camera;
  const part = kit.parts.find((p) => p.userData.label === partLabel); if (!part) return { err: 'no part ' + partLabel };
  kit.root.updateMatrixWorld(true);
  const list = []; kit.root.traverse((o) => { if (!o.isMesh) return; for (let n = o; n; n = n.parent) if (!n.visible) return; list.push(o); });
  const pts = []; part.traverse((o) => { if (!o.isMesh || kit.infoFor(o) !== part) return; const p = o.geometry.getAttribute('position'); if (!p) return; const step = Math.max(1, Math.floor(p.count / 12)); for (let i = 0; i < p.count; i += step) pts.push(new T.Vector3().fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld)); });
  const ray = new T.Raycaster(); let vis = 0; const c = new T.Vector3();
  for (const q of pts) { const d = q.clone().sub(cam.position), L = d.length(); ray.set(cam.position, d.normalize()); ray.far = L + 0.5; const h = ray.intersectObjects(list, false); if (h.length && kit.infoFor(h[0].object) === part && h[0].distance > L - 1.5) vis++; }
  const b = new T.Box3().setFromObject(part).getCenter(c).project(cam);
  return { samples: pts.length, visible: vis, share: pts.length ? +(vis / pts.length).toFixed(2) : 0, ndc: [+b.x.toFixed(2), +b.y.toFixed(2)] };
};
// colour statistics of the live canvas: the solder-mask pixels (teal: saturated, blue well above red, the same classifier as tools/colorcal.py) and the
// backdrop in the top-left corner. Read in the rAF callback that follows the viewer's own loop, while the frame's drawing buffer is still intact.
const samplePixels = () => new Promise((resolve) => {
  const U = window.__unijack, c = document.getElementById('c'), n0 = U.frames; U.controls.dispatchEvent({ type: 'change' });
  const tick = () => {
    if (U.frames === n0) return requestAnimationFrame(tick);
    const w = c.width, h = c.height, cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const g = cv.getContext('2d'); g.drawImage(c, 0, 0); const d = g.getImageData(0, 0, w, h).data;
    let n = 0, r = 0, gg = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) { const R = d[i], G = d[i + 1], B = d[i + 2], mx = Math.max(R, G, B), mn = Math.min(R, G, B); if (mx > 0 && (mx - mn) / mx > 0.45 && B > R + 25) { n++; r += R; gg += G; b += B; } }
    const px = (x, y) => { const i = ((Math.round(y * h) * w) + Math.round(x * w)) * 4; return [d[i], d[i + 1], d[i + 2]]; };
    const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const mean = n ? [r / n, gg / n, b / n] : [0, 0, 0];
    resolve({ teal: n, mean: mean.map((v) => +v.toFixed(1)), lum: +(0.2126 * lin(mean[0]) + 0.7152 * lin(mean[1]) + 0.0722 * lin(mean[2])).toFixed(4), corner: px(0.04, 0.08), size: [w, h] });
  };
  requestAnimationFrame(tick);
});

// ---------- 1. layout at every viewport ----------
for (const [w, h] of sizes) {
  const mobile = w <= 844 && h <= 1000;
  const name = `layout-${w}x${h}`;
  await session(name, { viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 }, async (page, shot, res) => {
    await page.evaluate(`window.__h = (${pageHelpers.toString()})()`);
    await page.evaluate(() => { window.__unijack.controls.autoRotate = false; });
    await page.waitForFunction(() => window.__partsClassified, null, { timeout: 120000 }).catch(() => {});
    await page.waitForTimeout(700);
    const L = res.layout = await page.evaluate(`(${layoutProbe.toString()})()`);
    await shot('1-hero');
    check(name, 'no clipped controls', L.clipped.length === 0, L.clipped); check(name, 'header controls inside the header', L.headerClipped.length === 0, L.headerClipped);
    check(name, 'header controls do not overlap', L.headerOverlap.length === 0, L.headerOverlap); check(name, 'no scrollable (hidden) rows', L.scrollableRows.length === 0, L.scrollableRows);
    const short = h <= 520; check(name, short ? 'canvas keeps >= 45% of the height (short viewport)' : 'canvas keeps >= 38% of the height', L.canvasFraction >= (short ? 0.45 : 0.38), L.canvasFraction);
    check(name, 'short line visible', L.footnote.shortVisible); check(name, 'About summary visible', L.footnote.summaryVisible);
    if (w <= 640 || h <= 860) check(name, 'disclosure collapsed on phones and windows under 860 px high', L.footnote.aboutOpen === false, L.footnote);
    // preset framing: the whole kit must be inside the canvas for each preset (projected board boxes)
    res.framing = {};
    for (const v of ['hero', 'top', 'low', 'side', 'under']) {
      await page.click(`[data-view="${v}"]`); await settled(page);
      res.framing[v] = await page.evaluate(() => { const U = window.__unijack, T = U.THREE, kit = U.kit; kit.root.updateMatrixWorld(true); let x0 = 9, x1 = -9, y0 = 9, y1 = -9; const p = new T.Vector3();
        for (const b of [kit.base, kit.mercury, kit.peri]) { const bx = new T.Box3().setFromObject(b); for (let i = 0; i < 8; i++) { p.set(i & 1 ? bx.max.x : bx.min.x, i & 2 ? bx.max.y : bx.min.y, i & 4 ? bx.max.z : bx.min.z).project(U.camera); x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); } }
        return [x0, x1, y0, y1].map((n) => +n.toFixed(2)); });
      const f = res.framing[v]; check(name, `preset ${v} fits the canvas`, f[0] >= -1 && f[1] <= 1 && f[2] >= -1 && f[3] <= 1, f);
      if (v === 'under') { const n = await page.evaluate(() => document.querySelectorAll('.tag:not(.board):not([hidden])').length); res.underTags = n; }
    }
    await page.click('[data-view="hero"]'); await settled(page);
    // parts panel: open, pick a part with a designator, look at the panel, card and the part's place on screen
    await page.click('#btn-parts'); await page.waitForTimeout(500);
    res.panelOpen = await page.evaluate(`(${partProbe.toString()})()`); await shot('2-panel-open');
    await page.evaluate(() => { const b = [...document.querySelectorAll('#part-list button')].find((x) => x.querySelector('.r')?.textContent === 'J303'); b.scrollIntoView({ block: 'center' }); });
    await page.locator('#part-list button', { hasText: 'J303' }).first().click(); await settled(page);
    const P = res.afterPick = await page.evaluate(`(${partProbe.toString()})()`); await shot('3-part-selected');
    check(name, 'info card appears', P.cardShown); check(name, 'card inside the stage (not clipped)', P.cardInStage === true, P.card); check(name, 'card title visible', P.cardTitleVisible === true);
    check(name, 'card is on top at its centre', P.cardOnTop === true); check(name, 'card does not overlap the panel', P.cardOverlapsPanel !== true, [P.card, P.panel]);
    if (w <= 640 && h > 520) { const stageH = await page.evaluate(() => document.getElementById('stage').clientHeight); check(name, 'phone panel collapses after a selection (peek when the stage is tall enough, closed when it is short)', stageH >= 330 ? P.panelPeek === true : P.panelShown === false, { stageH, peek: P.panelPeek, shown: P.panelShown }); }
    const where = res.partOnScreen = await page.evaluate(() => { const U = window.__unijack, T = U.THREE, p = U.kit.parts.find((x) => x.userData.ref === 'J303'); const c = new T.Box3().setFromObject(p).getCenter(new T.Vector3()).project(U.camera); const st = window.__h.R(document.getElementById('stage')); const sx = st[0] + (c.x * 0.5 + 0.5) * (st[2] - st[0]), sy = st[1] + (-c.y * 0.5 + 0.5) * (st[3] - st[1]); const cov = ['card', 'parts-panel'].map((id) => document.getElementById(id)).filter((e) => !e.hidden).map((e) => window.__h.R(e)); return { sx: Math.round(sx), sy: Math.round(sy), covered: cov.some((r) => sx > r[0] && sx < r[2] && sy > r[1] && sy < r[3]), inStage: sx > st[0] && sx < st[2] && sy > st[1] && sy < st[3] }; });
    check(name, 'fly-to lands the part in view and not under the panel or card', where.inStage && !where.covered, where);
    // a part that is hidden when assembled: the list says so, selecting explodes (animated) and shows it
    const hid = res.hiddenRows = await page.$$eval('#part-list button', (bs) => bs.map((b) => [b.querySelector('.t')?.firstChild?.textContent, b.querySelector('.hid')?.textContent]).filter((x) => x[1]));
    check(name, 'parts list flags parts hidden when assembled (under Mercury / on the back)', hid.length >= 8 && hid.some((x) => /under Mercury/.test(x[1])) && hid.some((x) => /back of Mercury/.test(x[1])), hid.length);
    if (hid.length) {
      const target = hid.find((x) => /SOT-23/.test(x[0]) && /back/.test(x[0])) || hid[0];
      if (await page.locator('#parts-panel').isHidden()) { await page.click('#btn-parts'); await page.waitForTimeout(300); }   // the phone UI closes the panel after a selection when the stage is short
      await page.evaluate(() => { document.getElementById('parts-panel').classList.remove('peek'); const i = document.getElementById('part-filter'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); });
      await openPanel(page); await page.fill('#part-filter', target[0].slice(0, 14)); await page.waitForTimeout(200);
      await page.locator('#part-list button:not([hidden])', { hasText: target[1] }).first().click(); await settled(page, 300);   // explode tween + camera tween, however slow the frames
      const hv = res.hiddenPick = { part: target, explode: await page.evaluate(() => window.__unijack.kit.state.explode), vis: await page.evaluate(visibleShare, target[0]), card: await page.evaluate(`(${partProbe.toString()})()`) };
      await shot('4-hidden-part');
      check(name, 'hidden part: kit auto-exploded', hv.explode > 0.95, hv.explode); check(name, 'hidden part: visible from the final camera', hv.vis.share > 0, hv.vis);
      check(name, 'hidden part: card inside the stage', hv.card.cardInStage === true, hv.card.card);
    }
  });
}

if (args.flow !== '0' && args.flow !== 0) {
  // ---------- 2. the long desktop flow (screenshots of every major state) ----------
  await session('desktop', { viewport: { width: 1440, height: 900 } }, async (page, shot, res) => {
    await page.evaluate(`window.__h = (${pageHelpers.toString()})()`);
    await page.evaluate(() => { window.__unijack.controls.autoRotate = false; });   // deterministic frames
    await settled(page); await freshFrame(page); await shot('1-hero');
    await page.click('#btn-explode'); await settled(page); await shot('2-exploded');
    res.explodePressed = { v: await page.getAttribute('#btn-explode', 'aria-pressed'), slider: await page.inputValue('#exp'), valuetext: await page.getAttribute('#exp', 'aria-valuetext'), state: await page.evaluate(() => window.__unijack.kit.state) };
    check('desktop', 'explode button pressed after explode', res.explodePressed.v === 'true');
    await page.click('#btn-explode'); await settled(page);
    res.unexplode = { slider: await page.inputValue('#exp'), pressed: await page.getAttribute('#btn-explode', 'aria-pressed') }; check('desktop', 'un-explode returns to 0', res.unexplode.slider === '0' && res.unexplode.pressed === 'false', res.unexplode);
    // the 50 percent edge: button state and its next action must agree
    await page.evaluate(() => { const i = document.querySelector('#exp'); i.value = 50; i.dispatchEvent(new Event('input', { bubbles: true })); });
    const half0 = await page.getAttribute('#btn-explode', 'aria-pressed'); await page.click('#btn-explode'); await settled(page);
    res.half = { pressedAt50: half0, sliderAfterClick: await page.inputValue('#exp'), pressedAfter: await page.getAttribute('#btn-explode', 'aria-pressed') };
    check('desktop', 'explode at 50%: a pressed button un-explodes', half0 !== 'true' || res.half.sliderAfterClick === '0', res.half);
    await page.evaluate(() => { const i = document.querySelector('#exp'); i.value = 0; i.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.evaluate(() => { const i = document.querySelector('#ins'); i.value = 40; i.dispatchEvent(new Event('input', { bubbles: true })); });
    await freshFrame(page); await shot('3-insertion-40'); res.insValuetext = await page.getAttribute('#ins', 'aria-valuetext');
    // exploded, then "Play insertion": the explosion closes up (animated), then Mercury slides in. A software renderer may not draw a single frame
    // during the 1.2 s close-up, so the animation is checked by what was scheduled right after the click (an explode tween to 0 with a duration,
    // the kit still exploded, i.e. no snap) and by the settled end state, not by sampling a mid-animation frame at a fixed time.
    await page.evaluate(() => window.__unijack.explodeTo(1)); await settled(page);
    await page.click('#btn-play');
    const sched = await page.evaluate(() => ({ anim: window.__unijack.anim(), explode: +window.__unijack.kit.state.explode.toFixed(3) }));
    await settled(page, 300);
    res.playWhileExploded = { scheduled: sched, explodeEnd: await page.evaluate(() => window.__unijack.kit.state.explode), insertionEnd: await page.evaluate(() => window.__unijack.kit.state.insertion) };
    const tw = sched.anim.explode;
    check('desktop', 'Play while exploded animates the explosion closed (not a snap)', !!tw && tw.to === 0 && tw.ms >= 500 && sched.explode > 0.02 && sched.anim.play && res.playWhileExploded.explodeEnd === 0 && res.playWhileExploded.insertionEnd === 1, res.playWhileExploded);
    await page.click('#btn-parts'); await page.waitForTimeout(600);
    res.partsListed = await page.$$eval('#part-list button', (b) => b.length);
    await openPanel(page); await page.fill('#part-filter', 'zzzz'); await page.waitForTimeout(200);
    res.emptyFilter = { empty: await page.isVisible('#part-empty'), headings: await page.$$eval('#part-list h3:not([hidden])', (h) => h.length) }; check('desktop', 'empty filter shows a message and hides headings', res.emptyFilter.empty && res.emptyFilter.headings === 0, res.emptyFilter);
    await openPanel(page); await page.fill('#part-filter', 'J30'); await page.waitForTimeout(200);
    res.filterJ30 = await page.$$eval('#part-list h3:not([hidden])', (h) => h.map((x) => x.textContent)); await shot('4a-filtered');
    await openPanel(page); await page.fill('#part-filter', '');
    await page.evaluate(() => { const u = window.__unijack; const p = u.kit.parts.find((x) => x.userData.ref) || u.kit.parts[0]; if (p) u.select(p); });
    await page.waitForTimeout(600); await shot('4-parts-selected');
    res.statusNoteOnCard = await page.evaluate(() => document.querySelector('#card .note')?.textContent || null);
    // mouse buttons: only the left button selects
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    const box = await page.locator('#c').boundingBox(); const cx = box.x + box.width * 0.42, cy = box.y + box.height * 0.5;
    await page.mouse.click(cx, cy, { button: 'right' }); await page.waitForTimeout(200); const afterRight = await page.evaluate(() => !document.getElementById('card').hidden);
    await page.mouse.click(cx, cy, { button: 'middle' }); await page.waitForTimeout(200); const afterMiddle = await page.evaluate(() => !document.getElementById('card').hidden);
    await page.mouse.click(cx, cy); await page.waitForTimeout(300); const afterLeft = await page.evaluate(() => !document.getElementById('card').hidden);
    res.clicks = { afterRight, afterMiddle, afterLeft }; check('desktop', 'right and middle click do not select, left click does', !afterRight && !afterMiddle && afterLeft, res.clicks);
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    // labels: shown in the hero view, none over the plain undersides, occluded tags hidden
    await page.click('#btn-labels'); await freshFrame(page); await page.waitForTimeout(200); await shot('5-labels');
    const tags = async () => page.evaluate(() => document.querySelectorAll('.tag:not(.board):not([hidden])').length);
    res.labels = { hero: await tags() }; check('desktop', 'labels show in the hero view', res.labels.hero > 0, res.labels);
    await page.click('[data-view="under"]'); await settled(page, 300); await shot('6-underside'); res.labels.under = await tags();
    check('desktop', 'no designator tags over the underside', res.labels.under === 0, res.labels);
    await page.click('[data-view="top"]'); await settled(page, 300); res.labels.top = await tags(); await shot('6b-top-labels');
    await page.click('#btn-labels');
    // hide boards, explode: the guides must not run to empty space, and a list row of a hidden board brings the board back
    await page.click('[data-view="hero"]'); await settled(page);
    await page.click('[data-show="mercury"]'); await page.click('[data-show="peri"]');
    await page.evaluate(() => window.__unijack.explodeTo(1)); await settled(page);
    res.guides = await page.evaluate(() => { const g = window.__unijack.kit.root.getObjectByName('explode-guides'); const a = g.geometry.attributes.position; let live = 0; for (let i = 0; i < a.count; i += 2) { const dx = a.getX(i) - a.getX(i + 1), dy = a.getY(i) - a.getY(i + 1), dz = a.getZ(i) - a.getZ(i + 1); if (Math.hypot(dx, dy, dz) > 0.01) live++; } return { visible: g.visible, liveSegments: live }; });
    check('desktop', 'no guide lines to hidden boards', res.guides.liveSegments === 0, res.guides); await shot('7-hidden-boards-exploded');
    await openPanel(page); await page.fill('#part-filter', 'Pin header J1'); await page.waitForTimeout(150);
    await page.locator('#part-list button:not([hidden])').first().click(); await settled(page, 300);
    res.hiddenBoardRow = { periChipPressed: await page.getAttribute('[data-show="peri"]', 'aria-pressed'), card: await page.evaluate(() => !document.getElementById('card').hidden) };
    check('desktop', 'choosing a part of a hidden board shows the board again', res.hiddenBoardRow.periChipPressed === 'true' && res.hiddenBoardRow.card, res.hiddenBoardRow); await shot('8-hidden-board-reshown');
    await page.click('[data-show="mercury"]'); await page.evaluate(() => window.__unijack.explodeTo(0)); await settled(page);
  });
  await session('mobile', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, async (page, shot) => {
    await page.evaluate(() => { window.__unijack.controls.autoRotate = false; }); await settled(page); await freshFrame(page); await shot('1-hero');
    await page.tap('#btn-explode'); await settled(page, 300); await shot('2-exploded');
    await page.tap('#btn-explode'); await settled(page);
    await page.tap('#btn-parts'); await page.waitForTimeout(500); await shot('3-parts-sheet');
    await page.locator('#part-list button', { hasText: 'Tactile' }).first().tap(); await settled(page, 300); await shot('4-card-above-peek');
  });
}

if (args.extra !== '0' && args.extra !== 0) {
  // ---------- 3. keyboard walk: a visible, unclipped focus ring on every tab stop ----------
  for (const [w, h, label] of [[1440, 900, 'kbd-desktop'], [390, 844, 'kbd-phone'], [667, 375, 'kbd-landscape']]) {
    await session(label, { viewport: { width: w, height: h } }, async (page, shot, res) => {
      await page.evaluate(`window.__h = (${pageHelpers.toString()})()`);
      await page.evaluate(() => { window.__unijack.controls.autoRotate = false; document.activeElement?.blur(); });
      const probe = () => page.evaluate(() => {
        const e = document.activeElement; if (!e || e === document.body) return null; const { R, clipOf, outside, name } = window.__h; const cs = getComputedStyle(e);
        const ow = parseFloat(cs.outlineWidth) || 0, oo = parseFloat(cs.outlineOffset) || 0, r = R(e), grow = oo + ow, ring = [r[0] - grow, r[1] - grow, r[2] + grow, r[3] + grow];
        return { name: name(e), tag: e.tagName.toLowerCase(), focusVisible: e.matches(':focus-visible'), outline: `${cs.outlineStyle} ${ow}px offset ${oo}px ${cs.outlineColor}`, ring: cs.outlineStyle !== 'none' && ow >= 2 && !/rgba\(0, 0, 0, 0\)/.test(cs.outlineColor),
          clippedBy: outside(ring, clipOf(e)) ? 'ring clipped' : outside(r, [0, 0, innerWidth, innerHeight]) ? 'control off screen' : null, rect: r };
      });
      const stops = []; let first = null;
      for (let i = 0; i < 40; i++) {
        await page.keyboard.press('Tab'); await page.waitForTimeout(60);
        const s = await probe(); if (!s) break; const id = s.tag + ':' + s.name; if (id === first) break; first ??= id; stops.push(s);
        if (['btn-labels', 'c', 'hero', 'ins', 'About this model'].some((n) => s.name.startsWith(n)) || i === 0) {
          const pad = s.tag === 'canvas' ? null : { x: Math.max(0, s.rect[0] - 14), y: Math.max(0, s.rect[1] - 14), width: Math.min(w, s.rect[2] - s.rect[0] + 28), height: s.rect[3] - s.rect[1] + 28 };
          await shot(`focus-${String(i).padStart(2, '0')}-${s.name.replace(/\W+/g, '_')}`, pad ? { clip: pad } : {});
        }
      }
      res.stops = stops.map((s) => `${s.tag}:${s.name} ${s.ring && s.focusVisible ? 'ring' : 'NO-RING'}${s.clippedBy ? ' ' + s.clippedBy.toUpperCase() : ''}`);
      check(label, 'keyboard walk reaches the canvas, the dock and the disclosure', ['c', 'hero', 'ins', 'btn-play', 'About this model'].every((n) => stops.some((s) => s.name === n)), res.stops);
      for (const s of stops) check(label, `focus ring visible on ${s.tag}:${s.name}`, s.focusVisible && s.ring, s.outline);
      for (const s of stops) check(label, `focus ring not clipped on ${s.tag}:${s.name}`, !s.clippedBy, s.clippedBy);
      // Escape flow: Parts button -> Enter moves focus into the panel; Escape closes it and returns focus; card first, then panel
      await page.focus('#btn-parts'); await page.keyboard.press('Enter'); await page.waitForTimeout(300);
      const f1 = await page.evaluate(() => document.activeElement?.id); await page.locator('#part-list button').nth(2).focus(); await page.keyboard.press('Enter'); await settled(page);
      const card1 = await page.evaluate(() => !document.getElementById('card').hidden), panelAfterPick = await page.evaluate(() => !document.getElementById('parts-panel').hidden);   // short stages close the panel on a selection, so then only the card is left to close
      await page.keyboard.press('Escape'); await page.waitForTimeout(150); const afterEsc1 = await page.evaluate(() => ({ card: !document.getElementById('card').hidden, panel: !document.getElementById('parts-panel').hidden }));
      await page.keyboard.press('Escape'); await page.waitForTimeout(150); const afterEsc2 = await page.evaluate(() => ({ card: !document.getElementById('card').hidden, panel: !document.getElementById('parts-panel').hidden, focus: document.activeElement?.id }));
      res.escape = { focusOnOpen: f1, cardOpened: card1, panelAfterPick, afterEsc1, afterEsc2 };
      check(label, 'Enter on Parts moves focus into the panel', f1 === 'part-filter', f1);
      check(label, 'Escape closes the card first, then the panel (when the layout keeps it open), and focus ends on Parts', card1 && !afterEsc1.card && afterEsc1.panel === panelAfterPick && !afterEsc2.panel && afterEsc2.focus === 'btn-parts', res.escape);
      // Tab from the Parts button reaches the Hero chip without walking the 87-row list
      await page.focus('#btn-parts'); await page.keyboard.press('Enter'); await page.waitForTimeout(200); await page.focus('#btn-parts'); let n = 0; for (; n < 12; n++) { await page.keyboard.press('Tab'); if (await page.evaluate(() => document.activeElement?.dataset?.view === 'hero')) break; }
      res.tabsFromPartsToHero = n + 1; check(label, 'Hero is within a few Tab presses of the Parts button with the panel open', n < 6, n + 1);
    });
  }

  // ---------- 4. reduced motion: no dead controls ----------
  await session('reduced-motion', { viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' }, async (page, shot, res) => {
    await page.waitForTimeout(800);
    res.rotate = { disabled: await page.isDisabled('#btn-rotate'), pressed: await page.getAttribute('#btn-rotate', 'aria-pressed'), title: await page.getAttribute('#btn-rotate', 'title'), ariaLabel: await page.getAttribute('#btn-rotate', 'aria-label') };
    check('reduced-motion', 'Auto-rotate is disabled with an explanation, not a dead control', res.rotate.disabled && res.rotate.pressed === 'false' && !!res.rotate.title, res.rotate);
    check('reduced-motion', 'Auto-rotate keeps a constant accessible name (no aria-label override)', res.rotate.ariaLabel === null, res.rotate);
    res.play = await page.textContent('#btn-play'); check('reduced-motion', 'play button is labelled Toggle insertion', /toggle/i.test(res.play), res.play);
    await page.evaluate(() => window.__unijack.explodeTo(1)); await page.waitForTimeout(400); await page.click('#btn-play'); await page.waitForTimeout(300);
    res.afterPlay = await page.evaluate(() => window.__unijack.kit.state); check('reduced-motion', 'toggle insertion is consistent with the explosion (closes it)', res.afterPlay.explode === 0, res.afterPlay);
  });

  // ---------- 5. context loss ----------
  await session('context-loss', { viewport: { width: 900, height: 600 } }, async (page, shot, res) => {
    await page.evaluate(() => { window.__unijack.controls.autoRotate = false; }); await settled(page); await freshFrame(page);
    await page.locator('#c').screenshot({ path: path.join(OUT, 'context-loss-0-before.png') });
    await page.evaluate(() => { const gl = document.getElementById('c').getContext('webgl2') || document.getElementById('c').getContext('webgl'); window.__lose = gl.getExtension('WEBGL_lose_context'); window.__lose.loseContext(); }); await page.waitForTimeout(400);
    res.lost = await page.isVisible('#gl-notice'); check('context-loss', 'a notice appears when the context is lost', res.lost); await shot('1-lost');
    await page.evaluate(() => window.__lose.restoreContext()); await page.waitForTimeout(1500);
    res.restored = { notice: await page.isVisible('#gl-notice') }; check('context-loss', 'the notice clears when the context is restored', !res.restored.notice);
    // a canvas read needs a fresh frame; ask for one and wait until it has been rendered
    await freshFrame(page); await page.waitForTimeout(200);
    await page.locator('#c').screenshot({ path: path.join(OUT, 'context-loss-2-restored.png') });
    res.note = 'compare context-loss-0-before.png with context-loss-2-restored.png (lighting must match)';
  });
}

// ---------- 6. Backdrop chip: dark studio <-> white sweep without console errors; the solder-mask colour stays within 10 percent ----------
if (args.env !== '0' && args.env !== 0) {
  await session('env-sweep', { viewport: { width: 1440, height: 900 } }, async (page, shot, res) => {
    await page.evaluate(() => { window.__unijack.controls.autoRotate = false; }); await settled(page);
    res.studio = await page.evaluate(samplePixels); res.chipStudio = await page.getAttribute('#btn-env', 'aria-pressed');
    await page.click('#btn-env'); await settled(page);
    res.sweep = await page.evaluate(samplePixels); res.chipSweep = await page.getAttribute('#btn-env', 'aria-pressed'); res.kindSweep = await page.evaluate(() => window.__unijack.stage.envKind);
    await shot('1-sweep');
    await page.click('#btn-env'); await settled(page); await freshFrame(page);
    res.back = { chip: await page.getAttribute('#btn-env', 'aria-pressed'), kind: await page.evaluate(() => window.__unijack.stage.envKind), ground: await page.evaluate(() => window.__unijack.stage.ground.name) };
    check('env-sweep', 'Backdrop chip starts unpressed on the dark studio', res.chipStudio === 'false', res.chipStudio);
    check('env-sweep', 'Backdrop chip toggles to the sweep (aria-pressed, stage.envKind)', res.chipSweep === 'true' && res.kindSweep === 'sweep', [res.chipSweep, res.kindSweep]);
    check('env-sweep', 'Backdrop chip toggles back to the studio', res.back.chip === 'false' && res.back.kind === 'studio', res.back);
    const lum = (p) => 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
    check('env-sweep', 'studio backdrop is dark and the sweep backdrop is light', lum(res.studio.corner) < 90 && lum(res.sweep.corner) > 200, [res.studio.corner, res.sweep.corner]);
    check('env-sweep', 'solder mask found in both frames', res.studio.teal > 5000 && res.sweep.teal > 5000, [res.studio.teal, res.sweep.teal]);
    const ratio = res.sweep.lum / res.studio.lum; res.maskLumRatio = +ratio.toFixed(3);
    check('env-sweep', 'solder-mask colour within 10 percent between studio and sweep (luminance of the mean teal)', ratio > 0.9 && ratio < 1.1, { studio: res.studio.mean, sweep: res.sweep.mean, ratio: res.maskLumRatio });
  });
  await session('env-sweep-url', { viewport: { width: 1440, height: 900 } }, async (page, shot, res) => {
    await page.evaluate(() => { window.__unijack.controls.autoRotate = false; }); await settled(page); await freshFrame(page);
    res.start = { chip: await page.getAttribute('#btn-env', 'aria-pressed'), kind: await page.evaluate(() => window.__unijack.stage.envKind) };
    check('env-sweep-url', '?env=sweep starts on the sweep with the chip pressed', res.start.chip === 'true' && res.start.kind === 'sweep', res.start);
    await shot('1-hero');
  }, { query: '?env=sweep' });
}

// ---------- 7. post chain under ?quality=high: on software GL the adaptive quality drops AO and DOF within the first auto-rotate frames of every
// session above, so none of their screenshots exercises GTAO or the depth of field; this session pins the chain on and checks it is really running
// (a GTAO / DOF regression would otherwise pass the suite). Skip with --post=0.
// The session runs with reduced motion: the viewer then starts without auto-rotate and without camera damping. (Without it the auto-rotation that runs
// from the first frame leaves a damping tail of about 140 ticks after it is switched off, 2 s at 60 fps but minutes at the 2.7 s per AO + DOF frame of
// software GL, and DOF, correctly, stays off while the camera still moves.) The post chain itself does not depend on the motion setting.
if (args.post !== '0' && args.post !== 0) {
  await session('quality-high', { viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' }, async (page, shot, res) => {
    await settled(page); await freshFrame(page);   // Hero preset, nothing moving: DOF is due
    res.post = await page.evaluate(() => { const U = window.__unijack; return { quality: U.quality, hasPost: !!U.post, state: U.post ? { ...U.post.state } : null, passes: U.post ? U.post.passCount : 0, dropped: U.perf.dropped, slow: U.perf.slow, samples: U.perf.samples }; });
    await shot('1-hero-ao-dof');
    check('quality-high', '?quality=high keeps the post chain (ao + aa + dof in the settled Hero view, 4 passes)', res.post.hasPost && res.post.state?.ao === true && res.post.state?.aa === true && res.post.state?.dof === true && res.post.passes === 4, res.post);
    check('quality-high', 'adaptive quality never dropped AO under ?quality=high', res.post.dropped === false, res.post);
    // DOF goes off while something moves (the camera rotating; set on the controls directly, the UI button is disabled under reduced motion) and comes back when it stops
    await page.evaluate(() => { window.__unijack.controls.autoRotate = true; }); await freshFrame(page); await freshFrame(page);
    res.rotating = await page.evaluate(() => ({ ...window.__unijack.post.state }));
    await page.evaluate(() => { window.__unijack.controls.autoRotate = false; }); await settled(page); await freshFrame(page);
    res.stopped = await page.evaluate(() => ({ ...window.__unijack.post.state }));
    check('quality-high', 'depth of field is off while auto-rotating and on again once still (AO stays on)', res.rotating.ao === true && res.rotating.dof === false && res.stopped.ao === true && res.stopped.dof === true, { rotating: res.rotating, stopped: res.stopped });
  }, { query: '?quality=high' });
}

// ---------- 8. no WebGL: the fallback and dead controls ----------
if (args.extra !== '0' && args.extra !== 0) {
  const nb = await chromium.launch({ executablePath: exe, args: ['--disable-webgl', '--disable-3d-apis', '--disable-gpu', '--no-sandbox'] });
  for (const [w, h] of [[1440, 900], [390, 844]]) {
    const ctx = await nb.newContext({ viewport: { width: w, height: h } }); const page = await ctx.newPage(); const errors = [], warnings = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); else if (m.type() === 'warning') warnings.push(m.text().slice(0, 200)); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + String(e).slice(0, 200)));
    await page.goto(base + PAGE); await page.waitForTimeout(2500);
    const r = await page.evaluate(() => { const vis = (e) => e && e.getClientRects().length > 0 && !e.closest('[hidden]'); return { fallbackShown: vis(document.getElementById('fallback')), noGlClass: document.getElementById('app').classList.contains('no-gl'), liveControls: [...document.querySelectorAll('.top-actions button, .dock button, .dock input')].filter(vis).length, loaderVisible: vis(document.getElementById('loader')), shortLine: vis(document.querySelector('.note .short')), img: document.querySelector('#fallback img')?.complete }; });
    await page.screenshot({ path: path.join(OUT, `nogl-${w}x${h}.png`) });
    report.push({ name: `no-webgl-${w}x${h}`, result: r, errors, warnings });
    const where = `no-webgl-${w}x${h}`;
    check(where, 'fallback photo and message shown', r.fallbackShown && r.img); check(where, 'no dead controls left on screen', r.liveControls === 0, r.liveControls); check(where, 'loader gone', !r.loaderVisible);
    check(where, 'honesty line still visible', r.shortLine); check(where, 'no uncaught page error', !errors.some((e) => e.startsWith('pageerror')), errors);
    await ctx.close();
  }
  await nb.close();
}

console.log(JSON.stringify(report, null, 1));
console.log(failures.length ? `\nFAILED CHECKS (${failures.length}):\n - ` + failures.join('\n - ') : '\nALL CHECKS PASSED');
await browser.close(); server.close();
process.exitCode = failures.length ? 1 : 0;
