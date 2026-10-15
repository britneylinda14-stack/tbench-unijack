import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createUniJack } from './model.js';
import { makeStage } from './lib/stage.js';
import { makePost } from './lib/post.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
const appEl = $('#app'), canvas = $('#c'), stageEl = $('#stage');
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const DEG = Math.PI / 180;
// ?quality=low turns the post-processing chain off (plain renderer.render: no ambient occlusion, depth of field or SMAA); ?quality=high keeps AO and DOF on
// regardless of the measured frame time. Otherwise AO and DOF are dropped once about 20 frames in a row exceed about 30 ms (adaptive quality).
const PARAMS = new URLSearchParams(location.search);
const QUALITY = PARAMS.get('quality') || 'auto';
// ?env=sweep starts on the white sweep (bright backdrop and table, like the gallery photographs); the dark studio is the default. Both are rendering choices.
const ENV0 = PARAMS.get('env') === 'sweep' ? 'sweep' : 'studio';

// the full disclosure is open only on roomy screens; on phones and windows under 860 px high it starts collapsed (the short line and the summary stay visible) so the model keeps the space
$('#about').open = !matchMedia('(max-width: 640px), (max-height: 860px)').matches;

function fail(kind, err) {
  $('#loader').hidden = true; appEl.classList.add('no-gl');
  if (kind !== 'webgl') $('#fallback-msg').textContent = 'The 3D model could not be built in this browser. Showing the top-down photograph of the base board that the model uses.';
  $('#fallback').hidden = false;
  (kind === 'webgl' ? console.warn : console.error)('3D unavailable (' + kind + '):', err && err.message ? err.message : err);
}

let renderer = null;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }); } catch (e) { fail('webgl', e); }
if (renderer) await start(renderer).catch((e) => { fail('script', e); });

