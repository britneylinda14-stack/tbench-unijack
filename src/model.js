import * as THREE from 'three';
import { makeContext } from './lib/context.js';
import * as baseMod from './parts/base.js';
import * as periMod from './parts/peri.js';
import * as mercuryMod from './parts/mercury.js';

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const ease = (t) => t * t * (3 - 2 * t);

// ILLUSTRATIVE motion constants. The real insertion angle and slide distance are NOT known
// (take them from Jens's insertion video). SO-DIMM style: enter at an angle, then press down.
const INSERT_ANGLE = THREE.MathUtils.degToRad(28);
const SLIDE = 22;            // mm along the tilted axis at the fully separated pose
// Exploded view: separate along the mating axis (straight up) so it is obvious what mates with what.
const EXPLODE_MERCURY_Y = 46, EXPLODE_PERI_Y = 30, EXPLODE_PERI_X = 0;

/**
 * Builds the whole kit from the three part modules and returns a small control API.
 * Frame: board-local axes everywhere (+x right in photo, +z down in photo, +y up); the base board sits at the origin.
 *
 * rectify (default true): the part builders modelled each board in a uniform px-per-mm space; the boards' true per-axis scales
 * were measured later from standard-pitch features (data/scale.json axis_px_per_mm, tools/pitch-check.py). Rectifying scales each
 * board group in x and z by model/true, which is exactly the same as rectifying its photo. Heights (y) are unaffected.
 * QA footprint overlays need rectify = false, because they compare against the unrectified textures.
 */
