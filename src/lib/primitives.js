import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { planarUV } from './frame.js';

/**
 * Attach metadata to an object. The viewer, the part inspector and the GLB export read this.
 *   ref    designator exactly as printed on the board and legible in a photo (e.g. "J303"), else omit
 *   label  short human name, e.g. "RJ45 jack"
 *   kind   'board' | 'connector' | 'ic' | 'passive' | 'cap' | 'pin' | 'latch' | 'led' | 'module' | 'other'
 *   status 'photo-derived'   footprint measured from a photo, height/shape assumed
 *          'photo-verified'  something legible in a photo (marking, designator)
 *          'assumed'         not visible in any photo (underside, heights, stack height)
 *   desc   one honest sentence; say "appears to be" where function is inferred from shape
 */
export function meta(obj, ud) {
  Object.assign(obj.userData, ud);
  if (ud.ref) obj.name = ud.ref; else if (ud.id) obj.name = ud.id; else if (ud.label && !obj.name) obj.name = ud.label;
  return obj;
}


/**
 * Collapse a box/cylinder-like geometry's face groups to ONE group per distinct material, so a part costs 1-2 draw calls instead of 3-6
 * (and a single material costs one). Geometry and appearance are unchanged. Returns the material (single) or an array (re-indexed groups).
 */
export function mergeMaterialGroups(geo, materials) {
  const uniq = []; const map = materials.map((m) => { let i = uniq.indexOf(m); if (i < 0) { uniq.push(m); i = uniq.length - 1; } return i; });
  if (uniq.length === materials.length) return materials;          // nothing to merge
  if (uniq.length === 1) { geo.clearGroups(); return uniq[0]; }
  if (!geo.index) {                                                     // non-indexed (RoundedBoxGeometry): reorder every vertex attribute by bucket
    const ranges = uniq.map(() => []);
    for (const g of geo.groups) ranges[map[g.materialIndex]].push([g.start, g.count]);
    const total = ranges.reduce((t, r) => t + r.reduce((x, [, c]) => x + c, 0), 0);
    for (const name of Object.keys(geo.attributes)) {
      const a = geo.attributes[name], sz = a.itemSize, out = new a.array.constructor(total * sz); let w = 0;
      for (const r of ranges) for (const [st, c] of r) { out.set(a.array.subarray(st * sz, (st + c) * sz), w * sz); w += c; }
      geo.setAttribute(name, new THREE.BufferAttribute(out, sz, a.normalized));
    }
    geo.clearGroups(); let start = 0;
    ranges.forEach((r, mi) => { const n = r.reduce((x, [, c]) => x + c, 0); geo.addGroup(start, n, mi); start += n; });
    return uniq;
  }
  const idx = geo.index.array, buckets = uniq.map(() => []);
  for (const g of geo.groups) { const b = buckets[map[g.materialIndex]]; for (let i = g.start; i < g.start + g.count; i++) b.push(idx[i]); }
  const flat = [].concat(...buckets);
  geo.setIndex(new THREE.BufferAttribute(new idx.constructor(flat), 1));
  geo.clearGroups(); let start = 0; buckets.forEach((b, mi) => { geo.addGroup(start, b.length, mi); start += b.length; });
  return uniq;
}
/** Small parts do not cast shadows (they cost a second draw call each and their shadows are invisible at viewing distance). */
const SHADOW_MIN_MM = 3;

// =====================================================================================================================
// Micro-geometry ("assumed" detail; see README honesty table). The photos show softly rounded housing, shell and IC edges,
// concave tinned solder fillets at every lead and header foot, and chamfered square pin tips, but no radius is measurable in
// them. All values here are typical, not measured. Costs are kept low: a bevelled box is about 50 triangles, a fillet 8-12.
// =====================================================================================================================
export const EDGE_RADIUS = 0.2;      // mm, uniform edge bevel on free-standing box parts (tall housings get 0.3)
export const EDGE_MIN_H = 2;         // mm, boxes at least this tall get the bevel automatically
export const EDGE_MIN_WD = 1.2;      // mm, and at least this wide in both plan directions
const SOFT = Math.PI / 8;            // normals of a bevel strip are turned 22.5 degrees towards each neighbour face: two soft creases read as a round

/** Default bevel size for a box of w x h x d mm (0 = sharp). Thin wide plates (sheet-metal shell tops, tabs, latch arms) get a half-round edge. */
export function autoBevel(w, h, d) {
  if (h >= EDGE_MIN_H && Math.min(w, d) >= EDGE_MIN_WD) return h >= 4 ? 0.3 : EDGE_RADIUS;
  if (h >= 0.3 && h < 1 && w >= 2 && d >= 2) return Math.min(EDGE_RADIUS, h / 2 - 1e-3);
  return 0;
}

