// Helpers for the base-right builder. All inputs are TEXTURE PIXELS of base-top.webp (converted with ctx.frames.base),
// all heights are millimetres above the board top surface (y = 0).
//
//   pxBoxPart    one extruded photo-topped box from a pixel bbox
//   mergedBoxes  many photo-topped boxes of different heights merged into ONE mesh (one draw call)
//   leadBoxes / leadRow  gull-wing lead rows (shoulder + riser + foot per lead) as photo-topped merged boxes:
//                the lead TOPS show the real photo (so the top-down view equals the photo), the sides are metal
//   flatPads     thin flat pads / terminations (merged, photo-topped)
//   pinSet       vertical pins / contacts with chamfered tips (instanced, solid colour)
//   ballGrid     instanced solder balls
//   uniqueNames  give every generic sub-node (body, pins, leads, ...) a name that is unique on the board (GLB node names, parts list)

/** A single extruded box from a pixel bbox (wrapper around prim.boxPart). */
export function pxBoxPart(ctx, parent, b, h, { y0 = 0, top, side, radius = 0, name, ...rest } = {}) {
  const f = ctx.frames.base, bx = f.box(b);
  return ctx.prim.boxPart(parent, { frame: f, size: [bx.w, h, bx.d], pos: [bx.cx, y0, bx.cz], top, side, radius, name, ...rest });   // rest: sharp, edges, bevel
}

/**
 * Many boxes of different heights merged into one mesh. Materials: [side, top]. Top faces get the planar photo UV
 * (same mapping as prim.boxPart), side faces carry the same UVs (the side material has no map, so they are ignored).
 * list = [{ b:[x0,y0,x1,y1] (px), h (mm), y0? (mm, default 0), sharp?, bevel? }]  or  [{ fillet: { x, z (px), dir: '+x'|'-x'|'+y'|'-y' (texture axes), L, H (mm), W (px) } }]
 * Boxes at least EDGE_MIN_H tall get a soft bevel on every top edge that no flush or taller box of the same list meets
 * (prim.freeEdges), so a housing assembled from several boxes keeps a continuous top. Fillets are concave tinned coves (side material).
 */
