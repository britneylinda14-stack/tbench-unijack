// base-left builder. Owner: base-left. Adds the parts of the base board LEFT of texture x ~ 570 px
// (power jack, regulator, diode, screw terminal, USB + RJ45, LED row, SO-DIMM-style socket J400 with two latches,
// three TSSOP-48 level shifters) to `group` (base-board local frame, mm) and returns { anchors, latches }.
//
// Method: every footprint is read in TEXTURE PIXELS from assets/tex/base-top.webp (crop.py grids) and converted with
// frames.base, so the top faces (planar-UV photo) line up with the photo. All HEIGHTS, plastic/metal colours and latch
// kinematics are not visible in a top-down photo: they are typical values and flagged 'assumed' / described as such.

import { uniqueNames } from './base-right-helpers.js';

export async function build(ctx, group) {
  const { THREE, prim, mat, frames, tex } = ctx;
  const F = frames.base;
  const photo = mat.photoTop(tex.base, { roughness: 0.6, env: 0.45 });
  const std = (color, roughness = 0.5, metalness = 0, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });

  // ---- local materials (colours picked to read like the photos; not measured) ----
  const M = {
    housing: std('#5a5f65', 0.55),
    housingDark: std('#15171a', 0.7),
    latch: std('#666d75', 0.42, 0.65),
    jack: std('#17191c', 0.72),
    jackLining: std('#7d848b', 0.35, 0.85),
    shell: std('#858c92', 0.36, 0.85),
    shellDark: std('#50565c', 0.5, 0.75),
    cream: std('#d3ccb6', 0.5),
    rj45Carrier: std('#1d1f22', 0.6),
    lampGreen: std('#5fd06a', 0.4, 0, { emissive: '#1d6a2a', emissiveIntensity: 0.5 }),
    chipBody: std('#3a3733', 0.6),
    ceramic: std('#9c8a6c', 0.6),
    ledBody: std('#e6dcc1', 0.45),
    darkContact: std('#3d4146', 0.45, 0.8),
    tin: mat.tin, steel: mat.steel, darkSteel: mat.darkSteel, gold: mat.gold,
    icBlack: mat.icBlack, green: mat.terminalGreen,
  };

  const X = F.x, Z = F.z, L = F.len;
  const mm = (p) => p / F.s;
  const meta = prim.meta;
  const newGroup = (name, md) => { const g = new THREE.Group(); g.name = name; group.add(g); meta(g, md); return g; };

  /** box from a texture-pixel bbox [x0,y0,x1,y1]; h and y0 in mm */
  const B = (parent, b, h, { y0 = 0, top = null, side, radius = 0, rotY = 0, ...rest } = {}) => {
    const o = F.box(b);
    return prim.boxPart(parent, { frame: F, size: [o.w, h, o.d], pos: [o.cx, y0, o.cz], rotY, radius, top, side, ...rest });   // rest: sharp, edges, bevel
  };
  /** small chip (passive) with tin end caps. axis = direction of the long side */
  const chip = (parent, b, h, axis = 'x', body = M.chipBody, capFrac = 0.24) => {
    B(parent, b, h, { top: photo, side: body });
    const [x0, y0, x1, y1] = b;
    if (axis === 'x') { const c = (x1 - x0) * capFrac; B(parent, [x0, y0, x0 + c, y1], h * 1.04, { side: M.tin }); B(parent, [x1 - c, y0, x1, y1], h * 1.04, { side: M.tin }); }
    else { const c = (y1 - y0) * capFrac; B(parent, [x0, y0, x1, y0 + c], h * 1.04, { side: M.tin }); B(parent, [x0, y1 - c, x1, y1], h * 1.04, { side: M.tin }); }
  };
  /** strip between (za,ya) and (zb,yb) (z = board z in mm, y = height) centred on x, for sloped lead shoulders */
  const slopedStrip = (parent, cx, w, t, za, ya, zb, yb, material) => {
    const dz = zb - za, dy = yb - ya, len = Math.hypot(dz, dy);
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, t, len), material);
    m.position.set(cx, (ya + yb) / 2, (za + zb) / 2); m.rotation.x = -Math.atan2(dy, dz);
    m.castShadow = m.receiveShadow = true; parent.add(m); return m;
  };
  /** flat tinned pad / plate lying on the board */
  const plate = (parent, b, t = 0.12, material = M.tin, y0 = 0) => B(parent, b, t, { y0, top: photo, side: material, sharp: true });   // stamped tabs and pads keep sharp edges
  /**
   * Board-level decal that hides the CLOSED latch arms and hooks baked into the flat-lay texture: when a latch rotates open the
   * baked arm would stay behind as a ghost. The decal is NOT the real board: what lies under a latch arm is not photographed, so it is
   * filled with plain solder-mask pixels copied from a clean region of the same photo (chosen to match the tone around the arm), tone-matched
   * with a per-channel gain, and feathered at the edges so it does not read as a rectangle. model.js shows it only while the latches are open.
   *
   *   pieces  [{ b: [x0,y0,x1,y1], f: [l,t,r,b] }]  texture-pixel boxes whose union is fully opaque; f = feather width (px) OUTSIDE each edge
   *   map     (x, y) -> [sx, sy]  destination texture pixel -> source texture pixel
   *   gain    [r,g,b] linear multiplier for the sampled pixels, or { box, c: [tl, tr, bl, br] } = one gain per corner of `box`,
   *           blended bilinearly so the fill meets the real pixels around it without a tone step (gains come from toneGain below)
   */
  const pixels = (() => {                                   // RGBA of the base texture, read once (canvas); null if unavailable
    try {
      const img = tex.base.image, w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const cx = c.getContext('2d', { willReadFrequently: true }); cx.drawImage(img, 0, 0);
      return { w, h, d: cx.getImageData(0, 0, w, h).data };
    } catch (e) { return null; }
  })();
  /** mean LINEAR-light colour of a texture-pixel box (null if the texture cannot be read) */
  const meanLin = ([x0, y0, x1, y1]) => {
    if (!pixels) return null;
    const s = [0, 0, 0]; let n = 0;
    for (let y = Math.max(0, Math.floor(y0)); y < Math.min(pixels.h, Math.ceil(y1)); y++) for (let x = Math.max(0, Math.floor(x0)); x < Math.min(pixels.w, Math.ceil(x1)); x++) {
      const i = 4 * (y * pixels.w + x); for (let k = 0; k < 3; k++) s[k] += Math.pow(pixels.d[i + k] / 255, 2.2); n++;
    }
    return n ? s.map((v) => v / n) : null;
  };
  /** per-channel gain that makes the source box look like the target box (clamped to a mild correction) */
  const toneGain = (src, tgt) => {
    const a = meanLin(src), b = meanLin(tgt);
    return a && b ? a.map((v, k) => Math.min(1.3, Math.max(0.7, b[k] / Math.max(v, 1e-4)))) : [1, 1, 1];
  };
  const linMap = (dst, src) => (x, y) => {
    const tx = Math.min(1, Math.max(0, (x - dst[0]) / (dst[2] - dst[0]))), ty = Math.min(1, Math.max(0, (y - dst[1]) / (dst[3] - dst[1])));
    return [src[0] + tx * (src[2] - src[0]), src[1] + ty * (src[3] - src[1])];
  };
  const patchMat = photo.clone();
  patchMat.vertexColors = true; patchMat.transparent = true; patchMat.depthWrite = false;
  patchMat.polygonOffset = true; patchMat.polygonOffsetFactor = -2; patchMat.polygonOffsetUnits = -2;
  const latchPatch = (parent, { name, pieces: pcs, map, gain = [1, 1, 1], y = 0.04, step = 2 }) => {
    const pieces = pcs.map((p) => ({ b: p.b, f: p.f || [0, 0, 0, 0] }));
    const sm = (t) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };
    const ramp = (d, w) => (w > 0 ? sm(1 + d / w) : d >= 0 ? 1 : 0);        // d = signed distance inside an edge
    const alphaAt = (x, yy) => pieces.reduce((a, { b, f }) => Math.max(a, Math.min(
      ramp(x - b[0], f[0]), ramp(yy - b[1], f[1]), ramp(b[2] - x, f[2]), ramp(b[3] - yy, f[3]))), 0);
    const axis = (i0, i1) => {                                               // grid lines: regular + every piece edge (and just outside hard edges)
      const set = new Set();
      const lo = Math.min(...pieces.map((p) => p.b[i0] - p.f[i0 === 0 ? 0 : 1])), hi = Math.max(...pieces.map((p) => p.b[i1] + p.f[i1 === 2 ? 2 : 3]));
      for (let v = lo; v <= hi + 1e-6; v += step) set.add(+v.toFixed(3));
      for (const p of pieces) for (const [i, fi, sgn] of [[i0, p.f[i0 === 0 ? 0 : 1], -1], [i1, p.f[i1 === 2 ? 2 : 3], 1]]) {
        set.add(+p.b[i].toFixed(3)); if (fi > 0) set.add(+(p.b[i] + sgn * fi).toFixed(3)); else set.add(+(p.b[i] + sgn * 0.01).toFixed(3));
      }
      return [...set].sort((u, v) => u - v);
    };
    const gainAt = Array.isArray(gain) ? () => gain : (x, yy) => {
      const [x0, y0, x1, y1] = gain.box, tx = Math.min(1, Math.max(0, (x - x0) / (x1 - x0))), ty = Math.min(1, Math.max(0, (yy - y0) / (y1 - y0)));
      const [tl, tr, bl, br] = gain.c;
      return [0, 1, 2].map((k) => (1 - ty) * ((1 - tx) * tl[k] + tx * tr[k]) + ty * ((1 - tx) * bl[k] + tx * br[k]));
    };
    const xs = axis(0, 2), ys = axis(1, 3), nx = xs.length, ny = ys.length;
    const P = [], N = [], U = [], C = [], A = [];
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const [sx, sy] = map(xs[i], ys[j]), a = alphaAt(xs[i], ys[j]), gk = gainAt(xs[i], ys[j]);
      P.push(X(xs[i]), 0, Z(ys[j])); N.push(0, 1, 0); U.push(sx / F.wpx, 1 - sy / F.hpx); C.push(gk[0], gk[1], gk[2], a); A.push(a);
    }
    const idx = [];
    for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      if (A[a] + A[b] + A[c] + A[d] <= 0) continue;
      idx.push(a, c, b, b, c, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); geo.setAttribute('color', new THREE.Float32BufferAttribute(C, 4));
    geo.setIndex(idx);
    const m = new THREE.Mesh(geo, patchMat); m.name = name; m.position.y = y; m.receiveShadow = true; m.renderOrder = 1; parent.add(m); return m;
  };

  // =====================================================================================================
  // J100  DC barrel-style power jack (designator printed + legible). Opening faces the board edge (-x).
  // =====================================================================================================
  {
    const g = newGroup('J100-group', { ref: 'J100', label: 'Power jack (barrel style)', kind: 'connector', status: 'photo-verified',
      desc: 'Appears to be a DC barrel-style power jack with its opening towards the board edge; the designator J100 is printed beside it and legible in the photo. Footprint from the photo. The 8.5 mm height is assumed: a rough matched-camera estimate from gallery-1 suggests a lower value (about 6 to 7 mm in one camera fit; not stable across fits, so low confidence), and the black plastic and steel tabs are typical assumed values. The flat-lay photo also shows some of this part\'s side faces, so its outline and top-face pixels are approximate.' });
    const H = 8.5;                                         // ASSUMED (see desc): moderate value between the old 10.5 and the gallery-1 estimate
    const plateEnd = 53;                                   // px: front plate x 18..53 (hole plate), main block 53..137
    const o = F.box([18, 20, plateEnd, 132]);
    const zc = Z(70), yc = H * 0.5, r = 3.0;               // barrel bore centre (z from the photo body span, height assumed)
    // front plate with round bore (extruded in x)
    const shape = new THREE.Shape();
    const zmin = o.cz - o.d / 2, zmax = o.cz + o.d / 2;
    shape.moveTo(-zmax, 0); shape.lineTo(-zmin, 0); shape.lineTo(-zmin, H - 0.02); shape.lineTo(-zmax, H - 0.02); shape.closePath();
    const hole = new THREE.Path(); hole.absarc(-zc, yc, r, 0, Math.PI * 2, true); shape.holes.push(hole);
    const pg = new THREE.ExtrudeGeometry(shape, { depth: o.w, bevelEnabled: false, curveSegments: 28 });
    pg.rotateY(Math.PI / 2); pg.translate(o.cx - o.w / 2, 0, 0);
    const pm = new THREE.Mesh(pg, [M.jack, M.jack]); pm.castShadow = pm.receiveShadow = true; g.add(pm);
    B(g, [18, 20, plateEnd, 132], 0.04, { y0: H - 0.03, top: photo, side: M.jack });      // photo cap on the plate top
    // bore lining + centre pin
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.985, r * 0.985, o.w, 36, 1, true), new THREE.MeshStandardMaterial({ color: '#7d848b', roughness: 0.35, metalness: 0.85, side: THREE.DoubleSide }));
    tube.rotation.z = Math.PI / 2; tube.position.set(o.cx, yc, zc); g.add(tube);
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, mm(24), 20), M.steel);
    pin.rotation.z = Math.PI / 2; pin.position.set(X(plateEnd) - mm(12), yc, zc); g.add(pin);
    // main block (top shows the photo) and rear boss
    B(g, [plateEnd, 20, 137, 132], H, { top: photo, side: M.jack, radius: 0.35 });
    B(g, [137, 36, 158, 131], H * 0.7, { top: photo, side: M.jack, radius: 0.3 });
    // steel centre-pin lug at the rear boss (photo: tarnished metal strip with a round eye)
    B(g, [147, 52, 160, 98], H * 0.7, { top: photo, side: M.steel });
    // rear solder tab + flat pad, bottom bracket (riser + foot)
    plate(g, [160, 88, 193, 116], 0.35, M.steel);
    plate(g, [60, 138, 120, 165], 0.35, M.steel);
    const fz = Z(140), bz = Z(122);
    slopedStrip(g, X(90), mm(44), 0.35, fz, 0.35, bz, 3.0, M.steel);
  }

  // Rectangular bare metal pad beside J100 (flat, tinned look)
  {
    const g = newGroup('metal-pad-J100', { label: 'Exposed metal pad', kind: 'other', status: 'photo-derived',
      desc: 'Appears to be a large exposed tinned pad next to the power jack. Footprint from the photo; its 0.15 mm relief is assumed.' });
    plate(g, [228, 17, 281, 73], 0.15, M.tin);
  }

  // =====================================================================================================
  // Small SMD parts right of J100, DPAK-style regulator, extra pair of pads, SMA-style diode, 0805 near J101
  // =====================================================================================================
  {
    // The photo (base-top and gallery-2) shows four bare, tinned, reflowed pads here and no component bodies: flat plates only.
    const g = newGroup('pads-above-dpak', { label: 'Four bare solder pads', kind: 'other', status: 'photo-derived',
      desc: 'Four bare tinned solder pads above the DPAK-style package: one on the left, two stacked in the middle and one on the right. No component bodies are visible on them in the photo, so they are modelled as flat plates. Footprints from the photo; the 0.12 mm relief is assumed.' });
    plate(g, [228, 94, 239, 111], 0.12);
    plate(g, [247, 92, 261, 101], 0.12);
    plate(g, [247, 102, 261, 113], 0.12);
    plate(g, [270, 93, 281, 110], 0.12);
  }
  {
    const g = newGroup('dpak', { label: 'DPAK-style power package', kind: 'ic', status: 'photo-verified',
      desc: 'Appears to be a DPAK (TO-252 style) SMD package with a metal tab and three leads; the marking legible in the photo reads 4284V50 / GAA230. What it does on UniJack is not claimed. 2.3 mm height assumed.' });
    B(g, [225, 137, 284, 187], 2.3, { y0: 0.25, top: photo, side: M.icBlack, radius: 0.12 });
    B(g, [228, 128, 280, 137], 0.5, { y0: 1.05, top: photo, side: M.tin });               // exposed tab
    // two outer leads: sloped shoulder out of the body + foot on the pads
    for (const [x0, x1] of [[228, 238], [270, 280]]) {
      const cx = X((x0 + x1) / 2), w = mm(x1 - x0);
      slopedStrip(g, cx, w, 0.28, Z(188), 1.0, Z(197), 0.22, M.tin);
      B(g, [x0, 197, x1, 222], 0.26, { top: photo, side: M.tin });
    }
    B(g, [249, 187, 257, 193], 0.3, { y0: 0.3, top: photo, side: M.tin });               // short middle stub
  }
  {
    const g = newGroup('pad-pair-right-of-dpak', { label: 'Two small solder pads', kind: 'other', status: 'photo-derived',
      desc: 'Two small tinned pads next to the DPAK package. Footprints from the photo; relief assumed.' });
    plate(g, [293, 160, 305, 170], 0.15); plate(g, [293, 172, 305, 182], 0.15);
  }
  {
    const g = newGroup('sma-diode', { label: 'SMA-style SMD part (diode-like)', kind: 'passive', status: 'photo-derived',
      desc: 'Appears to be an SMA-sized two-terminal SMD component (black body, tinned ends). Footprint from the photo; 2.2 mm height assumed.' });
    B(g, [118, 176, 159, 199], 2.2, { y0: 0.3, top: photo, side: M.icBlack });
    B(g, [112, 181, 122, 201], 1.0, { top: photo, side: M.tin });
    B(g, [158, 180, 174, 200], 1.0, { top: photo, side: M.tin });
  }
  {
    const g = newGroup('chip-0805-J101', { label: 'Small SMD chip near J101', kind: 'passive', status: 'photo-derived', desc: 'Small chip-size SMD component. Footprint from the photo; 0.7 mm height assumed.' });
    chip(g, [124, 257, 141, 273], 0.7, 'x', M.ceramic);
  }
  {
    const g = newGroup('pads-hollow-square', { label: 'Two SMD solder pads', kind: 'other', status: 'photo-derived',
      desc: 'Two bare tinned SMD pads inside the hollow-square silkscreen outline. Footprints from the photo; relief assumed.' });
    plate(g, [165, 280, 204, 297], 0.12); plate(g, [245, 280, 286, 297], 0.12);
  }

  // =====================================================================================================
  // J101  two-position green screw terminal (two screw heads)
  // =====================================================================================================
  {
    const g = newGroup('J101-terminal', { ref: 'J101', label: 'Two-position screw terminal', kind: 'connector', status: 'photo-verified',
      desc: 'Appears to be a two-position green screw terminal block (two screw heads); the designator J101 is printed beside it and legible in the photo. Footprint from the photo. The 6.5 mm height is assumed: a rough matched-camera estimate from gallery-1 suggests a lower value (about 4 to 6 mm; the evidence is weak, so low confidence). The wire-entry side (towards the board edge) is also assumed from the 3/4 photo. The flat-lay photo shows part of this block\'s side face, so its outline and top-face pixels are approximate.' });
    const H = 6.5;                                                                                // ASSUMED (see desc)
    B(g, [27, 197, 76, 272], H, { top: photo, side: M.green, radius: 0.25 });
    B(g, [76, 197, 92, 272], H * 0.75, { top: photo, side: M.green, radius: 0.25 });             // lower rear step (photo shows a sloped rear face)
    const screws = [[52.9, 211.1, 0.12], [52.9, 231.8, -0.05]];
    for (const [sx, sy, rot] of screws) {
      prim.cylPart(g, { frame: F, r: mm(9.6), h: 0.5, pos: [X(sx), H - 0.25, Z(sy)], top: photo, side: M.steel, segments: 28 });
      const slot = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, mm(17)), M.housingDark);
      slot.position.set(X(sx), H + 0.27, Z(sy)); slot.rotation.y = rot; g.add(slot);
      // wire entry on the -x face (dark square opening)
      const ent = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.5, 2.1), M.housingDark);
      ent.position.set(X(27) - 0.02, H * 0.4, Z(sy)); g.add(ent);
    }
  }

  // =====================================================================================================
  // J400  SO-DIMM-style socket, two latches, contact tails
  // =====================================================================================================
  const SEAT_Y = 2.8, MOD_T = 1.2;                           // module underside above the board top; module thickness (assumed)
  const HOUSING_H = 5.2;                                     // typical standard-height SO-DIMM socket (assumed)
  const SLOT_LO = SEAT_Y - 0.15, SLOT_HI = SEAT_Y + MOD_T + 0.15;
  const FACE = 392, BACK = 371;                              // px: housing +x face (slot mouth) and slot back wall
  const YTOP = 22, YBOT = 647;
  const socketZ = -2.2;                                      // module centre z seated (hook pins' midpoint; assumed symmetric)
  const socketX = X(FACE) - 2.3;                             // fingers edge: ~2 mm into the 2.4 mm-deep slot, so only ~0.3 mm of gold stays visible (gallery-2); review found 0.2 mm was half-inserted

  {
    const g = newGroup('J400-socket', { ref: 'J400', label: 'SO-DIMM-style module socket', kind: 'connector', status: 'photo-verified',
      desc: 'Long grey socket for the Mercury module; the designator J400 is printed beside it, and a TE logo and a moulded part number are legible on the housing in the photo. Footprint, contact-row pitch and count are read from the photo; housing height (5.2 mm), slot height, the module seating height and the solder fillets at the contact tails are assumed typical values.' });
    // The housing is one moulding built from three segments: top edges that meet another segment flush, or meet the lip, are not bevelled
    const seg = (y0, y1, xl, nz, pz) => {
      B(g, [xl, y0, BACK, y1], HOUSING_H, { top: photo, side: M.housing, edges: { nz, pz, px: false } });
      B(g, [BACK, y0, FACE, y1], SLOT_LO, { top: null, side: M.housing, edges: { nz, pz, nx: false } });                     // lower plate
      B(g, [BACK, y0, FACE, y1], HOUSING_H - SLOT_HI, { y0: SLOT_HI, top: photo, side: M.housing, bevel: 0.2, edges: { nz, pz, nx: false } });   // top lip over the slot
    };
    seg(YTOP, 52, 328, true, false); seg(52, 613, 341, false, false); seg(613, YBOT, 328, false, true);
    B(g, [BACK - 2, 52, BACK + 1, 613], SLOT_HI - SLOT_LO, { y0: SLOT_LO, side: M.housingDark });     // dark slot back wall
    B(g, [328, 52, 341, 80], 2.0, { top: photo, side: M.housingDark, edges: { px: false, nz: false } });   // dark side post (top-left): flush against the housing wall (+x) and the top segment (-z), so no bevel groove there
    B(g, [329, 369, 340, 385], 1.1, { top: photo, side: M.housingDark, sharp: true });                      // keying block (left), flush against the housing wall

    // contact tails: photo shows a left row and two staggered rows on the mouth side (pitch ~4.03-4.2 px, >=129 per row)
    const tails = { left: [], rowA: [], rowB: [] }, slotA = [], slotB = [];
    const rowY = (n, y0, y1) => Array.from({ length: n }, (_, k) => y0 + (k * (y1 - y0)) / (n - 1));
    // tails are flat feet with an assumed concave toe fillet INSIDE the photo-traced extent (prim.footGeometry: box + fillet span the
    // instance length exactly, fillet at most 0.3 mm; the fillet sits on the unit's +x end, so left-row feet are turned round)
    const foot = (lenPx) => prim.footGeometry(prim.footFrac(mm(lenPx)));
    for (const y of [...rowY(73, 77.5, 367), ...rowY(56, 387.5, 611)]) {
      tails.left.push({ p: [X(335), 0.06, Z(y)], s: [mm(12), 0.12, 0.27], ry: Math.PI });
      tails.left.push({ p: [X(340.2), 0.3, Z(y)], s: [0.2, 0.55, 0.27], ry: Math.PI });
    }
    // row A (dark) ends at px 410.2, just short of row B's start (410.3), so the two interleaved rows never touch
    for (const y of rowY(131, 58, 607)) { tails.rowA.push({ p: [X(401.6), 0.06, Z(y)], s: [mm(17.2), 0.12, 0.27] }); slotA.push({ p: [X(381), SLOT_LO + 0.06, Z(y)], s: [mm(18), 0.1, 0.26] }); }
    for (const y of rowY(128, 83, 613)) { tails.rowB.push({ p: [X(415.5), 0.06, Z(y)], s: [mm(10.5), 0.12, 0.27] }); slotB.push({ p: [X(381), SLOT_HI - 0.07, Z(y)], s: [mm(18), 0.1, 0.26] }); }
    prim.instanced(g, foot(12), M.tin, tails.left, 'J400-tails-left');
    prim.instanced(g, foot(17.2), M.darkContact, tails.rowA, 'J400-tails-mouth-A');
    prim.instanced(g, foot(10.5), M.tin, tails.rowB, 'J400-tails-mouth-B');
    prim.instanced(g, prim.UNIT_BOX, M.gold, slotA, 'J400-slot-contacts-lower');
    prim.instanced(g, prim.UNIT_BOX, M.gold, slotB, 'J400-slot-contacts-upper');
  }

  // latch clips: built in board-local coordinates (so the photo UVs are right), then re-origined at the pivot
  const latches = [];
  const makeLatch = (name, desc, pivotPx, build, axis, openAngle) => {
    const obj = new THREE.Group(); obj.name = name;
    build(obj);
    const px = X(pivotPx[0]), pz = Z(pivotPx[1]);
    obj.children.forEach((c) => { c.position.x -= px; c.position.z -= pz; });
    obj.position.set(px, 0, pz);
    group.add(obj);
    meta(obj, { label: name.includes('top') ? 'J400 latch clip (top end)' : 'J400 latch clip (bottom end)', kind: 'latch', status: 'assumed', desc });
    obj.userData.openAngle = openAngle;
    latches.push({ obj, axis, openAngle });
    return obj;
  };
  const ARM_Y0 = SLOT_HI + 0.25, ARM_T = 0.55;              // arm plate sits above the seated module top (assumed); stamped steel: sharp edges
  const HOOK_Y0 = SLOT_HI, HOOK_H = 1.2;
  const OPEN = THREE.MathUtils.degToRad(5);
  const hookPin = (parent, cxPx, zPx0, zPx1) => {
    const len = mm(zPx1 - zPx0);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, len, 20), M.steel);
    m.rotation.x = Math.PI / 2; m.position.set(X(cxPx), ARM_Y0 + 0.55, Z((zPx0 + zPx1) / 2));
    m.castShadow = true; parent.add(m);
  };
  const latchDesc = 'Spring clip at one end of the socket. From the photos it appears to hold the module down with a hook pin engaging a notch at the module end. Pivot location, the 5 degree opening angle and the plating colour are assumed (kinematics are not visible in the photos).';
  makeLatch('J400-latch-top', latchDesc, [FACE, 35], (o) => {
    B(o, [FACE, 24, 562, 46], ARM_T, { y0: ARM_Y0, top: photo, side: M.latch, sharp: true });
    B(o, [FACE, 46, 421, 52], ARM_T, { y0: ARM_Y0, top: photo, side: M.latch, sharp: true });
    B(o, [470, 49, 502, 55], 0.45, { y0: ARM_Y0, top: photo, side: M.steel, sharp: true });
    B(o, [FACE, 22.4, 562, 24.2], 1.65, { y0: ARM_Y0 + ARM_T - 1.65, top: photo, side: M.latch });          // outer web: gives the clip its L profile
    B(o, [548, 26, 566, 46], HOOK_H, { y0: HOOK_Y0, top: photo, side: M.latch });
    hookPin(o, 569, 28, 47);
  }, [0, 1, 0], OPEN);
  makeLatch('J400-latch-bottom', latchDesc, [FACE, 625], (o) => {
    B(o, [FACE, 617, 562, 633], ARM_T, { y0: ARM_Y0, top: photo, side: M.latch, sharp: true });
    B(o, [FACE, 633, 433, 647], ARM_T, { y0: ARM_Y0, top: photo, side: M.latch, sharp: true });
    B(o, [435, 633, 505, 646], 0.45, { y0: ARM_Y0, top: photo, side: M.steel, sharp: true });
    B(o, [517, 633, 535, 643], 0.45, { y0: ARM_Y0, top: photo, side: M.steel, sharp: true });
    B(o, [FACE, 646, 535, 647.8], 1.65, { y0: ARM_Y0 + ARM_T - 1.65, top: photo, side: M.latch });          // outer web
    B(o, [548, 609, 566, 629], HOOK_H, { y0: HOOK_Y0, top: photo, side: M.latch });
    hookPin(o, 569, 615, 628);
  }, [0, -1, 0], OPEN);
  {
    const g = newGroup('J400-solder-tab', { label: 'Latch solder tab', kind: 'other', status: 'photo-derived',
      desc: 'Small tinned SMD tab below the bottom latch clip. Footprint from the photo; relief assumed.' });
    plate(g, [433, 648, 465, 665], 0.25, M.steel);
  }
  {
    // Cosmetic only: hides the closed-latch pixels baked into the photo while the latches are open (model.js shows it only then).
    const g = newGroup('J400-latch-ghost-cover', { label: 'Board texture patch (not a part)', kind: 'board', status: 'assumed',
      desc: 'Cosmetic decal shown only while the socket latches are open. The flat-lay photo has the closed latch arms and hooks baked into it; this patch covers them with plain solder-mask pixels copied from a clean region of the same photo, tone-matched and feathered at the edges. What lies under a latch arm is not photographed, so nothing drawn by the patch is real copper or silkscreen. Not a physical part.' });
    // top latch (arm y 24..57, hook ghost x 552..582): fill from the plain strip above the arm, stretched; the silkscreen line at x 568..572 is left alone (real from y 49 down)
    const topSrc = [428, 8, 490, 20], topBox = [424, 24, 582, 57];
    latchPatch(g, { name: 'latch-patch-top',
      pieces: [{ b: [424, 24, 560, 57], f: [5, 1.5, 0, 5] }, { b: [552, 24, 582, 47], f: [0, 1.5, 5, 2] }],
      map: linMap(topBox, topSrc),
      gain: { box: topBox, c: [toneGain([428, 8, 454, 20], [424, 10, 450, 20]), toneGain([464, 8, 490, 20], [584, 32, 598, 46]),
                               toneGain([428, 8, 454, 20], [424, 58, 450, 64]), toneGain([464, 8, 490, 20], [584, 50, 598, 64])] } });
    // bottom latch (arm y 606..648): fill from the same rows to the right (x + 158, mirrored back at x = 722), which carries the same horizontal
    // trace lines and tone; the white silkscreen line at x 568..572 is real above and below the hook, so a real strip of it is redrawn across the hidden part
    const botBox = [424, 604, 582, 648];
    const botX = (x) => { const r = x + 158; return r > 722 ? 722 - (r - 722) : r; };
    latchPatch(g, { name: 'latch-patch-bottom',
      pieces: [{ b: [424, 606, 556, 648], f: [5, 0, 0, 4] }, { b: [550, 604, 582, 634], f: [0, 2, 5, 0] }],
      map: (x, y) => [botX(x), y],
      gain: { box: botBox, c: [toneGain([582, 592, 608, 603], [424, 592, 450, 603]), toneGain([676, 592, 700, 603], [586, 592, 610, 603]),
                               toneGain([628, 650, 678, 657], [470, 650, 520, 657]), toneGain([676, 636, 700, 646], [586, 636, 610, 646])] } });
    latchPatch(g, { name: 'latch-patch-bottom-line', pieces: [{ b: [568, 604, 573, 634] }], y: 0.05,
      map: (x, y) => [x, 585 + ((y - 604) / 30) * 16] }).renderOrder = 2;
  }

  // =====================================================================================================
  // TSSOP-48 level shifters, left group of three = ICs 1 to 3 of six (the right group, base-right.js, is 4 to 6).
  // Marking LVC16T245 legible in the photo.
  // =====================================================================================================
  {
    const bodies = [[467, 84, 521, 186], [467, 191, 521, 294], [467, 303, 521, 404]];
    bodies.forEach((b, i) => {
      const n = i + 1;
      const g = newGroup(`TSSOP48-${n}`, { label: `TSSOP-48-style IC ${n}`, kind: 'ic', status: 'photo-verified',
        desc: `One of six similar 48-lead TSSOP-style packages on the base board (24 gull-wing leads per long side counted in the photo); numbered 1 to 6 here only to tell them apart. This is number ${n}, in the left-hand group of three (1 to 3), which sits under the Mercury module when the kit is assembled; the right-hand group is 4 to 6. The marking legible in the photo includes LVC16T245; what the chip does on UniJack is not claimed. Body height 1.1 mm, the gull-wing lead shape and the solder fillets at each foot are assumed.` });
      const o = F.box(b);
      B(g, b, 1.05, { y0: 0.12, top: photo, side: M.icBlack, radius: 0.12 });
      prim.gullLeads(g, M.tin, { cx: o.cx, cz: o.cz, bodyW: o.w, bodyD: o.d, sides: 'x', n: 24, pitch: mm(4.03), leadLen: 1.5, leadW: 0.26, leadT: 0.14, yMid: 0.5, name: `TSSOP48-${n}-leads` });
    });
  }

  // =====================================================================================================
  // J304 USB-A (single, horizontal) - hollow steel shell, cream tongue, gold contacts
  // =====================================================================================================
  {
    const g = newGroup('J304-usb', { ref: 'J304', label: 'USB-A-style receptacle', kind: 'connector', status: 'photo-verified',
      desc: 'Appears to be a single horizontal USB-A-style receptacle (one opening, steel shell); the designator J304 is printed beside it and legible in the photo. Footprint from the photo; the 6.3 mm height, the open front towards the board edge and the cream tongue are assumed from the 3/4 photo. The flat-lay photo also shows some of this part\'s side faces along the edges of its top-face pixels, so its outline and top-face pixels are approximate.' });
    const b = [5, 343, 171, 452], H = 6.3, T = 0.35;
    B(g, b, T, { y0: H - T, top: photo, side: M.shell });                                      // top plate (photo: springs, windows); its edges get the folded-sheet half-round automatically (assumed radius)
    B(g, [5, 343, 171, 343 + 4], H - T - 0.2, { y0: 0.2, side: M.shell });                     // side walls
    B(g, [5, 452 - 4, 171, 452], H - T - 0.2, { y0: 0.2, side: M.shell });
    B(g, [167, 343, 171, 452], H - T - 0.2, { y0: 0.2, side: M.shell });                       // rear wall
    B(g, [5, 343, 171, 452], 0.3, { y0: 0.2, side: M.rj45Carrier, sharp: true });               // bottom plate
    // tongue (cream plastic) with four gold contacts
    B(g, [14, 350, 120, 445], 1.6, { y0: 1.6, side: M.cream });
    const o = F.box([14, 350, 120, 445]);
    for (let k = 0; k < 4; k++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(o.w * 0.82, 0.08, 0.6), M.gold);
      m.position.set(o.cx + o.w * 0.04, 3.24, o.cz + (k - 1.5) * 2.3); g.add(m);
    }
  }

  // =====================================================================================================
  // J303 RJ45 (hollow steel shell, open front, dark contact carrier, 8 gold contacts, two lamps, rear tails)
  // =====================================================================================================
  {
    const g = newGroup('J303-rj45', { ref: 'J303', label: 'RJ45-style jack', kind: 'connector', status: 'photo-verified',
      desc: 'Appears to be a shielded RJ45-style jack: steel shell, open front towards the board edge, eight gold contacts and two green lamps visible in the 3/4 photo, and rear SMD tails; the designator J303 is printed beside it and legible in the photo. Footprint from the photo. The 11.0 mm height is assumed: a rough matched-camera estimate from gallery-1 suggests a lower value (roughly 6 to 10 mm depending on the camera fit; low to medium confidence). The solder fillets at the rear tails are assumed. The flat-lay photo also shows some of this jack\'s side faces (tan wires and frame edges appear along the lower and front edges of its top-face pixels), so its outline and top-face pixels are approximate.' });
    const b = [13, 518, 165, 680], H = 11.0, T = 0.4;                                          // H ASSUMED (see desc)
    B(g, b, T, { y0: H - T, top: photo, side: M.shell });                                      // top plate
    B(g, [13, 518, 165, 522], H - T - 0.2, { y0: 0.2, side: M.shell });
    B(g, [13, 676, 165, 680], H - T - 0.2, { y0: 0.2, side: M.shell });
    B(g, [161, 518, 165, 680], H - T - 0.2, { y0: 0.2, side: M.shell });
    B(g, [13, 518, 165, 680], 0.3, { y0: 0.2, side: M.rj45Carrier, sharp: true });
    // front frame (keeps the opening ~13.7 mm wide x 7.5 mm tall)
    const oz0 = 540, oz1 = 658, oy0 = 1.8, oy1 = 9.3;
    B(g, [13, 518, 22, oz0], H - 0.6, { y0: 0.2, side: M.shell });
    B(g, [13, oz1, 22, 680], H - 0.6, { y0: 0.2, side: M.shell });
    B(g, [13, oz0, 22, oz1], oy0 - 0.2, { y0: 0.2, side: M.shell });
    B(g, [13, oz0, 22, oz1], H - T - oy1, { y0: oy1, side: M.shell });
    // dark plastic liners inside the cavity (walls + ceiling) so the opening reads as a plastic-lined port
    B(g, [22, 522, 108, 526], H - T - 0.5, { y0: 0.5, side: M.rj45Carrier });
    B(g, [22, 672, 108, 676], H - T - 0.5, { y0: 0.5, side: M.rj45Carrier });
    B(g, [22, 522, 108, 676], 0.3, { y0: H - T - 0.3, side: M.rj45Carrier });
    // dark plastic contact carrier at the back of the cavity + 8 gold contacts
    B(g, [108, oz0, 161, oz1], 7.4, { y0: 0.5, side: M.rj45Carrier });
    const oc = F.box([22, oz0, 108, oz1]);
    const items = [];
    for (let k = 0; k < 8; k++) items.push({ p: [oc.cx + oc.w * 0.08, 6.6, oc.cz + (k - 3.5) * 1.19], s: [oc.w * 0.84, 0.12, 0.3] });
    prim.instanced(g, prim.UNIT_BOX, M.gold, items, 'J303-contacts');
    // two lamps at the front corners
    for (const zc of [529, 669]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.2, mm(10)), M.lampGreen);
      m.position.set(X(13) - 0.03, H - 1.4, Z(zc)); g.add(m);
    }
    // rear SMD tails (12 leads read from the photo)
    const ys = [554, 565.6, 584.4, 592.9, 601.3, 609.8, 618.2, 626.7, 635, 642, 659, 669.3];
    const tl = [];
    for (const y of ys) { tl.push({ p: [X(179), 0.08, Z(y)], s: [mm(27), 0.16, mm(6)] }); tl.push({ p: [X(164), 0.6, Z(y)], s: [mm(3), 1.2, mm(6)], ry: Math.PI }); }
    prim.instanced(g, prim.footGeometry(prim.footFrac(mm(27))), M.tin, tl, 'J303-tails');       // flat feet with an assumed 0.3 mm toe fillet inside the traced tip
    plate(g, [47, 678, 95, 693], 0.25, M.steel);                                                // shield tab on the board (photo: tarnished tab)
  }
  {
    const g = newGroup('rj45-neighbour-ICs', { label: 'Two small 8-lead ICs near J303', kind: 'ic', status: 'photo-derived',
      desc: 'Two very small 8-lead SMD packages beside the RJ45 rear tails (four tiny leads per side). Footprints from the photo; 0.9 mm height, lead shape and solder fillets assumed; markings are not legible.' });
    for (const b of [[207, 587, 218, 603], [207, 621, 218, 637]]) {
      const o = F.box(b);
      B(g, b, 0.9, { y0: 0.1, top: photo, side: M.icBlack });
      prim.gullLeads(g, M.tin, { cx: o.cx, cz: o.cz, bodyW: o.w, bodyD: o.d, sides: 'x', n: 4, pitch: mm(4.8), leadLen: 0.3, leadW: 0.24, leadT: 0.1, yMid: 0.35, name: 'small-IC-leads' });
    }
  }

  // =====================================================================================================
  // LED row (8 tiny SMD LEDs) - instanced bodies + pads
  // =====================================================================================================
  {
    const g = newGroup('LED-row', { label: 'Row of eight LED-style SMD parts', kind: 'led', status: 'photo-derived',
      desc: 'Eight tiny chip-style parts along the bottom edge (cream bodies, tinned pads) that appear to be LEDs. Positions read from the photo; 0.75 mm height assumed; function not claimed.' });
    const xs = [216, 259.5, 303, 346.6, 390.8, 435, 479, 522.5], cy = 681;
    const bodies = xs.map((x) => ({ p: [X(x), 0.4, Z(cy)], s: [mm(14), 0.8, mm(9)] }));
    const pads = [];
    for (const x of xs) for (const s of [-1, 1]) pads.push({ p: [X(x), 0.14, Z(cy + s * 6.5)], s: [mm(3.2), 0.28, mm(19)], ry: s > 0 ? -Math.PI / 2 : Math.PI / 2 });   // fillet on the outer side, inside the pad extent
    prim.instanced(g, prim.UNIT_BOX, M.ledBody, bodies, 'LED-bodies');
    prim.instanced(g, prim.footGeometry(prim.footFrac(mm(3.2))), M.tin, pads, 'LED-pads');
  }

  // small 0805 cap at the top edge next to the latch (x 508..520, y 12..25)
  {
    const g = newGroup('chip-top-edge', { label: 'Small SMD capacitor-size chip', kind: 'passive', status: 'photo-derived', desc: 'Chip-size SMD component above the top latch arm. Footprint from the photo; 0.8 mm height assumed.' });
    chip(g, [507, 12, 521, 25], 0.8, 'x', M.ceramic);
  }

  uniqueNames(group, 'base');
  return {
    anchors: { socket: { x: socketX, z: socketZ, seatY: SEAT_Y } },
    latches,
  };
}