/**
 * Triangles of a box with a chamfer `c` on selected TOP edges and on the vertical edges where two bevelled top edges meet.
 * Bevel normals are softened (22.5 degree creases) so a 0.2 mm chamfer reads as a rounded edge at viewing distance.
 * Box footprint = origin `o` [x, z] plus `u` * s + `v` * t (u, v unit plan vectors, usually [1,0] and [0,1]; rotated boxes pass their own),
 * s in [0, W], t in [0, D]; height y0..y1. edges = { pu: +u side, nu: -u side, pv: +v side, nv: -v side } (true = bevel this top edge).
 * Returns { side, top, bottom } each { pos: [], nor: [] } (non-indexed), or null when c <= 0 (caller uses a plain box).
 */
export function bevelBoxTris({ o = [0, 0], u = [1, 0], v = [0, 1], W, D, y0, y1, c, edges = {}, bottom = true, corners = true }) {
  if (!(c > 0)) return null;
  c = Math.min(c, W / 2 - 1e-3, D / 2 - 1e-3, (y1 - y0) - 1e-3);
  if (!(c > 0)) return null;
  const E = { pu: true, nu: true, pv: true, nv: true, ...edges };
  const t = { pu: E.pu ? c : 0, nu: E.nu ? c : 0, pv: E.pv ? c : 0, nv: E.nv ? c : 0 };   // top-edge bevel per side
  const k = (p, q) => (corners && E[p] && E[q] ? c : 0);                                   // vertical-edge chamfer per corner
  const K = { pp: k('pu', 'pv'), pn: k('pu', 'nv'), np: k('nu', 'pv'), nn: k('nu', 'nv') };
  const side = { pos: [], nor: [] }, top = { pos: [], nor: [] }, bot = { pos: [], nor: [] };
  const P = (s2, y, t2) => [o[0] + u[0] * s2 + v[0] * t2, y, o[1] + u[1] * s2 + v[1] * t2];
  const N = (ns, ny, nt) => { const x = u[0] * ns + v[0] * nt, z = u[1] * ns + v[1] * nt, l = Math.hypot(x, ny, z) || 1; return [x / l, ny / l, z / l]; };
  const tri = (B, a, b2, d2, na, nb, nd) => {                      // wound so the geometric normal agrees with the shading normals
    const e1 = [b2[0] - a[0], b2[1] - a[1], b2[2] - a[2]], e2 = [d2[0] - a[0], d2[1] - a[1], d2[2] - a[2]];
    const g = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const m = [na[0] + nb[0] + nd[0], na[1] + nb[1] + nd[1], na[2] + nb[2] + nd[2]];
    if (g[0] * m[0] + g[1] * m[1] + g[2] * m[2] < 0) { B.pos.push(...a, ...d2, ...b2); B.nor.push(...na, ...nd, ...nb); } else { B.pos.push(...a, ...b2, ...d2); B.nor.push(...na, ...nb, ...nd); }
  };
  const quad = (B, a, b2, d2, e, n) => { const nn = Array.isArray(n[0]) ? n : [n, n, n, n]; tri(B, a, b2, d2, nn[0], nn[1], nn[2]); tri(B, a, d2, e, nn[0], nn[2], nn[3]); };
  const cs = Math.cos(SOFT), sn = Math.sin(SOFT), yt = (tt) => y1 - tt;
  // ---- the four side faces, each lowered by its top bevel and narrowed by the corner chamfers at its two ends
  const sides = [
    { ns: 1, nt: 0, fix: W, along: 't', L: D, lo: K.pn, hi: K.pp, tt: t.pu, tStart: t.nv, tEnd: t.pv },
    { ns: -1, nt: 0, fix: 0, along: 't', L: D, lo: K.nn, hi: K.np, tt: t.nu, tStart: t.nv, tEnd: t.pv },
    { ns: 0, nt: 1, fix: D, along: 's', L: W, lo: K.np, hi: K.pp, tt: t.pv, tStart: t.nu, tEnd: t.pu },
    { ns: 0, nt: -1, fix: 0, along: 's', L: W, lo: K.nn, hi: K.pn, tt: t.nv, tStart: t.nu, tEnd: t.pu },
  ];
  for (const f of sides) {
    const n = N(f.ns, 0, f.nt);
    const at = (a, y, inset = 0) => (f.along === 't' ? P(f.fix - f.ns * inset, y, a) : P(a, y, f.fix - f.nt * inset));
    quad(side, at(f.lo, y0), at(f.L - f.hi, y0), at(f.L - f.hi, yt(f.tt)), at(f.lo, yt(f.tt)), n);
    if (f.tt > 0) {
      const nLow = N(f.ns * cs, sn, f.nt * cs), nHigh = N(f.ns * sn, cs, f.nt * sn);
      quad(side, at(f.lo, yt(f.tt)), at(f.L - f.hi, yt(f.tt)), at(f.L - f.tEnd - f.hi, y1, f.tt), at(f.tStart + f.lo, y1, f.tt), [nLow, nLow, nHigh, nHigh]);
    }
  }
  // ---- vertical corner chamfers and the parallelogram patch that joins them to the two bevel strips
  for (const [kk, ss, st] of [[K.pp, 1, 1], [K.pn, 1, -1], [K.np, -1, 1], [K.nn, -1, -1]]) {
    if (!(kk > 0)) continue;
    const S = ss > 0 ? W : 0, T = st > 0 ? D : 0, y2 = y1 - c;
    const a = P(S, y0, T - st * kk), b2 = P(S - ss * kk, y0, T), a2 = P(S, y2, T - st * kk), b3 = P(S - ss * kk, y2, T);
    const n1 = N(ss * cs, 0, st * sn), n2 = N(ss * sn, 0, st * cs);
    quad(side, a, b2, b3, a2, [n1, n2, n2, n1]);
    const tA = P(S - ss * c, y1, T - st * (c + kk)), tB = P(S - ss * (c + kk), y1, T - st * c);
    const nMid = N(ss * cs, sn, st * cs), nTop = N(ss * sn, cs, st * sn);
    quad(side, a2, b3, tB, tA, [nMid, nMid, nTop, nTop]);
  }
  // ---- top face: rectangle inset by the bevels, corners cut by the vertical chamfers (convex polygon, fan)
  const poly = [];
  poly.push(P(t.nu + K.nn, y1, t.nv)); if (K.nn) poly.push(P(t.nu, y1, t.nv + K.nn));
  poly.push(P(t.nu, y1, D - t.pv - K.np)); if (K.np) poly.push(P(t.nu + K.np, y1, D - t.pv));
  poly.push(P(W - t.pu - K.pp, y1, D - t.pv)); if (K.pp) poly.push(P(W - t.pu, y1, D - t.pv - K.pp));
  poly.push(P(W - t.pu, y1, t.nv + K.pn)); if (K.pn) poly.push(P(W - t.pu - K.pn, y1, t.nv));
  const nUp = [0, 1, 0];
  for (let i = 1; i < poly.length - 1; i++) tri(top, poly[0], poly[i], poly[i + 1], nUp, nUp, nUp);
  if (bottom) { const nD = [0, -1, 0]; quad(bot, P(0, y0, 0), P(W, y0, 0), P(W, y0, D), P(0, y0, D), nD); }
  return { side, top, bottom: bot };
}