export function mergedBoxes(ctx, parent, list, { top, side, name = 'merged' }) {
  const { THREE, frames, prim } = ctx, f = frames.base;
  const P = [], N = [], U = [], Is = [], It = [];
  let v = 0;
  const uv = (x, z) => [(x + f.W / 2) / f.W, 1 - (z + f.D / 2) / f.D];
  const quad = (pts, n, idx) => {
    const b0 = v;
    for (const p of pts) { P.push(p[0], p[1], p[2]); N.push(n[0], n[1], n[2]); U.push(...uv(p[0], p[2])); v++; }
    idx.push(b0, b0 + 1, b0 + 2, b0, b0 + 2, b0 + 3);
  };
  const tris = (t, idx) => { for (let i = 0; i < t.pos.length; i += 3) { P.push(t.pos[i], t.pos[i + 1], t.pos[i + 2]); N.push(t.nor[i], t.nor[i + 1], t.nor[i + 2]); U.push(...uv(t.pos[i], t.pos[i + 2])); idx.push(v++); } };
  const rects = list.map((it) => { if (it.fillet) return null; const b = f.box(it.b); return { o: [b.cx - b.w / 2, b.cz - b.d / 2], u: [1, 0], v: [0, 1], W: b.w, D: b.d, y0: it.y0 || 0, y1: (it.y0 || 0) + it.h }; });
  const rectList = rects.filter(Boolean);
  list.forEach((it, i) => {
    if (it.fillet) {
      const F = it.fillet, ry = { '+x': 0, '-x': Math.PI, '+y': -Math.PI / 2, '-y': Math.PI / 2 }[F.dir] ?? 0;
      tris(prim.placeTris(prim.filletTris(F.L, F.H, f.len(F.W)), [f.x(F.x), F.y0 || 0, f.z(F.z)], ry), Is);   // 3 profile segments above 0.25 mm
      return;
    }
    const r = rects[i], x0 = r.o[0], x1 = x0 + r.W, z0 = r.o[1], z1 = z0 + r.D, y0 = r.y0, y1 = r.y1;
    const c = it.sharp ? 0 : (it.bevel ?? prim.autoBevel(r.W, it.h, r.D));
    const bt = c > 0 ? prim.bevelBoxTris({ ...r, c, edges: it.edges || prim.freeEdges(rectList, rectList.indexOf(r)), bottom: y0 > 0.02 }) : null;
    if (bt) { tris(bt.side, Is); tris(bt.bottom, Is); tris(bt.top, It); return; }
    quad([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [0, 1, 0], It);
    quad([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1], Is);
    quad([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, -1], Is);
    quad([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [1, 0, 0], Is);
    quad([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0], Is);
    if (y0 > 0.02) quad([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0], Is);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  g.setIndex([...Is, ...It]);
  g.addGroup(0, Is.length, 0);
  g.addGroup(Is.length, It.length, 1);
  const m = new THREE.Mesh(g, [side, top]);
  m.name = name; m.castShadow = m.receiveShadow = true;
  parent.add(m);
  return m;
}

/**
 * Lead boxes for one row of gull-wing style leads.
 *  axis 'x': leads run along x (spaced along y px);  axis 'y': leads run along y (spaced along x px).
 *  face = pixel coordinate of the body face the leads leave, tip = pixel coordinate of the lead tip,
 *  pos  = across-axis pixel centres, w = lead width in pixels, hTop = height of the shoulder top (mm).
 */
export function leadBoxes({ axis, face, tip, pos, w = 3.5, t = 0.14, hTop = 0.5, fillet = true }) {
  const out = [];
  const dir = Math.sign(tip - face), len = Math.abs(tip - face);
  const k = (fr) => face + dir * len * fr;
  const PX_MM = 8.72;                                                            // base texture px per mm (fillet lengths are given in mm)
  for (const p of pos) {
    const seg = (a0, a1, yA, yB) => {
      const lo = Math.min(a0, a1), hi = Math.max(a0, a1);
      out.push({ b: axis === 'x' ? [lo, p - w / 2, hi, p + w / 2] : [p - w / 2, lo, p + w / 2, hi], h: yB - yA, y0: yA, sharp: true });
    };
    seg(k(-0.08), k(0.42), hTop - t, hTop);        // shoulder, tucked into the body
    seg(k(0.30), k(0.42), 0, hTop - t - 0.005);   // riser (top kept below the shoulder underside: no coplanar faces)
    const L = fillet ? Math.min(0.3, 0.25 * len / PX_MM) : 0, Lpx = L * PX_MM;
    seg(k(0.36), k(1.0) - dir * Lpx, 0, t);       // foot on the pad (the toe fillet completes it to the tip, so the lead extent is unchanged)
    if (fillet) {                                   // ASSUMED solder: concave toe fillet at the tip (inside the traced extent), heel fillet behind the riser
      const out1 = dir > 0 ? (axis === 'x' ? '+x' : '+y') : (axis === 'x' ? '-x' : '-y'), back = dir > 0 ? (axis === 'x' ? '-x' : '-y') : (axis === 'x' ? '+x' : '+y');
      const W = w * 1.1;                            // at most 1.1 x the foot width, so a macro zoom does not read as a notched tip
      const at = (fr, off = 0) => (axis === 'x' ? { x: k(fr) - dir * off, z: p } : { x: p, z: k(fr) - dir * off });
      out.push({ fillet: { ...at(1.0, Lpx), dir: out1, L, H: t, W } });
      out.push({ fillet: { ...at(0.30), dir: back, L: L * 0.7, H: Math.min(hTop - t - 0.01, 0.35), W } });
    }
  }
  return out;
}

/** Convenience: lead rows merged into one mesh. mats = { top, side }. `rows` is an array of leadBoxes specs. */
export function leadRows(ctx, parent, mats, rows, name = 'leads') {
  return mergedBoxes(ctx, parent, rows.flatMap(leadBoxes), { ...mats, name });
}

/** Thin flat boxes (pads, terminations). list = [{ b:[x0,y0,x1,y1], h? }] */
export function flatPads(ctx, parent, mats, list, name = 'pads') {
  return mergedBoxes(ctx, parent, list.map((it) => ({ b: it.b, h: it.h ?? 0.1, y0: it.y0 || 0 })), { ...mats, name });
}

/** Vertical thin pins / contacts as instanced boxes. list = [{ x, z (px), y0, y1 (mm), w, d (px) }]. */
export function pinSet(ctx, parent, mat, list, name = 'pins') {
  const f = ctx.frames.base;
  const items = list.map((p) => ({ p: [f.x(p.x), (p.y0 + p.y1) / 2, f.z(p.z)], s: [f.len(p.w), p.y1 - p.y0, f.len(p.d)] }));
  return ctx.prim.instanced(parent, ctx.prim.UNIT_PIN, mat, items, name);   // square pins with a chamfered tip (assumed; the photos show pointed tips)
}

/** Instanced solder balls. list = [{ x, z (px) }], d = ball diameter (mm), yc = ball centre height (mm). */
export function ballGrid(ctx, parent, mat, list, { d = 0.4, yc = 0.14, name = 'balls' } = {}) {
  const { THREE } = ctx, f = ctx.frames.base;
  const geo = new THREE.SphereGeometry(0.5, 10, 6);
  const im = new THREE.InstancedMesh(geo, mat, list.length), o = new THREE.Object3D();
  list.forEach((p, i) => { o.position.set(f.x(p.x), yc, f.z(p.z)); o.scale.set(d, d, d); o.rotation.set(0, 0, 0); o.updateMatrix(); im.setMatrixAt(i, o.matrix); });
  im.instanceMatrix.needsUpdate = true; im.castShadow = im.receiveShadow = true; im.name = name;
  parent.add(im);
  return im;
}

/**
 * Make every named sub-node of every part in `group` unique: "<board>/<part>/<child>" (a counter is added if the same child name
 * is used twice inside one part). <part> is the printed designator if there is one, else the part's group name or label.
 * The part groups themselves and nested parts that carry their own label keep their names. Call once at the end of a builder.
 */
export function uniqueNames(group, board = 'base') {
  const used = new Set();
  for (const part of group.children) {
    const pn = part.userData?.ref || part.name || part.userData?.label || 'part';
    part.traverse((d) => {
      if (d === part || !d.name || d.userData?.label) return;
      const stem = `${board}/${pn}/${d.name}`;
      let n = stem, k = 1;
      while (used.has(n)) n = `${stem}#${++k}`;
      used.add(n); d.name = n;
    });
  }
  return group;
}
