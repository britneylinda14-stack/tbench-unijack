// Mercury module builder (owner: key 'mercury'). See CONTRACT.md. Illustrative, photo-anchored, NOT CAD.
// Group origin = centre of the module's TOP surface; fingers edge at x = -W/2 (left edge of the front texture).
// All footprints are measured on assets/tex/mercury-front.webp / mercury-back.webp (data in mercury-data.js).
import * as D from './mercury-data.js';
import { buildChips } from './mercury-chips.js';

const T = 1.2;   // module PCB thickness in mm, ASSUMED (1.0 to 1.2 typical for a module of this kind)

export function build(ctx) {
  const { THREE, prim, mat, frames, tex } = ctx;
  const f = frames.mercuryFront, fB = frames.mercuryBack, s = f.s;
  const g = new THREE.Group(); g.name = 'mercury';

  // ---------------------------------------------------------------- helpers
  const std = (color, roughness, metalness = 0, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
  const M = {
    alu: std('#b4bac0', 0.36, 0.92),
    aluDark: std('#8d939a', 0.45, 0.9),
    inductor: std('#625c52', 0.6, 0.35),
    blueCap: std('#1f86c4', 0.45, 0),
    brown: std('#3d2f25', 0.5),
    balls: std('#9aa0a6', 0.45, 0.8),
  };
  const photoF = mat.photoTop(tex.mercuryFront), photoB = mat.photoTop(tex.mercuryBack);
  const grp = (name, m) => { const o = new THREE.Group(); o.name = name; g.add(o); prim.meta(o, m); return o; };

  // back photo -> board-local registration (projective, see REG_H in mercury-data.js)
  const Hm = D.REG_H;
  const inv3 = (m) => {
    const [[a, b, c], [d, e, f], [g, h, i]] = m;
    const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C;
    return [[A / det, -(b * i - c * h) / det, (b * f - c * e) / det], [B / det, (a * i - c * g) / det, -(a * f - c * d) / det], [C / det, -(a * h - b * g) / det, (a * e - b * d) / det]];
  };
  const Hi = inv3(Hm);
  const reg = {
    /** back px -> board-local [x, z] mm */
    toLocal(xb, yb) {
      const w = Hm[2][0] * xb + Hm[2][1] * yb + Hm[2][2];
      const xf = (Hm[0][0] * xb + Hm[0][1] * yb + Hm[0][2]) / w, yf = (Hm[1][0] * xb + Hm[1][1] * yb + Hm[1][2]) / w;
      return [f.x(xf), f.z(yf)];
    },
    /** board-local (x, z) mm -> UV into the back texture */
    uv(x, z) {
      const xf = x * s + f.wpx / 2, yf = z * s + f.hpx / 2;
      const w = Hi[2][0] * xf + Hi[2][1] * yf + Hi[2][2];
      const xb = (Hi[0][0] * xf + Hi[0][1] * yf + Hi[0][2]) / w, yb = (Hi[1][0] * xf + Hi[1][1] * yf + Hi[1][2]) / w;
      return [xb / fB.wpx, 1 - yb / fB.hpx];
    },
    /** back px box -> board-local {cx, cz, w, d} */
    box([x0, y0, x1, y1]) {
      const a = reg.toLocal(x0, y0), b = reg.toLocal(x1, y1), c = reg.toLocal(x0, y1), d = reg.toLocal(x1, y0);
      const xs = [a[0], b[0], c[0], d[0]], zs = [a[1], b[1], c[1], d[1]];
      const xm = Math.min(...xs), xM = Math.max(...xs), zm = Math.min(...zs), zM = Math.max(...zs);
      return { cx: (xm + xM) / 2, cz: (zm + zM) / 2, w: (xM - xm) - 0.04, d: (zM - zm) - 0.04 };
    },
  };
  /** re-project the BOTTOM faces of a mesh through the back-photo registration (instead of a plain x mirror) */
  function remapBottom(mesh, pos, rotY = 0) {
    const geo = mesh.geometry, p = geo.attributes.position, n = geo.attributes.normal, uv = geo.attributes.uv;
    const c = Math.cos(rotY), sn = Math.sin(rotY);
    for (let i = 0; i < p.count; i++) {
      if (n.getY(i) >= -0.5) continue;
      const lx = p.getX(i), lz = p.getZ(i);
      const [u, v] = reg.uv(pos[0] + c * lx + sn * lz, pos[2] - sn * lx + c * lz);
      uv.setXY(i, u, v);
    }
    uv.needsUpdate = true;
  }

  // ---------------------------------------------------------------- PCB outline (measured), notches, holes
  const O = D.OUT;
  const yTop = (x) => -0.09 + 0.00446 * x;
  const arc = (cx, cy, r, a0, a1, n = 6) => { const out = []; for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } return out; };
  const px = [];
  px.push(O.tl);
  { const n = O.topNotch; px.push([n.x0, yTop(n.x0)], ...arc(n.x0 + n.r, n.y - n.r, n.r, Math.PI, Math.PI / 2), ...arc(n.x1 - n.r, n.y - n.r, n.r, Math.PI / 2, 0), [n.x1, yTop(n.x1)]); }
  px.push(O.tr, O.br);
  { const n = O.botNotch; px.push([n.x1, O.br[1]], ...arc(n.x1 - n.r, n.y + n.r, n.r, 0, -Math.PI / 2), ...arc(n.x0 + n.r, n.y + n.r, n.r, -Math.PI / 2, -Math.PI), [n.x0, O.bl[1]]); }
  px.push(O.bl);
  { const k = O.keyNotch, xe = (y) => 0.3 + 0.00075 * y, rr = (k.y1 - k.y0) / 2;
    px.push([xe(k.y1), k.y1], ...arc(k.xEnd - rr, (k.y0 + k.y1) / 2, rr, Math.PI / 2, -Math.PI / 2, 10), [xe(k.y0), k.y0]); }
  const outline = px.map(([x, y]) => [f.x(x), f.z(y)]);
  const holes = D.HOLES_F.map(([x, y]) => ({ x: f.x(x), z: f.z(y), r: D.HOLE_R_MM }));

  const pcb = prim.shapeBoard(g, { frame: f, outline, holes, topTex: tex.mercuryFront, bottomTex: tex.mercuryBack, mats: mat, thickness: T, name: 'pcb' });
  remapBottom(pcb, [0, 0, 0]);
  pcb.userData = {
    kind: 'board', label: 'Mercury PCB', status: 'photo-derived',
    desc: 'Outline, key notch, edge notches and four mounting holes traced from photo 4; thickness is assumed (about 1.0 to 1.2 mm). Front and back show the real photos.',
  };

  // ---------------------------------------------------------------- mounting holes: thin gold annular rings (both faces) + plated barrel
  {
    const gg = grp('mounting-holes', { label: 'Plated mounting holes (x4)', kind: 'other', status: 'photo-derived',
      desc: 'Four gold-ringed holes near the corners; positions and ring size measured on photo 4 (ring outer diameter about 3.1 mm, hole about 2 mm). Plating thickness is assumed.' });
    const RT = 0.05, ro = D.RING_OUTER_MM, ri = D.HOLE_R_MM - 0.01;
    const sh = new THREE.Shape(); sh.absarc(0, 0, ro, 0, Math.PI * 2, false);
    const hp = new THREE.Path(); hp.absarc(0, 0, ri, 0, Math.PI * 2, true); sh.holes.push(hp);
    const ringGeo = new THREE.ExtrudeGeometry(sh, { depth: RT, bevelEnabled: false, curveSegments: 28 });
    ringGeo.rotateX(-Math.PI / 2);
    const barrelGeo = new THREE.CylinderGeometry(ri, ri, T, 28, 1, true);
    const gold = mat.gold.clone(); gold.side = THREE.DoubleSide;
    prim.instanced(gg, ringGeo, mat.gold, holes.map((h) => ({ p: [h.x, 0, h.z], s: [1, 1, 1] })), 'ring-front');
    prim.instanced(gg, ringGeo, mat.gold, holes.map((h) => ({ p: [h.x, -T - RT, h.z], s: [1, 1, 1] })), 'ring-back');
    prim.instanced(gg, barrelGeo, gold, holes.map((h) => ({ p: [h.x, -T / 2, h.z], s: [1, 1, 1] })), 'barrel');
  }

  // ---------------------------------------------------------------- edge-connector fingers (gold strips, both faces)
  {
    const x0 = f.x(D.FINGER_X_F[0]), x1 = f.x(D.FINGER_X_F[1]), xc = (x0 + x1) / 2, L = x1 - x0, h = D.FINGER_H_MM;
    const front = [], back = [];
    for (const grpF of D.FINGERS_F) for (let k = 0; k < grpF.n; k++) front.push({ p: [xc, h / 2, f.z(grpF.y0 + k * grpF.pitch)], s: [L, h, D.FINGER_W_MM] });
    for (const grpB of D.FINGERS_B) for (let k = 0; k < grpB.n; k++) back.push({ p: [xc, -T - h / 2, reg.toLocal(760, grpB.y0 + k * grpB.pitch)[1]], s: [L, h, D.FINGER_W_MM] });
    const gf = grp('fingers-front', { label: 'Edge contact fingers (front)', kind: 'pin', status: 'photo-derived',
      desc: `Counted on photo 4 (front): ${front.length} gold contacts on this face (${D.FINGERS_F[0].n} on one side of the key notch, ${D.FINGERS_F[1].n} on the other). The contact pitch measures ${(D.FINGERS_F[0].pitch / s).toFixed(3)} mm at the model's scale, which is set by the module's 69.6 mm length. TBench names the module format "DIMM-260" (vendor-stated, from the Crowd Supply campaign page; not checked against any standard here). This model makes no claim that Mercury follows any standard beyond that name, or any pinout. Finger length, thickness and plating are assumed.` });
    prim.instanced(gf, prim.UNIT_BOX, mat.gold, front, 'fingers-front');
    const gb = grp('fingers-back', { label: 'Edge contact fingers (back)', kind: 'pin', status: 'photo-derived',
      desc: `Counted on photo 4 (back): ${back.length} gold contacts on this face (${D.FINGERS_B[0].n} + ${D.FINGERS_B[1].n}, same key-notch split as the front). The contact pitch on this face measures ${(D.FINGERS_B[0].pitch / s).toFixed(3)} mm at the model's scale. Whether the two faces are electrically independent contacts is not shown by any photo. Finger length, thickness and plating are assumed.` });
    prim.instanced(gb, prim.UNIT_BOX, mat.gold, back, 'fingers-back');
  }

  // ---------------------------------------------------------------- shared part helpers
  /** box on the FRONT face from a front-px box; top shows the photo */
  function fbox(parent, pxBox, h, { y0 = 0, top = photoF, side, radius = 0, ...rest } = {}) {
    const b = f.box(pxBox);
    return prim.boxPart(parent, { frame: f, size: [b.w, h, b.d], pos: [b.cx, y0, b.cz], radius, top, side, ...rest });   // rest: sharp, edges, bevel
  }
  /** gull-wing leads leaving a body along +-x or +-z: prim.gullLeads (real gull-wing profile with assumed toe and heel solder fillets, one draw call).
   *  ext = body half extent along the lead axis; positions = offsets across the body from (cx, cz). Part frame: y = 0 is the board surface. */
  function gull(parent, material, { cx, cz, ext, axis, sides, positions, len, w, t, hMid, name }) {
    return prim.gullLeads(parent, material, { cx, cz, bodyW: 2 * ext, bodyD: 2 * ext, sides: axis, sideList: sides, positions, leadLen: len, leadW: w, leadT: t, yMid: hMid, name });
  }

  // ---------------------------------------------------------------- FRONT parts
  {   // TC356 BGA
    const b = f.box(D.F.bga);
    const gg = grp('tc356', { label: 'BGA-style IC (marked TC356)', kind: 'ic', status: 'photo-verified',
      desc: 'Package footprint measured on photo 4; its marking reads "Infineon TriCore SAK-TC356TA 64F300S AB" (legible in the photo). That marking is the verified part; the package type is inferred, because no photo shows the underside, so "BGA-style" is an assumption. The row of solder balls drawn under the package edge is ILLUSTRATIVE (ball pitch 0.8 mm, diameter 0.45 mm and the stand-off are assumed; the real ball map is hidden). Height is assumed. Nothing is claimed about its role inside UniJack.' });
    const standoff = 0.4, bd = 0.45, pitch = 0.8;
    prim.boxPart(gg, { size: [b.w - 2.6, standoff * 0.8, b.d - 2.6], pos: [b.cx, 0.05, b.cz], side: M.balls, sharp: true });
    const balls = [];
    for (const inset of [0.6, 0.6 + pitch]) {
      const nx = Math.floor((b.w - 2 * inset) / pitch) + 1, nz = Math.floor((b.d - 2 * inset) / pitch) + 1;
      const x0 = -(nx - 1) * pitch / 2, z0 = -(nz - 1) * pitch / 2;
      for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
        const onRim = inset === 0.6 ? (i === 0 || j === 0 || i === nx - 1 || j === nz - 1) : (i === 0 || j === 0 || i === nx - 1 || j === nz - 1);
        if (onRim) balls.push({ p: [b.cx + x0 + i * pitch, bd / 2 - 0.02, b.cz + z0 + j * pitch], s: [bd, bd, bd] });
      }
    }
    prim.instanced(gg, new THREE.SphereGeometry(0.5, 8, 6), M.balls, balls, 'ball-rim');
    fbox(gg, D.F.bga, 1.25, { y0: standoff, side: mat.icBlack, radius: 0.08 });
  }
  {   // molded power part at top-left
    const gg = grp('vns40', { label: 'Molded power part (marked VNS40)', kind: 'ic', status: 'photo-verified',
      desc: 'Appears to be a two-terminal molded power package (SMC-style shape) with tin tabs at both ends; the marking "VNS40 B34" is legible in photo 4. Body height is assumed (about 2.3 mm).' });
    fbox(gg, D.F.vns.body, 2.3, { y0: 0.12, side: mat.plasticBlack, radius: 0.2 });
    fbox(gg, D.F.vns.tabTop, 0.14, { side: mat.tin });
    fbox(gg, D.F.vns.tabBot, 0.14, { side: mat.tin });
    fbox(gg, [D.F.vns.tabTop[0], 136.5, D.F.vns.tabTop[2], 139.6], 1.2, { y0: 0.05, top: null, side: mat.tin });
    fbox(gg, [D.F.vns.tabBot[0] + 4, 296.6, D.F.vns.tabBot[2] - 4, 299.8], 1.2, { y0: 0.05, top: null, side: mat.tin });
  }
  {   // silver electrolytic can
    const c = D.F.ecap, cx = f.x(c.c[0]), cz = f.z(c.c[1]), r = f.len(c.r);
    const gg = grp('ecap', { label: 'Silver can, capacitor-style (marked 100 HFT C53)', kind: 'cap', status: 'photo-verified',
      desc: 'Appears to be an SMD aluminium electrolytic capacitor can on a black seat with a tin terminal tab (inferred from its shape); printing "100 HFT C53" is legible in photo 4. Height (about 6 mm), the seat and the size of the bevelled rim at the top of the can (visible in the photos, about 0.4 mm assumed) are assumed. The can diameter is taken from the top outline of the can in the photo (about 6.7 mm), which may slightly overstate the true diameter because the top is nearer the camera.' });
    prim.cylPart(gg, { r: r + 0.3, h: 0.9, pos: [cx, 0, cz], side: mat.plasticBlack, segments: 48 });
    prim.cylPart(gg, { r, h: 4.8, pos: [cx, 0.9, cz], side: M.alu, segments: 56 });
    prim.cylPart(gg, { frame: f, r, rTop: r - 0.4, h: 0.4, pos: [cx, 5.7, cz], top: photoF, side: M.alu, segments: 56 });   // chamfered rim (gallery-1 and photo 4 show a bevelled can top; the 0.4 mm size is assumed)
    const bead = new THREE.Mesh(new THREE.TorusGeometry(r, 0.13, 8, 56), M.aluDark);
    bead.rotation.x = Math.PI / 2; bead.position.set(cx, 2.1, cz); bead.castShadow = true; gg.add(bead);
    fbox(gg, c.tab, 0.25, { side: mat.tin, radius: 0.05 });
  }
  {   // TSSOP-style IC
    const t = D.F.tssop, b = f.box(t.body);
    const gg = grp('tssop16', { label: '16-lead gull-wing IC (TSSOP-style)', kind: 'ic', status: 'photo-derived',
      desc: 'Footprint and lead count (8 per long side) traced from photo 4; the package type is inferred from its shape and its marking is not quoted. Body height (about 1.1 mm), lead shape and the solder fillets at each foot are assumed.' });
    fbox(gg, t.body, 1.0, { y0: 0.1, side: mat.icBlack, radius: 0.08 });
    const off0 = f.z(t.leadsCy) - b.cz, pitch = t.pitch / s;
    gull(gg, mat.tin, { cx: b.cx, cz: b.cz, ext: b.w / 2, axis: 'x', sides: [-1, 1], positions: Array.from({ length: t.n }, (_, i) => off0 + (i - (t.n - 1) / 2) * pitch), len: 1.15, w: 0.3, t: 0.14, hMid: 0.55, name: 'leads' });
  }
  for (const [key, label, mark, h] of [['ind472', 'Inductor-style part (marked 472)', '472', 3.0], ['ind222', 'Inductor-style part (marked 222)', '222', 2.5]]) {
    const gg = grp(key, { label, kind: 'passive', status: 'photo-verified',
      desc: `Appears to be a shielded SMD inductor from its shape; the marking "${mark}" is legible in photo 4 (that marking is the verified part). Footprint is the top face as photographed. Height (about ${h} mm) is assumed, low confidence: the side faces in gallery-1 suggest roughly 2.2 to 3.4 mm for the 472 depending on the camera fit, and the 222 looks slightly lower than the 472.` });
    fbox(gg, D.F[key], h, { side: M.inductor, radius: 0.18 });
  }
  {   // brown rectangular part
    const gg = grp('brown-part', { label: 'Brown rectangular part', kind: 'other', status: 'photo-derived',
      desc: 'Brown rectangular body with a tin terminal visible at its left end; appears crystal/oscillator-like from its shape only. Footprint from photo 4; height (about 2.4 mm) assumed.' });
    fbox(gg, D.F.brown.lid, 2.4, { y0: 0.2, side: M.brown, radius: 0.4 });
    fbox(gg, D.F.brown.term, 1.5, { y0: 0.1, side: mat.tin, radius: 0.15 });
  }
  {   // blue round inductor
    const c = D.F.blue, cx = f.x(c.c[0]), cz = f.z(c.c[1]), r = f.len(c.r);
    const gg = grp('blue-inductor', { label: 'Round inductor (marked 3R3)', kind: 'passive', status: 'photo-verified',
      desc: 'Black round body on a dark square base with a blue top cap; the marking "3R3" is legible in photo 4. Appears to be a shielded power inductor from its shape; heights assumed (about 4.2 mm overall). The footprint is taken from the top outline in the photo.' });
    fbox(gg, c.base, 1.5, { y0: 0.1, side: mat.plasticBlack, radius: 0.9 });
    prim.cylPart(gg, { frame: f, r: r + 0.06, h: 2.2, pos: [cx, 1.6, cz], side: mat.plasticBlack, segments: 56 });
    prim.cylPart(gg, { frame: f, r, h: 0.5, pos: [cx, 3.8, cz], top: photoF, side: M.blueCap, segments: 56 });
    fbox(gg, c.tab, 0.3, { side: mat.tin, radius: 0.05 });
    fbox(gg, c.blob, 0.35, { side: mat.tin, radius: 0.15 });
    fbox(gg, c.blobL, 0.35, { side: mat.tin, radius: 0.15 });
  }
  {   // HAM3-class small IC at right of the BGA
    const h = D.F.ham, b = f.box(h.body);
    const gg = grp('small-ic-right', { label: 'Small molded IC (right of TC356)', kind: 'ic', status: 'photo-derived',
      desc: 'Small molded IC with 5 solder leads visible on its right edge and 4 on its left, traced from photo 4. Package type is not claimed; height about 0.9 mm is assumed.' });
    fbox(gg, h.body, 0.9, { y0: 0.05, side: mat.icBlack, radius: 0.1 });
    const lead = (sg, ys) => gull(gg, mat.tin, { cx: b.cx, cz: b.cz, ext: b.w / 2, axis: 'x', sides: [sg], positions: ys.map((y) => f.z(y) - b.cz), len: 0.5, w: 0.34, t: 0.12, hMid: 0.4, name: sg > 0 ? 'leads-right' : 'leads-left' });
    lead(1, h.rightY); lead(-1, h.leftY);
  }
  {   // SOT-23 style parts
    const A = D.F.sotA, bA = f.box(A.body);
    const gA = grp('sot-a', { label: 'Small 3-lead part (SOT-23 style)', kind: 'ic', status: 'photo-derived',
      desc: 'Black 3-lead body (2 leads on one long side, 1 on the other) traced from photo 4; appears SOT-23 sized. Height about 1.1 mm is assumed.' });
    fbox(gA, A.body, 1.1, { y0: 0.05, side: mat.plasticBlack, radius: 0.08 });
    gull(gA, mat.tin, { cx: bA.cx, cz: bA.cz, ext: bA.d / 2, axis: 'z', sides: [-1], positions: A.leadsTop.map((x) => f.x(x) - bA.cx), len: 0.6, w: 0.45, t: 0.12, hMid: 0.6, name: 'leads-top' });
    gull(gA, mat.tin, { cx: bA.cx, cz: bA.cz, ext: bA.d / 2, axis: 'z', sides: [1], positions: [f.x(A.leadBot) - bA.cx], len: 0.6, w: 0.45, t: 0.12, hMid: 0.6, name: 'lead-bottom' });
    const Bq = D.F.sotB, bB = f.box(Bq.body);
    const gB = grp('sot-b', { label: 'Small 3-lead part (SOT-23 style, rotated)', kind: 'ic', status: 'photo-derived',
      desc: 'Black 3-lead body (2 leads on its right side, 1 on its left) traced from photo 4; appears SOT-23 sized. Height about 1.1 mm is assumed.' });
    fbox(gB, Bq.body, 1.1, { y0: 0.05, side: mat.plasticBlack, radius: 0.08 });
    gull(gB, mat.tin, { cx: bB.cx, cz: bB.cz, ext: bB.w / 2, axis: 'x', sides: [1], positions: Bq.leadsRight.map((y) => f.z(y) - bB.cz), len: 0.6, w: 0.45, t: 0.12, hMid: 0.6, name: 'leads-right' });
    gull(gB, mat.tin, { cx: bB.cx, cz: bB.cz, ext: bB.w / 2, axis: 'x', sides: [-1], positions: [f.z(Bq.leadLeft) - bB.cz], len: 0.6, w: 0.45, t: 0.12, hMid: 0.6, name: 'lead-left' });
  }

  // ---------------------------------------------------------------- BACK parts (hang DOWN from the underside)
  const hangBox = (parent, b, h, { standoff = 0.05, side, radius = 0 }) => {
    const pos = [b.cx, -T - standoff - h, b.cz];
    const m = prim.boxPart(parent, { frame: fB, size: [b.w, h, b.d], pos, radius, bottom: photoB, side });
    remapBottom(m, pos);
    return m;
  };
  const hang = () => { const o = new THREE.Group(); o.position.y = -T; o.scale.y = -1; return o; };   // y up in the group = down in the module
  {   // SOIC-8
    const S = D.B.soic, b = reg.box(S.body);
    const gg = grp('soic8', { label: 'SOIC-style 8-lead IC (back)', kind: 'ic', status: 'photo-derived',
      desc: 'Black 8-lead gull-wing body (4 leads per long side at about 1.3 mm pitch) on the back face, traced from photo 4 (back). Appears SOIC-8 sized; its marking is not legible enough to quote. Height about 1.4 mm, lead shape and solder fillets are assumed.' });
    hangBox(gg, b, 1.4, { standoff: 0.1, side: mat.icBlack, radius: 0.08 });
    const lg = hang(); gg.add(lg);
    const xs = S.leadX.map((xb) => reg.toLocal(xb, 181)[0] - b.cx);
    gull(lg, mat.tin, { cx: b.cx, cz: b.cz, ext: b.d / 2, axis: 'z', sides: [-1, 1], positions: xs, len: 1.3, w: 0.5, t: 0.15, hMid: 0.6, name: 'leads' });
  }
  {   // SOT-23 on the back
    const S = D.B.sot, b = reg.box(S.body);
    const gg = grp('sot23-back', { label: '3-lead SOT-23 style part (back)', kind: 'ic', status: 'photo-derived',
      desc: 'Black 3-lead body (1 lead on one long side, 2 on the other) on the back face, traced from photo 4 (back); appears SOT-23 sized. Height about 1 mm is assumed.' });
    hangBox(gg, b, 0.95, { standoff: 0.05, side: mat.plasticBlack, radius: 0.06 });
    const lg = hang(); gg.add(lg);
    gull(lg, mat.tin, { cx: b.cx, cz: b.cz, ext: b.d / 2, axis: 'z', sides: [-1], positions: [reg.toLocal(S.leadTop, 268)[0] - b.cx], len: 0.6, w: 0.5, t: 0.12, hMid: 0.5, name: 'lead-top' });
    gull(lg, mat.tin, { cx: b.cx, cz: b.cz, ext: b.d / 2, axis: 'z', sides: [1], positions: S.leadsBot.map((xb) => reg.toLocal(xb, 318)[0] - b.cx), len: 0.6, w: 0.5, t: 0.12, hMid: 0.5, name: 'leads-bottom' });
  }

  // ---------------------------------------------------------------- chip passives (both faces; merged meshes) and bare footprints
  buildChips({ ctx, g, grp, reg, f, fB, T });

  // thickness is ASSUMED. backDepth = lowest back part below the underside (SOIC-8 incl. stand-off); frontHeight = tallest front part (electrolytic can). Both heights assumed.
  g.userData.anchors = { thickness: T, backDepth: 1.5, frontHeight: 6.1 };
  prim.meta(g, { label: 'Mercury Module', kind: 'module', status: 'photo-derived',
    desc: 'The Mercury module (35.5 x 69.6 mm; the scale is anchored on the 69.6 mm module length, not on a vendor drawing) modelled from photo 4 (front and back macro): traced outline, notches, holes, edge fingers on both faces and the larger parts with assumed heights. The back photo is registered to the front outline with a fitted projective transform (edges within about 0.1 mm, notches within about 0.3 mm). Tiny passives are texture-only unless listed. PCB thickness is assumed.' });
  return g;
}