/**
 * Which top edges of plan rectangle `i` are free, i.e. not met by a flush or taller neighbour in `list` (so a bevel there would not
 * cut a groove into a surface that is really continuous). list = [{ o, u, v, W, D, y0, y1 }] as for bevelBoxTris.
 * Each edge is sampled at five points including both ENDS (1, 25, 50, 75 and 99 percent of its length), 0.05 mm outside the edge,
 * so a thin wall that only abuts the end of an edge (a T-junction, e.g. the front wall of a shroud meeting its side walls) still
 * makes the whole edge sharp instead of leaving a 0.2 mm notch where the bevel strip would run past the junction. A neighbour that
 * also covers the matching point 0.05 mm INSIDE the edge overlaps this box (end blocks, crossing walls): the bevel strip there is
 * buried inside the neighbour's volume and hidden, so such neighbours do not count. Returns { pu, nu, pv, nv }.
 */
export function freeEdges(list, i) {
  const b = list[i];
  const inside = (q, x, z) => { const dx = x - q.o[0], dz = z - q.o[1], s = dx * q.u[0] + dz * q.u[1], t = dx * q.v[0] + dz * q.v[1]; return s >= -1e-6 && s <= q.W + 1e-6 && t >= -1e-6 && t <= q.D + 1e-6; };
  const at = (s, t) => [b.o[0] + b.u[0] * s + b.v[0] * t, b.o[1] + b.u[1] * s + b.v[1] * t];
  const FR = [0.01, 0.25, 0.5, 0.75, 0.99];
  const free = (fn) => {
    for (const a of FR) {
      const [xo, zo] = fn(a, 1), [xi, zi] = fn(a, -1);                                       // just outside / just inside the edge
      for (let j = 0; j < list.length; j++) {
        const q = list[j];
        if (j !== i && q.y1 >= b.y1 - 0.05 && q.y0 < b.y1 - 0.05 && inside(q, xo, zo) && !inside(q, xi, zi)) return false;
      }
    }
    return true;
  };
  const e = 0.05;
  return { pu: free((a, s) => at(b.W + s * e, a * b.D)), nu: free((a, s) => at(-s * e, a * b.D)), pv: free((a, s) => at(a * b.W, b.D + s * e)), nv: free((a, s) => at(a * b.W, -s * e)) };
}