async function start(renderer) {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const stage = makeStage(renderer, { shadows: true, env: ENV0 });
  const scene = stage.scene;
  const camera = new THREE.PerspectiveCamera(32, 1, 1, 4000);
  const post = QUALITY === 'low' ? null : makePost(renderer, scene, camera, { ao: true, dof: false, aa: true });
  const controls = new OrbitControls(camera, canvas);
  Object.assign(controls, { enableDamping: !reduce.matches, dampingFactor: 0.08, screenSpacePanning: true, minDistance: 30, maxDistance: 900, autoRotateSpeed: 0.7 });
  let needs = true, kit = null, currentView = 'hero', tween = null, frames = 0, ticks = 0, camSettling = false;
  let expAnim = null, play = null, sel = null, helper = null, occAt = 0;   // animation and selection state (declared up front: resize() and applyView() read it)
  controls.addEventListener('change', () => { needs = true; });
  controls.addEventListener('start', () => { setRotate(false); clearViewChips(); });

  const resize = () => {
    const w = stageEl.clientWidth, h = stageEl.clientHeight; if (!w || !h) return;
    appEl.style.setProperty('--stage-h', h + 'px');
    renderer.setSize(w, h, false); if (post) post.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); needs = true;
    if (kit && currentView && !tween) applyView(currentView, true);   // keep a preset view fitted when the window or phone orientation changes
  };
  new ResizeObserver(resize).observe(stageEl); resize();

  // ---------- model ----------
  try { kit = await createUniJack(); } catch (e) { fail('model', e); return; }
  scene.add(kit.root);
  kit.root.updateMatrixWorld(true);
  const bbox = new THREE.Box3().setFromObject(kit.root);
  const center = bbox.getCenter(new THREE.Vector3());
  const radius = bbox.getSize(new THREE.Vector3()).length() / 2;
  // the key's shadow camera hugs the kit (4k map spent on the boards); refitted whenever the pose changes (explode / insertion move the boards)
  const shadowBox = new THREE.Box3(); let shadowPose = null;
  function fitShadowToKit() {
    const key = kit.state.insertion + ':' + kit.state.explode; if (key === shadowPose) return; shadowPose = key;
    kit.root.updateMatrixWorld(true); shadowBox.setFromObject(kit.root); stage.fitShadow(shadowBox);
  }
  fitShadowToKit();

  const boardOf = (o) => { for (let n = o; n; n = n.parent) { if (n === kit.base) return 'base'; if (n === kit.mercury) return 'mercury'; if (n === kit.peri) return 'peri'; } return 'base'; };
  const visibleDeep = (o) => { while (o) { if (!o.visible) return false; o = o.parent; } return true; };
  const show = { base: true, mercury: true, peri: true };
  const boardObj = { base: kit.base, mercury: kit.mercury, peri: kit.peri };
  const isOn = (v) => v >= 0.5;                     // one predicate for "exploded": the button, the framing and aria-pressed all use it

  // run fn with the kit seated and assembled and every board shown, then put everything back
  function withPose(pose, fn) {
    const s = kit.state, ins0 = s.insertion, exp0 = s.explode;
    const ins = pose.insertion ?? ins0, exp = pose.explode ?? exp0;
    const moved = ins !== ins0 || exp !== exp0, all = pose.all && !(show.base && show.mercury && show.peri);
    if (moved) { kit.setInsertion(ins); kit.setExplode(exp); }
    if (all) kit.setVisible({ base: true, mercury: true, peri: true });
    try { return fn(); } finally {
      if (all) kit.setVisible(show);
      if (moved) { kit.setInsertion(ins0); kit.setExplode(exp0); }
    }
  }
  const seated = (fn) => withPose({ insertion: 1, explode: 0, all: true }, fn);

  // ---------- camera: presets are fitted from the projected bounding box for the current aspect ----------
  const VIEWS = { hero: { az: 32, el: 34, fill: 0.9 }, top: { az: 0, el: 89, fill: 0.94 }, low: { az: 18, el: 11, fill: 0.9 }, side: { az: 90, el: 7, fill: 0.9 }, under: { az: 28, el: -34, fill: 0.9 } };
  const dirFromAzEl = (az, el) => { const a = az * DEG, e = el * DEG; return new THREE.Vector3(Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a)); };
  const azElOf = (v) => ({ az: Math.atan2(v.x, v.z) / DEG, el: Math.asin(THREE.MathUtils.clamp(v.y / v.length(), -1, 1)) / DEG });
  function fitDistance(r = radius, fw = 1, fh = 1) {       // sphere fit for a region that is fw x fh of the canvas (used for single parts)
    const th = Math.tan(camera.fov * DEG / 2), half = Math.min(th * fh, th * camera.aspect * fw);
    return (r * 0.92) / Math.sin(Math.atan(half));
  }
  // corners of the bounding box of each shown board in the current pose
  function boardPoints() {
    kit.root.updateMatrixWorld(true);
    const list = Object.keys(boardObj).filter((k) => show[k]); if (!list.length) list.push('base', 'mercury', 'peri');
    const pts = [];
    for (const k of list) { const b = new THREE.Box3().setFromObject(boardObj[k]); for (let i = 0; i < 8; i++) pts.push(new THREE.Vector3(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z)); }
    return pts;
  }
  const ptsAtExplode = (e) => (Math.abs(kit.state.explode - e) < 1e-6 ? boardPoints() : withPose({ explode: e }, boardPoints));
  // Exact fit for a fixed view direction: with the camera orientation fixed, every point allows an interval of camera offsets (along the camera's
  // right and up axes) that widens linearly with the distance, so the smallest distance at which all points project inside +-fill of the canvas is
  // found by bisecting on "the intervals still intersect"; the offset is then the middle of the intersection. (An iterative re-centring on the
  // projected midpoint overshoots when the near end of a long board is close to the camera, as in the side view on a wide, short stage.)
  const fv = new THREE.Vector3(), fUp = new THREE.Vector3(0, 1, 0), fRight = new THREE.Vector3(), fCamUp = new THREE.Vector3();
  function frameFor(pts, dir, fill = 0.9) {
    const c = new THREE.Box3().setFromPoints(pts).getCenter(new THREE.Vector3());
    const back = dir.clone().normalize();                      // from the target towards the camera; the camera looks along -back
    fRight.crossVectors(fUp, back); if (fRight.lengthSq() < 1e-8) fRight.set(1, 0, 0); fRight.normalize(); fCamUp.crossVectors(back, fRight);
    const tanV = Math.tan(camera.fov * DEG / 2), kx = fill * tanV * camera.aspect, ky = fill * tanV;
    const X = [], Y = [], Z = []; let zMax = -1e9;
    for (const p of pts) { fv.copy(p).sub(c); X.push(fv.dot(fRight)); Y.push(fv.dot(fCamUp)); const z = fv.dot(back); Z.push(z); zMax = Math.max(zMax, z); }
    const span = (d) => {                                      // intersection of the allowed offsets for a camera at distance d from the centroid plane
      let x0 = -1e9, x1 = 1e9, y0 = -1e9, y1 = 1e9;
      for (let i = 0; i < X.length; i++) { const w = d - Z[i]; x0 = Math.max(x0, X[i] - kx * w); x1 = Math.min(x1, X[i] + kx * w); y0 = Math.max(y0, Y[i] - ky * w); y1 = Math.min(y1, Y[i] + ky * w); }
      return { x0, x1, y0, y1, ok: x0 <= x1 && y0 <= y1 };
    };
    let lo = zMax + 1, hi = Math.max(6000, zMax + 6000);       // depth of the nearest point is at least 1 mm
    for (let i = 0; i < 50; i++) { const mid = (lo + hi) / 2; if (span(mid).ok) hi = mid; else lo = mid; }
    const d = hi, e = span(d), tgt = c.clone().addScaledVector(fRight, (e.x0 + e.x1) / 2).addScaledVector(fCamUp, (e.y0 + e.y1) / 2);
    return { tgt, pos: tgt.clone().addScaledVector(back, d), dist: d };
  }
  function flyTo(pos, tgt, ms = 900) {
    if (reduce.matches) { tween = null; camera.position.copy(pos); controls.target.copy(tgt); controls.update(); needs = true; return; }
    const s0 = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
    const s1 = new THREE.Spherical().setFromVector3(pos.clone().sub(tgt));
    let dth = s1.theta - s0.theta; dth = Math.atan2(Math.sin(dth), Math.cos(dth));   // shortest way round
    tween = { t0: performance.now(), ms, s0, s1, dth, g0: controls.target.clone(), g1: tgt.clone() };
  }
  function stepTween(now) {
    if (!tween) return false;
    const k = Math.min(1, (now - tween.t0) / tween.ms), e = k * k * (3 - 2 * k), t = tween;
    controls.target.lerpVectors(t.g0, t.g1, e);
    const s = new THREE.Spherical(THREE.MathUtils.lerp(t.s0.radius, t.s1.radius, e), THREE.MathUtils.lerp(t.s0.phi, t.s1.phi, e), t.s0.theta + t.dth * e);
    camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(s));
    if (k >= 1) tween = null;
    return true;
  }
  function applyView(name, instant) {
    const v = VIEWS[name]; if (!v) return;
    const f = frameFor(ptsAtExplode(expAnim ? expAnim.to : kit.state.explode), dirFromAzEl(v.az, v.el), v.fill);
    if (instant) { tween = null; camera.position.copy(f.pos); controls.target.copy(f.tgt); controls.update(); needs = true; } else flyTo(f.pos, f.tgt);
  }
  function flyToView(name) {
    if (!VIEWS[name]) return;
    setRotate(false); applyView(name, false); currentView = name;
    $$('[data-view]').forEach((b) => { const on = b.dataset.view === name; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
  }
  function clearViewChips() { currentView = null; $$('[data-view]').forEach((b) => { b.classList.remove('on'); b.setAttribute('aria-pressed', 'false'); }); }
  applyView('hero', true);
  $$('[data-view]').forEach((b) => b.addEventListener('click', () => flyToView(b.dataset.view)));

  // ---------- auto-rotate ----------
  const rotBtn = $('#btn-rotate'), playBtn = $('#btn-play');
  function setRotate(on) { controls.autoRotate = on && !reduce.matches; rotBtn.setAttribute('aria-pressed', String(controls.autoRotate)); needs = true; }
  rotBtn.addEventListener('click', () => setRotate(!controls.autoRotate));
  function applyReduce() {                          // also runs when the system setting changes while the page is open
    controls.enableDamping = !reduce.matches;
    rotBtn.disabled = reduce.matches; rotBtn.title = reduce.matches ? 'Automatic rotation is off because your system asks for reduced motion' : '';
    playBtn.textContent = reduce.matches ? 'Toggle insertion' : 'Play insertion';
    if (reduce.matches) setRotate(false);
  }
  applyReduce(); setRotate(!reduce.matches);
  reduce.addEventListener?.('change', applyReduce);

  // ---------- backdrop: dark studio (default) or a white sweep like the photographs ----------
  const envBtn = $('#btn-env');
  function setEnv(name) {
    name = name === 'sweep' ? 'sweep' : 'studio'; if (name !== stage.envKind) stage.setEnv(name);
    envBtn.setAttribute('aria-pressed', String(name === 'sweep')); needs = true;
  }
  envBtn.addEventListener('click', () => setEnv(stage.envKind === 'sweep' ? 'studio' : 'sweep'));
  setEnv(ENV0);

  // ---------- keyboard on the canvas (Escape is handled at document level, below) ----------
  canvas.addEventListener('keydown', (e) => {
    const step = (e.shiftKey ? 2 : 8) * DEG;
    const off = camera.position.clone().sub(controls.target), s = new THREE.Spherical().setFromVector3(off);
    let used = true;
    switch (e.key) {
      case 'ArrowLeft': s.theta -= step; break; case 'ArrowRight': s.theta += step; break;
      case 'ArrowUp': s.phi = Math.max(0.05, s.phi - step); break; case 'ArrowDown': s.phi = Math.min(Math.PI - 0.05, s.phi + step); break;
      case '+': case '=': s.radius = Math.max(controls.minDistance, s.radius * 0.88); break;
      case '-': case '_': s.radius = Math.min(controls.maxDistance, s.radius / 0.88); break;
      default: used = false;
    }
    if (used) { e.preventDefault(); tween = null; setRotate(false); clearViewChips(); camera.position.copy(controls.target).add(off.setFromSpherical(s)); controls.update(); needs = true; }
  });

  // ---------- visibility / insertion / explode ----------
  function setShow(k, on) {
    show[k] = on; const b = $(`[data-show="${k}"]`); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
    kit.setVisible(show); if (sel && !visibleDeep(sel)) select(null); refreshAnchors(); needs = true;
  }
  $$('[data-show]').forEach((b) => b.addEventListener('click', () => setShow(b.dataset.show, !show[b.dataset.show])));
  const ins = $('#ins'), insOut = $('#ins-out');
  // the visible text is [short, extra]; the extra part is dropped on very narrow screens (CSS), the full text is always the slider's aria-valuetext
  const insParts = (t) => (t >= 0.999 ? ['Seated', ', latches closed'] : t <= 0.001 ? ['Separated', ''] : t < 0.62 ? ['Sliding in', ' at an angle'] : ['Pressing down', '']);
  const insText = (t) => insParts(t).join('');
  function setIns(t) {
    kit.setInsertion(t); ins.value = Math.round(t * 100);
    const [a, b] = insParts(t); insOut.replaceChildren(a, ...(b ? [el('span', 'more', b)] : [])); ins.setAttribute('aria-valuetext', insText(t)); refreshAnchors(); needs = true;
  }
  ins.addEventListener('input', () => { play = null; setIns(ins.value / 100); });
  playBtn.addEventListener('click', () => {
    if (reduce.matches) { play = null; expAnim = null; setExpl(0); setIns(kit.state.insertion > 0.5 ? 0 : 1); return; }
    const m = new THREE.Vector3(); seated(() => kit.mercury.getWorldPosition(m));   // aim at the seat, wherever the kit is now
    const wait = kit.state.explode > 0.001 ? 1200 : 0;                              // an exploded kit first closes up, animated
    if (wait) expAnim = { t0: performance.now(), ms: wait, from: kit.state.explode, to: 0 };
    const tgt = new THREE.Vector3(m.x - 6, 6, m.z);
    setRotate(false); clearViewChips();
    flyTo(tgt.clone().add(dirFromAzEl(72, 16).multiplyScalar(fitDistance(radius * 0.62))), tgt, 900);
    setIns(0); play = { t0: performance.now() + Math.max(700, wait), ms: 3800 };
  });
  function stepPlay(now) {
    if (!play) return false;
    const k = Math.min(1, Math.max(0, (now - play.t0) / play.ms)); setIns(k); if (k >= 1) play = null; return true;
  }
  const expIn = $('#exp'), expOut = $('#exp-out'), expBtn = $('#btn-explode');
  const expText = (v) => { const p = Math.round(v * 100); return p + ' percent, ' + (p === 0 ? 'assembled' : p === 100 ? 'fully exploded' : 'partly exploded'); };
  function setExpl(v) {
    kit.setExplode(v); expIn.value = Math.round(v * 100); expOut.textContent = Math.round(v * 100) + '%'; expIn.setAttribute('aria-valuetext', expText(v));
    expBtn.setAttribute('aria-pressed', String(isOn(v))); refreshAnchors(); needs = true;
  }
  function frameForExplode(on) {
    const dir = camera.position.clone().sub(controls.target).normalize();
    if (on && dir.y < 0.35) { dir.y = 0.42; dir.normalize(); }          // need some elevation to see the separation
    clearViewChips(); const f = frameFor(ptsAtExplode(on ? 1 : 0), dir, 0.86); flyTo(f.pos, f.tgt, 1200);
  }
  function startExplode(t) {
    if (reduce.matches) { expAnim = null; setExpl(t); return; }
    expAnim = { t0: performance.now(), ms: 1200, from: kit.state.explode, to: t };
  }
  function explodeTo(t) { play = null; frameForExplode(isOn(t)); startExplode(t); }
  function stepExplode(now) {
    if (!expAnim) return false;
    const k = Math.min(1, (now - expAnim.t0) / expAnim.ms); setExpl(expAnim.from + (expAnim.to - expAnim.from) * k);
    if (k >= 1) expAnim = null; return true;
  }
  expBtn.addEventListener('click', () => explodeTo(isOn(expAnim ? expAnim.to : kit.state.explode) ? 0 : 1));   // rotation keeps running while exploded
  expIn.addEventListener('input', () => { expAnim = null; setExpl(expIn.value / 100); });

  // ---------- which parts can be seen when the kit is assembled ----------
  const occRay = new THREE.Raycaster(), tmpM = new THREE.Matrix4();
  const occluders = () => { const a = []; kit.root.traverse((o) => { if (o.isMesh && visibleDeep(o)) a.push(o); }); return a; };
  const sampleCache = new WeakMap();
  // points that lie on the part's own surface (top-most vertices of its meshes, nudged slightly inward), stored in mesh-local space
  function samplesOf(part) {
    let s = sampleCache.get(part); if (s) return s;
    const own = []; part.traverse((o) => { if (o.isMesh && kit.infoFor(o) === part) own.push(o); });
    const plain = own.filter((o) => !o.isInstancedMesh), src = (plain.length ? plain : own).slice(0, 24);
    const per = Math.max(2, Math.ceil(24 / Math.max(1, src.length)));
    s = [];
    for (const m of src) {
      if (m.isInstancedMesh) {
        const n = Math.min(m.count, per);
        for (let i = 0; i < n; i++) { m.getMatrixAt(Math.floor((i * m.count) / n), tmpM); s.push({ m, p: new THREE.Vector3().setFromMatrixPosition(tmpM) }); }
        continue;
      }
      const pos = m.geometry.getAttribute('position'); if (!pos) continue;
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      const c = m.geometry.boundingBox.getCenter(new THREE.Vector3()), idx = [];
      for (let i = 0; i < pos.count; i++) idx.push(i);
      idx.sort((a, b) => pos.getY(b) - pos.getY(a));
      const top = idx.slice(0, Math.min(40, idx.length)), n = Math.min(top.length, per);
      for (let i = 0; i < n; i++) { const k = top[Math.floor((i * top.length) / n)]; s.push({ m, p: new THREE.Vector3().fromBufferAttribute(pos, k).lerp(c, 0.04) }); }
    }
    sampleCache.set(part, s); return s;
  }
  const _w = new THREE.Vector3(), _d = new THREE.Vector3();
  // fraction of the part's sample points whose line to camPos first meets the part itself (matrices must be current)
  function visibleFraction(part, camPos, list, maxSamples = 24, tally = null) {
    const s = samplesOf(part); if (!s.length) return null;
    const step = Math.max(1, s.length / maxSamples); let vis = 0, n = 0;
    for (let i = 0; i < s.length; i += step) {
      const q = s[Math.floor(i)]; _w.copy(q.p).applyMatrix4(q.m.matrixWorld); _d.copy(_w).sub(camPos); const dist = _d.length(); _d.divideScalar(dist);
      occRay.set(camPos, _d); occRay.near = 0; occRay.far = dist + 5;
      const hits = occRay.intersectObjects(list, false); n++;
      if (hits.length && kit.infoFor(hits[0].object) === part) vis++;
      else if (tally && hits.length) { const b = boardOf(hits[0].object); tally[b] = (tally[b] || 0) + 1; }
    }
    return n ? vis / n : null;
  }
  const dirsAssembled = [[0, 89], [32, 34], ...[0, 90, 180, 270].map((a) => [a, 50]), ...[0, 45, 90, 135, 180, 225, 270, 315].map((a) => [a, 20])];
  const visCache = new Map(), GROUP_TITLE = { base: 'UniJack base board', mercury: 'Mercury module', peri: 'PeriBoard' };
  // { hidden, note } for the assembled, seated kit; computed from the model's geometry, not typed in
  function visInfo(part) {
    if (visCache.has(part)) return visCache.get(part);
    const info = seated(() => {
      kit.root.updateMatrixWorld(true); const list = occluders();
      for (const [az, el] of dirsAssembled) {
        const f = visibleFraction(part, center.clone().addScaledVector(dirFromAzEl(az, el), 600), list, 16);
        if (f === null || f > 0) return { hidden: false };
      }
      const tally = {}; visibleFraction(part, center.clone().addScaledVector(dirFromAzEl(0, 89), 600), list, 16, tally);
      const by = Object.keys(tally).sort((a, b) => tally[b] - tally[a])[0], own = boardOf(part);
      const note = by === 'mercury' ? (own === 'mercury' ? 'on the back of Mercury' : 'under Mercury') : by === 'peri' ? 'under the PeriBoard' : 'hidden when assembled';
      return { hidden: true, note };
    });
    visCache.set(part, info); return info;
  }

  // ---------- selection + inspector ----------
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const selBox = new THREE.Box3();
  let down = null;
  canvas.addEventListener('pointerdown', (e) => { down = e.button === 0 && e.isPrimary ? { x: e.clientX, y: e.clientY, t: performance.now() } : null; });   // only the primary (left / first-touch) button selects
  canvas.addEventListener('pointerup', (e) => {
    if (e.button === 0 && down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6 && performance.now() - down.t < 500) {
      const r = canvas.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObject(kit.root, true).find((h) => visibleDeep(h.object) && kit.infoFor(h.object));
      select(hit ? kit.infoFor(hit.object) : null);
    }
    down = null;
  });
  const STATUS = { 'photo-verified': 'photo-verified', 'photo-derived': 'photo-derived', assumed: 'assumed' };
  const refRe = (r) => new RegExp('\\b' + r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
  // a label that repeats the printed designator ("Pin header J1") is shown without it, since the designator is shown beside it
  const cleanLabel = (u) => { if (!u.ref) return u.label; const s = u.label.replace(refRe(u.ref), '').replace(/\s{2,}/g, ' ').replace(/^[\s:,\-(]+|[\s:,\-)]+$/g, ''); return s.length >= 3 ? s : u.label; };
  const AGGREGATE = /\bsmall parts\b|\bchip (resistors|passives)\b|\bcolumn of\b|\brow of\b|\(x?\d+\)|\bparts\b/i;
  const dimCache = new WeakMap();
  // size in the seated, assembled pose (so the card does not change while the module is mid-insertion), cached per part
  function dimsOf(obj) {
    let d = dimCache.get(obj); if (d) return d;
    d = seated(() => { kit.root.updateMatrixWorld(true); return new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3()); });
    dimCache.set(obj, d); return d;
  }
  const cardEl = $('#card');
  function showCard(obj) {
    cardEl.replaceChildren();
    if (!obj) { cardEl.hidden = true; return; }
    const u = obj.userData, s = dimsOf(obj), vi = visInfo(obj);
    const x = el('button', 'x'); x.append(el('span', null, '×')); x.firstChild.setAttribute('aria-hidden', 'true'); x.setAttribute('aria-label', 'Close part info'); x.onclick = () => closeCard();
    const inner = el('div', 'card-in');
    const h = el('h2'); if (u.ref) h.append(el('span', 'ref', u.ref)); h.append(el('span', null, cleanLabel(u))); h.append(el('span', 'st ' + (u.status || 'assumed'), STATUS[u.status] || 'assumed'));
    inner.append(h);
    if (u.desc) inner.append(el('p', null, u.desc));
    if (u.status === 'photo-verified' && u.statusNote) inner.append(el('p', 'note', u.statusNote));
    if (vi.hidden) inner.append(el('p', 'hid', `Not visible when the kit is assembled (${vi.note}).`));
    const f = (v) => v.toFixed(1);
    inner.append(el('p', 'dim', AGGREGATE.test(u.label)
      ? `Group of small parts spread over about ${f(s.x)} × ${f(s.z)} mm (the bounding box of the group, not one part's footprint).`
      : `About ${f(s.x)} × ${f(s.z)} mm footprint, ${f(s.y)} mm tall (bounding box in the seated pose; heights are assumed unless stated).`));
    cardEl.append(x, inner); cardEl.hidden = false;
  }
  function select(obj) {
    sel = obj;
    if (helper) { scene.remove(helper); helper.children.forEach((h) => h.geometry.dispose()); helper = null; }
    if (obj) {
      selBox.setFromObject(obj); helper = new THREE.Group();
      // bright where the box edge is in front of the model, dim where the part is behind something
      const lit = new THREE.Box3Helper(selBox, 0x74e2f4), dim = new THREE.Box3Helper(selBox, 0x74e2f4);
      dim.material.depthTest = false; dim.material.transparent = true; dim.material.opacity = 0.3; dim.renderOrder = 9; lit.renderOrder = 10;
      helper.add(dim, lit); scene.add(helper);
    }
    showCard(obj); markList(obj); needs = true;
  }
  function closeCard() { const had = cardEl.contains(document.activeElement); select(null); if (had) canvas.focus({ preventScroll: true }); }

  // ---------- focusing a part: a view where it can be seen, inside the free part of the canvas ----------
  const sheetMQ = matchMedia('(max-width: 640px) and (min-height: 521px)'), shortMQ = matchMedia('(max-height: 520px)');
  const panelEl = $('#parts-panel');
  // the largest rectangle of the canvas not covered by the parts panel or the info card: its size as fractions of the canvas and its centre in NDC
  function freeRegion() {
    const W = stageEl.clientWidth, H = stageEl.clientHeight, s = stageEl.getBoundingClientRect(), PAD = 8;
    const boxes = [panelEl, cardEl].filter((e) => !e.hidden).map((e) => { const r = e.getBoundingClientRect(); return [r.left - s.left - PAD, r.top - s.top - PAD, r.right - s.left + PAD, r.bottom - s.top + PAD]; });
    const hit = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
    const cut = (a, b) => [[a[0], a[1], Math.min(a[2], b[0]), a[3]], [Math.max(a[0], b[2]), a[1], a[2], a[3]], [a[0], a[1], a[2], Math.min(a[3], b[1])], [a[0], Math.max(a[1], b[3]), a[2], a[3]]];
    let cands = [[0, 0, W, H]];
    for (const b of boxes) cands = cands.flatMap((c) => (hit(c, b) ? cut(c, b) : [c])).filter((c) => c[2] - c[0] > 60 && c[3] - c[1] > 60);
    if (!cands.length) cands = [[0, 0, W, H]];
    const area = (c) => (c[2] - c[0]) * (c[3] - c[1]), best = cands.reduce((a, c) => (area(c) > area(a) ? c : a));
    return { fw: (best[2] - best[0]) / W, fh: (best[3] - best[1]) / H, u: (best[0] + best[2]) / W - 1, v: 1 - (best[1] + best[3]) / H };
  }
  const CAND_EL_UP = [25, 45, 65, 85], CAND_EL_DOWN = [-25, -45];
  const angDist = (a, b) => { let d = Math.abs(a.az - b.az) % 360; if (d > 180) d = 360 - d; return Math.hypot(d, (a.el - b.el) * 0.8); };
  // pick the viewing direction (nearest to pref) from which most of the part's sample points are visible in the current pose
  function bestView(part, tgt, dist, pref) {
    kit.root.updateMatrixWorld(true); const list = occluders(), D = Math.max(dist, 60);
    const frac = (c) => visibleFraction(part, tgt.clone().addScaledVector(dirFromAzEl(c.az, c.el), D), list, 12) ?? 1;
    const f0 = frac(pref); if (f0 >= 0.35) return { ...pref, frac: f0 };
    let best = { ...pref, frac: f0 };
    for (const els of [CAND_EL_UP, CAND_EL_DOWN]) {
      const cands = []; for (const el of els) for (let k = 0; k < 12; k++) cands.push({ az: k * 30, el });
      cands.sort((a, b) => angDist(a, pref) - angDist(b, pref));
      for (const c of cands) { const f = frac(c); if (f > best.frac + 1e-6) best = { ...c, frac: f }; if (best.frac >= 0.6) break; }
      if (best.frac >= 0.35) break;
    }
    return best;
  }
  const _r = new THREE.Vector3(), _u = new THREE.Vector3();
  function planFocus(part, region, pref) {
    kit.root.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(part), c = b.getCenter(new THREE.Vector3()), sz = b.getSize(new THREE.Vector3());
    const d = THREE.MathUtils.clamp(fitDistance(Math.max(sz.x, sz.y, sz.z) * 0.9 + 6, region.fw, region.fh), controls.minDistance, controls.maxDistance);
    const best = bestView(part, c, d, pref), dir = dirFromAzEl(best.az, best.el);
    // shift the orbit target so the part lands in the middle of the free region
    _r.crossVectors(dir.clone().negate(), new THREE.Vector3(0, 1, 0)).normalize(); _u.crossVectors(_r, dir.clone().negate()).normalize();
    const th = Math.tan(camera.fov * DEG / 2) * d, tgt = c.clone().addScaledVector(_r, -region.u * th * camera.aspect).addScaledVector(_u, -region.v * th);
    return { tgt, pos: tgt.clone().addScaledVector(dir, d), frac: best.frac };
  }
  function focusOn(part) {
    setRotate(false); clearViewChips(); play = null;
    const region = freeRegion(), cur = azElOf(camera.position.clone().sub(controls.target)), pref = { az: cur.az, el: Math.max(cur.el, 33) };
    const plan = planFocus(part, region, pref);
    if (plan.frac >= 0.15) { flyTo(plan.pos, plan.tgt, 800); return; }
    if ((expAnim ? expAnim.to : kit.state.explode) < 0.95) {                 // hidden in this pose: explode the kit (animated) and look at it from where it can be seen
      const exploded = withPose({ explode: 1 }, () => planFocus(part, region, pref));
      if (exploded.frac > 0.05) { play = null; startExplode(1); flyTo(exploded.pos, exploded.tgt, 1200); return; }
    }
    flyTo(plan.pos, plan.tgt, 800);
  }

  // ---------- parts list ----------
  const GROUPS = GROUP_TITLE;
  const listBtns = new Map(), heads = {}, totals = {};
  function buildList() {
    const list = $('#part-list'); list.replaceChildren(); listBtns.clear();
    const by = { base: [], mercury: [], peri: [] };
    for (const o of kit.parts) by[boardOf(o)].push(o);
    for (const k of Object.keys(by)) {
      if (!by[k].length) continue;
      by[k].sort((a, b) => (!!b.userData.ref - !!a.userData.ref) || (a.userData.ref || '').localeCompare(b.userData.ref || '', undefined, { numeric: true }) || a.userData.label.localeCompare(b.userData.label));   // designators first
      totals[k] = by[k].length; heads[k] = el('h3', null, `${GROUPS[k]} (${by[k].length})`); list.append(heads[k]);
      for (const o of by[k]) {
        const u = o.userData, b = el('button'); b.type = 'button'; b.dataset.board = k;
        b.append(el('span', 'r', u.ref || ''), el('span', 't', cleanLabel(u)));
        b.setAttribute('aria-label', [u.ref, cleanLabel(u)].filter(Boolean).join(', '));
        b.onclick = () => choosePart(o);
        list.append(b); listBtns.set(o, b); rowText(o);
      }
    }
  }
  function rowText(o) {
    const b = listBtns.get(o), u = o.userData, note = visCache.get(o)?.hidden ? visCache.get(o).note : '';
    const t = b.querySelector('.t'); t.querySelector('.hid')?.remove();
    if (note) t.append(el('small', 'hid', note));
    b.dataset.q = `${u.ref || ''} ${u.label} ${note}`.toLowerCase();
    b.setAttribute('aria-label', [u.ref, cleanLabel(u), note].filter(Boolean).join(', '));
  }
  function markList(obj) { for (const [o, b] of listBtns) { const on = o === obj; b.classList.toggle('sel', on); if (on) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current'); } }
  const filterEl = $('#part-filter'), emptyEl = $('#part-empty');
  function applyFilter() {
    const q = filterEl.value.trim().toLowerCase(), shown = {}; let any = 0;
    for (const b of listBtns.values()) { const hide = !!q && !b.dataset.q.includes(q); b.hidden = hide; if (!hide) { shown[b.dataset.board] = (shown[b.dataset.board] || 0) + 1; any++; } }
    for (const k of Object.keys(heads)) { const n = shown[k] || 0; heads[k].hidden = n === 0; heads[k].textContent = `${GROUPS[k]} (${q ? `${n} of ${totals[k]}` : totals[k]})`; }
    emptyEl.hidden = any > 0;
  }
  function choosePart(o) {                           // a row was chosen: show its board if it is hidden, select, collapse the phone sheet, fly there
    if (!show[boardOf(o)]) setShow(boardOf(o), true);
    const inList = panelEl.contains(document.activeElement);
    select(o);
    if (sheetMQ.matches && stageEl.clientHeight >= 330) { setPeek(true); if (inList) $('#parts-peek').focus({ preventScroll: true }); }
    else if (sheetMQ.matches || shortMQ.matches) { setPanel(false); if (inList) partsBtn.focus({ preventScroll: true }); }      // no room for the list, the card and the model at once
    focusOn(o);
  }
  buildList();
  filterEl.addEventListener('input', applyFilter);
  filterEl.addEventListener('focus', () => { if (sheetMQ.matches) setPeek(false); });
  function setPeek(p) { panelEl.classList.toggle('peek', p); const b = $('#parts-peek'); b.setAttribute('aria-expanded', String(!p)); b.setAttribute('aria-label', p ? 'Expand the parts list' : 'Collapse the parts list'); }
  $('#parts-peek').addEventListener('click', () => setPeek(!panelEl.classList.contains('peek')));
  const partsBtn = $('#btn-parts');
  function setPanel(open, focus = false) {
    panelEl.hidden = !open; partsBtn.setAttribute('aria-expanded', String(open));
    if (open) { setPeek(false); if (focus) filterEl.focus({ preventScroll: true }); }
  }
  partsBtn.addEventListener('click', (e) => setPanel(panelEl.hidden, e.detail === 0));   // keyboard activation moves focus into the panel
  $('#parts-close').addEventListener('click', () => { const had = panelEl.contains(document.activeElement); setPanel(false); if (had) partsBtn.focus(); });

  // Escape: clear a filter, else close the card, else close the panel (focus returns to the Parts button)
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    if (document.activeElement === filterEl && filterEl.value) { filterEl.value = ''; applyFilter(); return; }
    if (!cardEl.hidden) { closeCard(); return; }
    if (!panelEl.hidden) { const had = panelEl.contains(document.activeElement); setPanel(false); if (had) partsBtn.focus(); }
  });

  // classify every part (assembled pose) in idle time so the list can say which ones are hidden; cached, and done on demand for a part that is selected first
  {
    const todo = [...kit.parts]; let done = 0;
    const idle = window.requestIdleCallback ? (f) => requestIdleCallback(f, { timeout: 800 }) : (f) => setTimeout(f, 30);
    const chunk = () => {
      const t0 = performance.now();
      while (todo.length && performance.now() - t0 < 14) { const p = todo.shift(); visInfo(p); rowText(p); done++; }
      if (todo.length) idle(chunk); else { window.__partsClassified = true; applyFilter(); }
    };
    idle(chunk);
  }

  // ---------- designator labels ----------
  const labelHost = $('#labels'); let labelsOn = false; const labels = [];
  for (const o of kit.parts.filter((p) => p.userData.ref)) { const d = el('div', 'tag', o.userData.ref); d.hidden = true; labelHost.append(d); labels.push({ o, d, p: new THREE.Vector3(), occluded: false }); }
  const boardTags = [['base', 'UniJack base board'], ['mercury', 'Mercury module'], ['peri', 'PeriBoard']].map(([k, text]) => {
    const d = el('div', 'tag board', text); d.hidden = true; labelHost.append(d);
    return { obj: boardObj[k], k, d, p: new THREE.Vector3() };
  });
  function refreshAnchors() {
    kit.root.updateMatrixWorld(true); const b = new THREE.Box3();
    if (labelsOn) for (const L of labels) { b.setFromObject(L.o); b.getCenter(L.p); L.p.y = b.max.y + 0.4; }
    if (kit.state.explode > 0.02) for (const T of boardTags) {
      b.setFromObject(T.obj); b.getCenter(T.p);
      if (T.k === 'base') { T.p.y = b.max.y; T.p.z = b.max.z + 7; } else T.p.y = b.max.y + 6;
    }
  }
  const occTmp = new THREE.Raycaster(), _o = new THREE.Vector3();
  // a tag is hidden while something sits between the camera and its anchor (throttled raycast), and whenever the camera is below the anchor (views from underneath)
  function updateOcclusion(now) {
    if (now - occAt < 160) return; occAt = now;
    const list = occluders(), cam = camera.position;
    for (const L of labels) {
      if (!visibleDeep(L.o)) { L.occluded = true; continue; }
      _o.copy(L.p).sub(cam); const dist = _o.length(); _o.divideScalar(dist);
      occTmp.set(cam, _o); occTmp.near = 0; occTmp.far = Math.max(0, dist - 0.3);
      L.occluded = occTmp.intersectObjects(list, false).some((h) => kit.infoFor(h.object) !== L.o);
    }
  }
  function updateLabels(now) {
    const w = stageEl.clientWidth, h = stageEl.clientHeight, v = new THREE.Vector3(), e = kit.state.explode, cy = camera.position.y;
    if (labelsOn) {
      updateOcclusion(now);
      for (const L of labels) {
        v.copy(L.p).project(camera);
        const vis = !L.occluded && cy > L.p.y && v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05;
        L.d.hidden = !vis; if (vis) L.d.style.transform = `translate(${(v.x * 0.5 + 0.5) * w}px,${(-v.y * 0.5 + 0.5) * h}px) translate(-50%,-50%)`;
      }
    }
    for (const T of boardTags) {
      v.copy(T.p).project(camera);
      const vis = e > 0.35 && visibleDeep(T.obj) && cy > T.p.y && v.z < 1;
      T.d.hidden = !vis; if (vis) { T.d.style.opacity = String(Math.min(1, (e - 0.35) / 0.4)); T.d.style.transform = `translate(${(v.x * 0.5 + 0.5) * w}px,${(-v.y * 0.5 + 0.5) * h}px) translate(-50%,-50%)`; }
    }
  }
  const labelsBtn = $('#btn-labels');
  labelsBtn.addEventListener('click', () => {
    labelsOn = !labelsOn; labelsBtn.setAttribute('aria-pressed', String(labelsOn));
    if (!labelsOn) labels.forEach((L) => { L.d.hidden = true; });
    occAt = 0; refreshAnchors(); needs = true;
  });
  if (!labels.length) labelsBtn.hidden = true;

  // ---------- WebGL context loss: say so, rebuild the environment light (its render target is lost), repaint ----------
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); $('#gl-notice').hidden = false; });
  canvas.addEventListener('webglcontextrestored', () => {
    stage.rebuildEnvironment();   // the old target is not disposed: its GL objects died with the context, and deleting them logs INVALID_OPERATION warnings
    $('#gl-notice').hidden = true; needs = true;
  });

  // ---------- quality: adaptive AO / DOF, depth of field only in the Hero preset while nothing moves ----------
  const perf = { slow: 0, dropped: false, lastRendered: 0, samples: 0 };
  let pointerActive = false;
  canvas.addEventListener('pointerdown', () => { pointerActive = true; }); window.addEventListener('pointerup', () => { pointerActive = false; needs = true; }); window.addEventListener('pointercancel', () => { pointerActive = false; needs = true; });
  function updateQuality(now, animating, camMoved) {
    if (!post) return;
    // frame time is measured only across consecutive rendered frames (the loop renders on demand), i.e. while something animates
    if (animating && perf.lastRendered) { const dt = now - perf.lastRendered; perf.samples++; if (dt > 30) perf.slow++; else perf.slow = Math.max(0, perf.slow - 1); }
    perf.lastRendered = now;
    if (!perf.dropped && QUALITY !== 'high' && perf.slow >= 20) { perf.dropped = true; post.set({ ao: false, dof: false }); console.info('unijack: slow frames, ambient occlusion and depth of field switched off'); }
    // depth of field only in the Hero preset and only while NOTHING moves: no tween, insertion or explode animation, no pointer down, no auto-rotate, no damping
    const dof = !perf.dropped && currentView === 'hero' && !tween && !pointerActive && !play && !expAnim && !controls.autoRotate && !camMoved;
    if (post.state.dof !== dof) post.set({ dof });
    if (dof) post.focusAt(center);
  }

  // ---------- loop (renders only when something changed) ----------
  let firstFrame = true;
  function loop(now) {
    requestAnimationFrame(loop); ticks++;
    const moving = stepTween(now) | stepPlay(now) | stepExplode(now);
    const camMoved = controls.update();
    camSettling = !!camMoved && !controls.autoRotate;   // damping still moving the camera counts as busy (not the endless auto-rotate); updated every tick, not only on rendered frames
    if (!(camMoved || moving || needs)) return;
    if (helper && sel) { selBox.setFromObject(sel); helper.visible = visibleDeep(sel); }
    fitShadowToKit(); updateQuality(now, !!(camMoved || moving), !!camMoved);
    if (post) post.render(); else renderer.render(scene, camera);
    updateLabels(now); needs = false; frames++;
    if (firstFrame) { firstFrame = false; const l = $('#loader'); l.classList.add('done'); setTimeout(() => { l.hidden = true; }, 500); window.__viewerReady = true; }
  }
  requestAnimationFrame(loop);
  window.__unijack = {
    kit, camera, controls, select, flyToView, explodeTo, focusOn, visInfo, THREE, frameFor, boardPoints, dirFromAzEl, VIEWS, stage, post, perf, quality: QUALITY, setEnv,
    // test hooks: busy() is true while a camera tween, the explode tween, the insertion play or camera damping is running; anim() says which;
    // frames counts rendered frames (the loop renders on demand) so a test can wait for a fresh frame instead of a fixed time; ticks counts loop
    // ticks (busy() reads camSettling, which is refreshed once per tick, so a caller that just changed the controls waits for the next tick first)
    busy: () => !!(tween || expAnim || play || camSettling),
    anim: () => ({ tween: !!tween, explode: expAnim ? { from: expAnim.from, to: expAnim.to, ms: expAnim.ms } : null, play: !!play, settling: camSettling }),
    get frames() { return frames; }, get ticks() { return ticks; },
  };
}