export async function createUniJack({ baseUrl, rectify = true } = {}) {
  const ctx = await makeContext(baseUrl);
  const [base, peri, mercury] = await Promise.all([baseMod, periMod, mercuryMod].map(async (m) => m.build(ctx)));   // builders may be async

  const root = new THREE.Group(); root.name = 'UniJack-kit';
  const merPivot = new THREE.Group(); merPivot.name = 'mercury-pivot';   // origin = module FINGERS edge, top surface
  const periRig = new THREE.Group(); periRig.name = 'peri-rig';
  root.add(base, merPivot, periRig);
  merPivot.add(mercury); mercury.position.set(ctx.dims.mercury[0] / 2, 0, 0);
  periRig.add(peri);

  // ---- rectification by measured per-axis scale ----
  const fac = (k) => {
    const ax = ctx.scale.axis_px_per_mm?.[k], mp = ctx.scale.model_px_per_mm?.[k];
    return rectify && ax && mp ? { x: mp / ax.x, z: mp / ax.z } : { x: 1, z: 1 };
  };
  const rb = fac('base'), rp = fac('peri'), rm = fac('mercury');
  base.scale.set(rb.x, 1, rb.z); peri.scale.set(rp.x, 1, rp.z); mercury.scale.set(rm.x, 1, rm.z);
  mercury.position.x = (ctx.dims.mercury[0] / 2);

  // ---- unique, board-prefixed names (GLB nodes, parts list); the printed designator stays in userData.ref ----
  const prefix = (board, label) => board.traverse((o) => {
    if (o.userData?.ref && o.userData.kind !== 'board') o.name = `${label}/${o.userData.ref}`;
  });
  prefix(base, 'base'); prefix(peri, 'peri'); prefix(mercury, 'mercury');
  // one rule for the status tag: a part whose designator or quoted marking is legible in a photo is 'photo-verified'
  // (the LABEL is verified; the footprint is photo-derived and the height is assumed - the card says so)
  const tag = (board) => board.traverse((o) => {
    const u = o.userData; if (!u?.label || u.kind === 'board') return;
    if (u.ref && u.status !== 'photo-verified' && u.status !== 'assumed') u.status = 'photo-verified';
    if (u.status === 'photo-verified') u.statusNote = 'The designator or marking is legible in a photo. The footprint is photo-derived and the height is assumed.';
  });
  tag(base); tag(peri); tag(mercury);

  // ---- anchors from the base builders are in base-local (unrectified) mm: convert to world ----
  const A = base.userData.anchors || {};
  const sock0 = { x: -37, z: -2.5, seatY: 3.5, ...(A.socket || {}) };
  const sock = { x: sock0.x * rb.x, z: sock0.z * rb.z, seatY: sock0.seatY };
  const mount0 = { x: 58.5, z: 0, y: 9.6, ...(A.periMount || {}) };
  const mount = { x: mount0.x * rb.x, z: mount0.z * rb.z, y: mount0.y };   // y = height of the PeriBoard TOP surface above the base top surface

  // ---- place the PeriBoard by fitting its three mating connectors to the base's: also an independent scale check ----
  let mate = { method: 'anchor', pairs: [] };
  if (rectify) {
    periRig.position.set(0, 0, 0); root.updateMatrixWorld(true);
    const find = (r, pred) => { let f = null; r.traverse((o) => { if (!f && pred(o)) f = o; }); return f; };
    const byRef = (r, ref) => find(r, (o) => o.userData?.ref === ref);
    const pairs = [
      ['top edge', find(base, (o) => /top edge/i.test(o.userData?.label || '') && /connector/i.test(o.userData.label)), byRef(peri, 'J201')],
      ['J301', byRef(base, 'J301'), byRef(peri, 'J301')],
      ['J302 / J101', byRef(base, 'J302'), byRef(peri, 'J101')],
    ].filter((p) => p[1] && p[2]);
    if (pairs.length >= 2) {
      const cen = (o) => new THREE.Box3().setFromObject(o);
      const rows = pairs.map(([name, b, p]) => { const bb = cen(b), pb = cen(p); return { name, dx: (bb.min.x + bb.max.x) / 2 - (pb.min.x + pb.max.x) / 2, dz: (bb.min.z + bb.max.z) / 2 - (pb.min.z + pb.max.z) / 2,
        baseLen: [bb.max.x - bb.min.x, bb.max.z - bb.min.z], periLen: [pb.max.x - pb.min.x, pb.max.z - pb.min.z] }; });
      mount.x = rows.reduce((s, r) => s + r.dx, 0) / rows.length; mount.z = rows.reduce((s, r) => s + r.dz, 0) / rows.length;
      mate = { method: 'connectors', mount: [mount.x, mount.z], pairs: rows.map((r) => ({ name: r.name, residual_mm: [+(r.dx - mount.x).toFixed(2), +(r.dz - mount.z).toFixed(2)], baseLen_mm: r.baseLen.map((v) => +v.toFixed(1)), periLen_mm: r.periLen.map((v) => +v.toFixed(1)) })) };
    }
  }

  const merT = mercury.userData.anchors?.thickness ?? 1.2;
  const latches = (base.userData.latches || []).map((l) => {
    l.obj.userData._q0 = l.obj.quaternion.clone();
    return { ...l, axis: new THREE.Vector3(...l.axis).normalize() };
  });
  // the cosmetic texture patch that hides the closed-latch pixels baked into the photo is shown ONLY while the latches are open
  const patches = []; base.traverse((o) => { if (/latch-ghost-cover/.test(o.name) || /texture patch/i.test(o.userData?.label || '')) patches.push(o); });

  // dashed guide lines from each board's seated position to where it is now (visible while exploded / not seated)
  const guideGeo = new THREE.BufferGeometry();
  guideGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(8 * 2 * 3), 3));
  const guideMat = new THREE.LineDashedMaterial({ color: 0x74e2f4, dashSize: 1.8, gapSize: 1.4, transparent: true, opacity: 0, depthWrite: false });
  const guides = new THREE.LineSegments(guideGeo, guideMat);
  guides.name = 'explode-guides'; guides.frustumCulled = false; guides.visible = false; guides.renderOrder = 5;
  root.add(guides);
  const [mW, mL] = ctx.dims.mercury, [pW, pD] = ctx.dims.peri;
  const tmp = new THREE.Vector3();
  function updateGuides(e) {
    const a = guideGeo.attributes.position; let n = 0;
    const put = (v) => { a.setXYZ(n++, v.x, v.y, v.z); };
    root.updateMatrixWorld(true);
    const wantM = merPivot.visible, wantP = periRig.visible;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {           // Mercury underside corners
      put(tmp.set(sock.x + mW / 2 + sx * mW / 2, sock.seatY, sock.z + sz * mL / 2));
      if (wantM) put(mercury.localToWorld(tmp.set(sx * mW / 2, -merT, sz * mL / 2))); else put(tmp);
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {           // PeriBoard underside corners
      put(tmp.set(mount.x + sx * pW / 2, mount.y - ctx.BOARD_T, mount.z + sz * pD / 2));
      if (wantP) put(peri.localToWorld(tmp.set(sx * pW / 2, -ctx.BOARD_T, sz * pD / 2))); else put(tmp);
    }
    a.needsUpdate = true; guideGeo.computeBoundingSphere(); guides.computeLineDistances();
    guides.visible = e > 0.02 || state.insertion < 0.98; guideMat.opacity = 0.8 * Math.max(e, state.insertion < 0.98 ? 0.6 : 0);
  }

  const state = { insertion: 1, explode: 0 };
  const q = new THREE.Quaternion();
  function apply() {
    const ins = state.insertion, e = ease(state.explode);
    const a = clamp01(ins / 0.62), b = clamp01((ins - 0.62) / 0.38);
    const theta = INSERT_ANGLE * (1 - ease(b));
    const s = SLIDE * (1 - ease(a));
    const x0 = sock.x, y0 = sock.seatY + merT;
    merPivot.position.set(x0 + s * Math.cos(INSERT_ANGLE), y0 + s * Math.sin(INSERT_ANGLE) * (1 - ease(b)) + e * EXPLODE_MERCURY_Y, sock.z);
    if (b > 0) merPivot.position.set(x0, y0 + e * EXPLODE_MERCURY_Y, sock.z);   // rotate-down phase pivots in place
    merPivot.rotation.set(0, 0, theta);
    periRig.position.set(mount.x + e * EXPLODE_PERI_X, mount.y + e * EXPLODE_PERI_Y, mount.z);
    const closed = ease(clamp01((ins - 0.82) / 0.18)) * (1 - e);   // latches click shut at the very end, and spring open when the module is lifted out
    for (const l of latches) {
      q.setFromAxisAngle(l.axis, l.openAngle * (1 - closed));
      l.obj.quaternion.copy(l.obj.userData._q0).multiply(q);
    }
    for (const p of patches) p.visible = closed < 0.5;           // real photo pixels when closed; cosmetic patch only while open
    updateGuides(e);
  }
  apply();

  const parts = [];
  root.traverse((o) => { if (o.userData?.label && o.userData.kind !== 'board' && !/texture patch/i.test(o.userData.label)) parts.push(o); });

  return {
    root, base, peri, mercury, merPivot, periRig, ctx, parts, mate, rectify, patches,
    state,
    setInsertion(t) { state.insertion = clamp01(t); apply(); },
    setExplode(t) { state.explode = clamp01(t); apply(); },
    setVisible({ base: b = true, peri: p = true, mercury: m = true } = {}) { base.visible = b; periRig.visible = p; merPivot.visible = m; updateGuides(ease(state.explode)); },
    /** climb from a picked mesh to the nearest object that carries a label */
    infoFor(obj) { while (obj) { if (obj.userData?.label && obj.userData.kind !== 'board') return obj; obj = obj.parent; } return null; },
  };
}