/** BufferGeometry of a bevelled box centred in x/z with its base at y = 0 (same frame as BoxGeometry after translate(0, h/2, 0)).
 *  Groups follow the BoxGeometry material order: all side-material triangles at index 0, top at 2, bottom at 3. */
export function bevelBoxGeometry(w, h, d, c, edges, corners = true) {
  const t = bevelBoxTris({ o: [-w / 2, -d / 2], W: w, D: d, y0: 0, y1: h, c, edges, corners });
  if (!t) { const g = new THREE.BoxGeometry(w, h, d); g.translate(0, h / 2, 0); return g; }
  return trisToGeometry([[t.side, 0], [t.top, 2], [t.bottom, 3]]);
}

/** Non-indexed BufferGeometry from [[{pos,nor}, materialIndex], ...] buckets (UVs are zero; callers project their own). */
export function trisToGeometry(buckets) {
  const n = buckets.reduce((a, [b]) => a + b.pos.length / 3, 0);
  const P = new Float32Array(n * 3), Nn = new Float32Array(n * 3), U = new Float32Array(n * 2);
  const geo = new THREE.BufferGeometry(); let w = 0;
  for (const [b, mi] of buckets) { const k = b.pos.length / 3; if (!k) continue; P.set(b.pos, w * 3); Nn.set(b.nor, w * 3); geo.addGroup(w, k, mi); w += k; }
  geo.setAttribute('position', new THREE.BufferAttribute(P, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(Nn, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(U, 2));
  return geo;
}

/**
 * Concave (meniscus) solder fillet: a prism along z. Local frame: x = 0 is the lead's tip face (height H there), the surface sinks
 * concavely to the pad at x = L; width W centred on z = 0; y = 0 is the pad. Only the visible cove and the two end caps are emitted.
 * Fillets longer than 0.25 mm get three profile segments (two read as an angular wedge in macro close-ups); keep W at most about
 * 1.1 x the lead width, and place the fillet INSIDE the photo-traced lead extent (shorten the foot by L), never beyond the tip.
 */
export function filletTris(L, H, W, seg = L > 0.25 ? 3 : 2) {
  const prof = [];                                                      // from the top of the lead face down to the pad
  for (let i = 0; i <= seg; i++) { const th = Math.PI + (Math.PI / 2) * (i / seg); prof.push([L + L * Math.cos(th), H + H * Math.sin(th), -Math.cos(th) / L, -Math.sin(th) / H]); }
  const out = { pos: [], nor: [] }, hw = W / 2;
  const nrm = (a, b) => { const l = Math.hypot(a, b) || 1; return [a / l, b / l, 0]; };
  const tri = (a, b, c, na, nb, nc) => {                               // wound so the geometric normal agrees with the shading normals
    const g = [(b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])];
    const m = [na[0] + nb[0] + nc[0], na[1] + nb[1] + nc[1], na[2] + nb[2] + nc[2]];
    if (g[0] * m[0] + g[1] * m[1] + g[2] * m[2] < 0) { out.pos.push(...a, ...c, ...b); out.nor.push(...na, ...nc, ...nb); } else { out.pos.push(...a, ...b, ...c); out.nor.push(...na, ...nb, ...nc); }
  };
  for (let i = 0; i < seg; i++) {
    const [x0, y0, a0, b0] = prof[i], [x1, y1, a1, b1] = prof[i + 1], n0 = nrm(a0, b0), n1 = nrm(a1, b1);
    tri([x0, y0, hw], [x1, y1, hw], [x1, y1, -hw], n0, n1, n1); tri([x0, y0, hw], [x1, y1, -hw], [x0, y0, -hw], n0, n1, n0);
  }
  for (const s of [1, -1]) {                                            // end caps (fan from the inner corner), flat normals
    const n = [0, 0, s];
    for (let i = 0; i < seg; i++) { const [x0, y0] = prof[i], [x1, y1] = prof[i + 1]; tri([0, 0, s * hw], [x0, y0, s * hw], [x1, y1, s * hw], n, n, n); }
  }
  return out;
}
/** Rotate about y by ry and translate a {pos,nor} bucket, in place. ry = 0 keeps local +x; -PI/2 turns local +x to +z. */
export function placeTris(t, [tx, ty, tz], ry = 0) {
  const c = Math.cos(ry), s = Math.sin(ry);
  for (let i = 0; i < t.pos.length; i += 3) {
    const x = t.pos[i], z = t.pos[i + 2]; t.pos[i] = tx + c * x + s * z; t.pos[i + 1] += ty; t.pos[i + 2] = tz - s * x + c * z;
    const nx = t.nor[i], nz = t.nor[i + 2]; t.nor[i] = c * nx + s * nz; t.nor[i + 2] = -s * nx + c * nz;
  }
  return t;
}
export function appendTris(dst, src) { for (let i = 0; i < src.pos.length; i++) { dst.pos.push(src.pos[i]); dst.nor.push(src.nor[i]); } return dst; }

/**
 * Unit flat foot for instanced lead feet / tails: a box PLUS a concave toe fillet on its +x end, together spanning exactly
 * -0.5..0.5 in x (the fillet takes the last `frac` of the length, full foot height, 1.1 x the foot width), so an instance scaled to
 * [length, thickness, width] keeps the photo-traced tip where it was. Pick `frac` with footFrac(length) so the fillet is at most
 * 0.3 mm long (and at most 40 percent of a short foot); geometries are cached per frac. UNIT_FOOT is the 30 percent default.
 */
const FOOT_CACHE = new Map();
export function footGeometry(frac = 0.3, W = 1.1) {
  frac = Math.min(0.5, Math.max(0.02, +frac.toFixed(3)));
  const key = `${frac}|${W}`;
  if (FOOT_CACHE.has(key)) return FOOT_CACHE.get(key);
  const box = new THREE.BoxGeometry(1 - frac, 1, 1).toNonIndexed(); box.translate(-frac / 2, 0, 0);
  const b = { pos: Array.from(box.attributes.position.array), nor: Array.from(box.attributes.normal.array) };
  appendTris(b, placeTris(filletTris(frac, 1, W, 3), [0.5 - frac, -0.5, 0]));
  const g = trisToGeometry([[b, 0]]);
  FOOT_CACHE.set(key, g);
  return g;
}
/** Fillet fraction for a foot `len` mm long: min(0.3 mm, 0.4 x len) of its length. */
export const footFrac = (len) => Math.min(0.3, 0.4 * len) / Math.max(len, 1e-3);
export const UNIT_FOOT = footGeometry(0.3);
/** Unit square pin (-0.5..0.5) whose top 15 percent tapers to 55 percent width: the chamfered tip of a machined/stamped header pin. */
export const UNIT_PIN = (() => {
  const t = { pos: [], nor: [] }, yb = 0.35, k = 0.275;
  const tri = (a, b, c, n) => {
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const g = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    if (g[0] * n[0] + g[1] * n[1] + g[2] * n[2] < 0) t.pos.push(...a, ...c, ...b); else t.pos.push(...a, ...b, ...c);
    t.nor.push(...n, ...n, ...n);
  };
  const quad = (a, b, c, d, n) => { tri(a, b, c, n); tri(a, c, d, n); };
  for (const [sx, sz] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
    const pt = (a, y, w) => [sx ? sx * w : a * 2 * w, y, sz ? sz * w : a * 2 * w];     // a in -0.5..0.5 along the face, w = half width
    quad(pt(-0.5, -0.5, 0.5), pt(0.5, -0.5, 0.5), pt(0.5, yb, 0.5), pt(-0.5, yb, 0.5), [sx, 0, sz]);
    const l = Math.hypot(0.15, 0.225);
    quad(pt(-0.5, yb, 0.5), pt(0.5, yb, 0.5), pt(0.5, 0.5, k), pt(-0.5, 0.5, k), [sx * 0.15 / l, 0.225 / l, sz * 0.15 / l]);
  }
  quad([-k, 0.5, -k], [-k, 0.5, k], [k, 0.5, k], [k, 0.5, -k], [0, 1, 0]);
  quad([-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5], [-0.5, -0.5, 0.5], [0, -1, 0]);
  return trisToGeometry([[t, 0]]);
})();

/**
 * Extruded box component sitting on y = y0 (default: the board top, y = 0).
 * size = [w (x), h (height, y), d (z)] in mm; pos = [cx, y0, cz] (board-local).
 * `top` may be a photo material (then the top face is planar-projected from the photo).
 * Material order follows BoxGeometry: +x, -x, +y(top), -y, +z, -z.
 * Edges: `radius` >= 0.25 gives a true rounded box; a smaller explicit radius, or none at all on a part taller than EDGE_MIN_H
 * (see autoBevel), gives a cheap soft-normal bevel. `sharp: true` keeps a plain box (for pieces that abut others flush);
 * `edges: { px, nx, pz, nz }` switches single top edges off (where this box meets another at the same height); `bevel: c` forces a size.
 */
export function boxPart(parent, { frame, size: [w, h, d], pos: [cx, y0 = 0, cz], rotY = 0, radius = 0, bevel, edges, sharp = false, top, side, bottom, name, ud }) {
  let geo;
  if (radius >= 0.25) {
    geo = new RoundedBoxGeometry(w, h, d, 2, Math.min(radius, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3));
    geo.translate(0, h / 2, 0);
  } else {
    const c = sharp ? 0 : (bevel ?? (radius > 0 ? radius : autoBevel(w, h, d)));
    const E = edges ? { pu: edges.px ?? true, nu: edges.nx ?? true, pv: edges.pz ?? true, nv: edges.nz ?? true } : undefined;
    geo = bevelBoxGeometry(w, h, d, c, E, h >= 1);   // thin plates (shell tops) sit on sharp-cornered walls: round their top edges only
  }
  const m = new THREE.Mesh(geo, mergeMaterialGroups(geo, [side, side, top || side, bottom || side, side, side]));
  m.position.set(cx, y0, cz); m.rotation.y = rotY;
  // parts hanging from the BACK of a board: pass a photo `bottom` material (back photo) and they get mirrored-x bottom UVs
  if (((top && top.map) || (bottom && bottom.map)) && frame) planarUV(geo, frame, [cx, y0, cz], rotY, { mirrorBottom: !!(bottom && bottom.map) });
  if (name) m.name = name;
  if (ud) Object.assign(m.userData, ud);
  m.castShadow = Math.max(w, h, d) >= SHADOW_MIN_MM; m.receiveShadow = true;
  parent.add(m);
  return m;
}

/** Upright cylinder (capacitor can, screw head, standoff). Material order: side, top cap, bottom cap. */
export function cylPart(parent, { frame, r, rTop = r, h, pos: [cx, y0 = 0, cz], top, side, bottom, segments = 32, name, ud }) {
  const geo = new THREE.CylinderGeometry(rTop, r, h, segments);     // rTop < r gives a chamfered rim (capacitor can tops)
  geo.translate(0, h / 2, 0);
  const m = new THREE.Mesh(geo, mergeMaterialGroups(geo, [side, top || side, bottom || side]));
  m.position.set(cx, y0, cz);
  if (((top && top.map) || (bottom && bottom.map)) && frame) planarUV(geo, frame, [cx, y0, cz], 0, { mirrorBottom: !!(bottom && bottom.map) });
  if (name) m.name = name;
  if (ud) Object.assign(m.userData, ud);
  m.castShadow = Math.max(2 * r, h) >= SHADOW_MIN_MM; m.receiveShadow = true;
  parent.add(m);
  return m;
}

/**
 * Many identical-geometry things (IC leads, header pins, SMD pads) as one draw call.
 * items: [{ p:[x,y,z], s:[sx,sy,sz], ry?:radians }] - `geometry` is a unit-size geometry that is scaled per item.
 */
export function instanced(parent, geometry, material, items, name) {
  const im = new THREE.InstancedMesh(geometry, material, items.length);
  const o = new THREE.Object3D();
  items.forEach((it, i) => {
    o.position.set(...it.p); o.scale.set(...it.s); o.rotation.set(0, it.ry || 0, 0); o.updateMatrix();
    im.setMatrixAt(i, o.matrix);
  });
  im.instanceMatrix.needsUpdate = true;
  im.castShadow = false; im.receiveShadow = true;   // leads, pins and pads are too small to cast a visible shadow
  if (name) im.name = name;
  parent.add(im);
  return im;
}
export const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);

/**
 * Gull-wing leads around a rectangular IC body (TSSOP, SOIC, QFP...): ONE instanced draw call per part. Each lead is a real
 * gull-wing (flat shoulder out of the body, sloped knee, flat foot) with a concave tinned toe fillet and heel fillet (assumed
 * detail: the photos show bright reflowed solder at every foot but no fillet is measurable).
 * sides: 'x' -> leads leave the body along +/-x, spaced along z;  'z' -> leave along +/-z, spaced along x.
 * Either n + pitch (centred) or `positions` (offsets across the body) and `sideList` ([-1, 1] default) select the leads.
 */
export function gullLeads(parent, mat, { cx, cz, bodyW, bodyD, sides = 'x', n, pitch, positions, sideList = [-1, 1], leadLen = 0.9, leadW = 0.22, leadT = 0.15, yMid = 0.45, fillet = true, name = 'leads' }) {
  const offs = positions || Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * pitch);
  const gap = positions ? Math.min(...offs.map((a, i) => Math.min(...offs.filter((_, j) => j !== i).map((b) => Math.abs(a - b)))).filter(Number.isFinite), 10) : pitch;
  const geo = leadGeometry({ leadLen, leadW, leadT, yMid, fillet, filletW: Math.min(1.1 * leadW, (gap || leadW * 2) * 0.8) });
  const ext = sides === 'x' ? bodyW / 2 : bodyD / 2;
  const items = [];
  for (const side of sideList) for (const off of offs) {
    if (sides === 'x') items.push({ p: [cx + side * ext, 0, cz + off], s: [1, 1, 1], ry: side > 0 ? 0 : Math.PI });
    else items.push({ p: [cx + off, 0, cz + side * ext], s: [1, 1, 1], ry: side > 0 ? -Math.PI / 2 : Math.PI / 2 });
  }
  return instanced(parent, geo, mat, items, name);
}
/** One gull-wing lead leaving a body face at x = 0 towards +x (y = 0 is the board). Shoulder top at yMid, foot from about 0.62 L to L.
 *  The toe fillet sits INSIDE the lead extent (the foot box ends at L - fl and the fillet completes it to L), so x spans -0.05..L exactly. */
export function leadGeometry({ leadLen: L, leadW: w, leadT: t, yMid, fillet = true, filletW = 1.1 * w }) {
  const b = { pos: [], nor: [] };
  const box = (x0, x1, y0, y1) => { const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, w).toNonIndexed(); g.translate((x0 + x1) / 2, (y0 + y1) / 2, 0); appendTris(b, { pos: Array.from(g.attributes.position.array), nor: Array.from(g.attributes.normal.array) }); };
  const xK0 = 0.3 * L, xK1 = Math.max(0.62 * L, xK0 + t), yTop = yMid, yBot = t;    // knee from (xK0, shoulder) down to (xK1, foot)
  const fl = fillet ? Math.min(0.3, 0.3 * L) : 0, fh = Math.min(1.6 * t, yMid * 0.6);
  box(-0.05, xK0 + t * 0.3, yTop - t, yTop);                                        // shoulder (tucked 0.05 into the body)
  box(xK1 - t * 0.3, L - fl, 0, yBot);                                              // foot (the toe fillet completes it to L)
  {                                                                                  // sloped knee: a box rotated about z
    const dx = xK1 - xK0, dy = (yTop - t / 2) - (yBot / 2), len = Math.hypot(dx, dy);
    const g = new THREE.BoxGeometry(len, t, w).toNonIndexed(); g.rotateZ(-Math.atan2(dy, dx)); g.translate((xK0 + xK1) / 2, ((yTop - t / 2) + yBot / 2) / 2, 0);
    appendTris(b, { pos: Array.from(g.attributes.position.array), nor: Array.from(g.attributes.normal.array) });
  }
  if (fillet) {
    appendTris(b, placeTris(filletTris(fl, fh, filletW), [L - fl, 0, 0]));                        // toe, inside the traced extent
    appendTris(b, placeTris(filletTris(fl * 0.7, fh * 0.8, filletW), [xK1 - t * 0.3, 0, 0], Math.PI));   // heel, back under the knee
  }
  return trisToGeometry([[b, 0]]);
}

/** The PCB itself: a slab whose top face shows the photo (top surface at y = 0, body below). */
export function boardSlab(parent, { frame, topTex, bottomTex = null, mats, thickness = 1.6, radius = 0.8, name = 'pcb', box = null }) {
  // `box` = [x0,y0,x1,y1] texture pixels of the real board inside the texture (crops carry a little white margin).
  // The slab covers only that area; the texture and every pixel coordinate stay unchanged.
  const b = box ? frame.box(box) : { cx: 0, cz: 0, w: frame.W, d: frame.D };
  const top = mats.photoTop(topTex);
  const bottom = bottomTex ? mats.photoTop(bottomTex) : mats.maskBottom;
  const geo = new RoundedBoxGeometry(b.w, thickness, b.d, 3, radius);
  geo.translate(0, -thickness / 2, 0);
  planarUV(geo, frame, [b.cx, 0, b.cz], 0, { mirrorBottom: !!bottomTex });
  const m = new THREE.Mesh(geo, mergeMaterialGroups(geo, [mats.fr4Edge, mats.fr4Edge, top, bottom, mats.fr4Edge, mats.fr4Edge]));
  m.position.set(b.cx, 0, b.cz);
  m.name = name; m.receiveShadow = true; m.castShadow = true;
  m.userData = { kind: 'board', label: 'PCB', status: 'photo-derived', desc: 'Outline and size derived from photos; 1.6 mm thickness is assumed.' };
  parent.add(m);
  return m;
}

/** Rounded-rectangle outline as [x,z] points (mm, board-local, centred on the origin). Builders can splice notches into it. */
export function roundedRectOutline(W, D, r = 0.8, seg = 6) {
  const pts = [], hw = W / 2, hd = D / 2;
  const corner = (cx, cz, a0) => { for (let i = 0; i <= seg; i++) { const a = a0 + (i / seg) * Math.PI / 2; pts.push([cx + r * Math.cos(a), cz + r * Math.sin(a)]); } };
  corner(hw - r, hd - r, 0); corner(-hw + r, hd - r, Math.PI / 2); corner(-hw + r, -hd + r, Math.PI); corner(hw - r, -hd + r, 1.5 * Math.PI);
  return pts;
}

/**
 * PCB from an arbitrary outline (notches, cut-outs) with round holes. Top surface at y = 0, body below.
 * outline: [[x,z],...] mm board-local, any winding;  holes: [{x, z, r}] mm.
 * Material slots: top photo, bottom (photo of the back if bottomTex, else plain), edge. The bottom photo is mirrored
 * in x (a back-side photo is viewed from below). Top/bottom get planar-projected UVs from `frame`.
 */
export function shapeBoard(parent, { frame, outline, holes = [], topTex, bottomTex = null, mats, thickness = 1.6, name = 'pcb', curveSegments = 12 }) {
  const shape = new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x, -z)));
  for (const h of holes) { const p = new THREE.Path(); p.absarc(h.x, -h.z, h.r, 0, Math.PI * 2, true); shape.holes.push(p); }
  let geo = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments });
  geo.rotateX(-Math.PI / 2); geo.translate(0, -thickness, 0);
  geo.computeVertexNormals();
  // regroup triangles: 0 = top caps, 1 = bottom caps, 2 = edges (ExtrudeGeometry puts both caps in one group)
  const pos = geo.attributes.position, nor = geo.attributes.normal, nTri = pos.count / 3, buckets = [[], [], []];
  for (let t = 0; t < nTri; t++) { const ny = nor.getY(t * 3); buckets[ny > 0.9 ? 0 : ny < -0.9 ? 1 : 2].push(t); }
  const P = new Float32Array(pos.count * 3), N = new Float32Array(pos.count * 3);
  let w = 0; const groups = [];
  buckets.forEach((b, mi) => {
    const start = w;
    for (const t of b) for (let v = 0; v < 3; v++) { const i = t * 3 + v; P.set([pos.getX(i), pos.getY(i), pos.getZ(i)], w * 3); N.set([nor.getX(i), nor.getY(i), nor.getZ(i)], w * 3); w++; }
    if (w > start) groups.push({ start, count: w - start, mi });
  });
  geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(P, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  groups.forEach((g) => geo.addGroup(g.start, g.count, g.mi));
  planarUV(geo, frame, [0, 0, 0], 0, { mirrorBottom: !!bottomTex });
  const top = mats.photoTop(topTex);
  const bottom = bottomTex ? mats.photoTop(bottomTex) : mats.maskBottom;
  const m = new THREE.Mesh(geo, [top, bottom, mats.fr4Edge]);
  m.name = name; m.castShadow = m.receiveShadow = true;
  m.userData = { kind: 'board', label: 'PCB', status: 'photo-derived', desc: 'Outline and size derived from photos; thickness is assumed.' };
  parent.add(m);
  return m;
}
