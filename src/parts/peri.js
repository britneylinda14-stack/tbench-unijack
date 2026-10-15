// PeriBoard builder (key: peri). See CONTRACT.md.
//
// What is on the board, as seen in the photos (gallery-1 3/4 view, gallery-2/3 top-down):
//   * three cream two-row board-to-board receptacles: J201 (top edge), J301 (left), J101 (bottom edge);
//   * sixteen identical small surface-mount pin headers J1..J16 (J1-J15 in a 3 x 5 grid, J16 alone top right),
//     each 2 columns x 5 rows = 10 gold pins standing up out of a short black body, with gull-wing feet on pads.
// Everything is placed from pixel coordinates read off assets/tex/peri-top.webp (20 px per mm), so the footprints
// can be checked against the photo with tools/overlay.py. Heights are NOT visible top-down: they are assumed values
// judged from the 3/4 photo (gallery-1) and are stated as assumed. Footprints and lead/pad positions are photo-derived.
// SCALE: this file works in the uniform 20 px/mm space of the texture; src/model.js rectifies the whole board by model/true
// scale (17.57 px/mm measured from the connector pitch, x and z alike) when it assembles the kit. Heights (y) are not scaled.
//
// Geometry strategy (keeps the mesh count low): each physical part is one Group; its cream housing / black body is ONE
// merged mesh built from boxes (tops of housing pieces are projected from the photo so the top looks like the photo),
// contacts and leads are instanced, the 16 headers share three geometries.

import { planarUV } from '../lib/frame.js';

// ---------------------------------------------------------------- assumed heights (mm): every one of these is ASSUMED
// (not visible top-down). Each was matched by eye and by a camera fitted to the PeriBoard plane in gallery-1; the fit gives
// a range because the PCB edge strip (a built-in ruler) and the fitted camera disagree by about 12 percent.
const H_HOUSING = 2.15;     // receptacle outer wall height above the PCB top (range about 1.9 to 2.4)
const H_ISLAND = 1.8;       // central island is a little lower than the walls
const H_FLOOR = 0.5;        // slot floor
const H_EAR = 1.0;          // end ears (hold-down brackets)
const H_TAB = 0.4;          // solder tabs
const CONTACT_H = 1.0;      // slot contact height above the slot floor (kept below the island top)
const HDR_BODY = 1.8;       // pin-header plastic body (low, dark; partly hidden by the pins and their shadow in gallery-1)
const HDR_PIN_TOP = 4.5;    // pin tip height above the PCB (about 4 to 5 mm from the gallery-1 camera fit)

export function build(ctx) {
  const { THREE, prim, mat, frames, tex, BOARD_T } = ctx;
  const F = frames.peri;
  const g = new THREE.Group(); g.name = 'peri';
  prim.boardSlab(g, { frame: F, topTex: tex.peri, mats: mat, thickness: BOARD_T, box: ctx.scale.board_px_box?.peri });

  // ---------------------------------------------------------------- materials
  const photo = mat.photoTop(tex.peri, { roughness: 0.5, env: 0.45 });      // one shared photo material
  const cream = new THREE.MeshStandardMaterial({ color: '#e4dfd0', roughness: 0.42, metalness: 0 });
  const darkBody = new THREE.MeshStandardMaterial({ color: '#1b1e22', roughness: 0.5, metalness: 0 });
  const tabSide = new THREE.MeshStandardMaterial({ color: '#9aa0a5', roughness: 0.45, metalness: 0.6 });
  const pinGold = new THREE.MeshStandardMaterial({ color: '#e2bf68', roughness: 0.28, metalness: 0.9 });
  const footTin = mat.tin;
  const footDark = new THREE.MeshStandardMaterial({ color: '#4a5056', roughness: 0.6, metalness: 0.5 });   // far-row tips: dark in the photo
  const contactBronze = new THREE.MeshStandardMaterial({ color: '#9b7a3c', roughness: 0.4, metalness: 0.75 }); // slot contacts read bronze in the photo

  // ---------------------------------------------------------------- merged-box geometry helper
  // A box is { c:[A,B,C,D] (mm corners: A=(x0,z0) B=(x1,z0) C=(x1,z1) D=(x0,z1)), y0, y1, taper, photo }.
  const quadTo = (arr, a, b, c, d) => {
    for (const [p, q, r] of [[a, b, c], [a, c, d]]) {
      arr.pos.push(...p, ...q, ...r);
      const ux = q[0] - p[0], uy = q[1] - p[1], uz = q[2] - p[2], vx = r[0] - p[0], vy = r[1] - p[1], vz = r[2] - p[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      for (let i = 0; i < 3; i++) arr.nor.push(nx, ny, nz);
    }
  };
  const inset = (cs, t) => {
    const n = (a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1; return [dx / l * t, dz / l * t]; };
    const [A, B, C, D] = cs;
    const add = (P, u, v) => [P[0] + u[0] + v[0], P[1] + u[1] + v[1]];
    return [add(A, n(A, B), n(A, D)), add(B, n(B, A), n(B, C)), add(C, n(C, D), n(C, B)), add(D, n(D, C), n(D, A))];
  };
  // Boxes at least prim.EDGE_MIN_H tall (and not tapered) get a soft bevel on the top edges that no flush or taller box of the same
  // batch meets (prim.freeEdges), so a housing assembled from several boxes keeps a continuous top. ASSUMED detail: the photos show
  // softly rounded housing edges but no radius is measurable. A box may also be { fillet: { o: [x, z], ry, L, H, W } } = a concave
  // tinned solder fillet (prim.filletTris) in the side material.
  function mergeBoxes(boxes, { uvFrame = null } = {}) {
    const side = { pos: [], nor: [] }, top = { pos: [], nor: [] };
    const rectOf = (bx) => { const [A, B, D] = [bx.c[0], bx.c[1], bx.c[3]], W = Math.hypot(B[0] - A[0], B[1] - A[1]), Dd = Math.hypot(D[0] - A[0], D[1] - A[1]);
      return { o: A, u: [(B[0] - A[0]) / W, (B[1] - A[1]) / W], v: [(D[0] - A[0]) / Dd, (D[1] - A[1]) / Dd], W, D: Dd, y0: bx.y0 ?? 0, y1: bx.y1 }; };
    const rects = boxes.filter((bx) => !bx.fillet && !(bx.taper > 0)).map(rectOf);
    for (const bx of boxes) {
      if (bx.fillet) { const F = bx.fillet; prim.appendTris(side, prim.placeTris(prim.filletTris(F.L, F.H, F.W), [F.o[0], F.y0 ?? 0, F.o[1]], F.ry || 0)); continue; }   // 3 segments above 0.25 mm
      const bot = bx.c, tp = bx.taper > 0 ? inset(bot, bx.taper) : bot, y0 = bx.y0 ?? 0, y1 = bx.y1;
      if (!(bx.taper > 0) && !bx.sharp) {
        const r = rectOf(bx), c = bx.bevel ?? prim.autoBevel(r.W, y1 - y0, r.D);
        const bt = c > 0 ? prim.bevelBoxTris({ ...r, c, edges: prim.freeEdges(rects, rects.findIndex((q) => q.o === bx.c[0])), bottom: false }) : null;
        if (bt) { prim.appendTris(side, bt.side); prim.appendTris(bx.photo ? top : side, bt.top); continue; }
      }
      const b = (i) => [bot[i][0], y0, bot[i][1]], u = (i) => [tp[i][0], y1, tp[i][1]];
      quadTo(side, b(2), b(1), u(1), u(2));            // +x side
      quadTo(side, b(0), b(3), u(3), u(0));            // -x side
      quadTo(bx.photo ? top : side, u(3), u(2), u(1), u(0));   // +y top
      quadTo(side, b(3), b(2), u(2), u(3));            // +z side
      quadTo(side, b(1), b(0), u(0), u(1));            // -z side
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([...side.pos, ...top.pos], 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute([...side.nor, ...top.nor], 3));
    geo.addGroup(0, side.pos.length / 3, 0);
    if (top.pos.length) geo.addGroup(side.pos.length / 3, top.pos.length / 3, 1);
    if (uvFrame) planarUV(geo, uvFrame);
    geo.computeBoundingSphere(); geo.computeBoundingBox();
    return geo;
  }
  const meshOf = (geo, mats, name) => {
    const m = new THREE.Mesh(geo, mats); m.name = name; m.castShadow = m.receiveShadow = true; return m;
  };
  const rectMM = (cx, cz, w, d) => [[cx - w / 2, cz - d / 2], [cx + w / 2, cz - d / 2], [cx + w / 2, cz + d / 2], [cx - w / 2, cz + d / 2]];

  // ---------------------------------------------------------------- receptacle (J201 / J301 / J101)
  // Coordinates are texture pixels. `a` is the small in-plane tilt of the connector in the texture (rad), applied about
  // `pivot`; rectangles in `frame` coordinates are rotated with it, rectangles in `meas` are read at their actual
  // (already tilted) place in the photo and are un-rotated first so they land back where they were read.
  function receptacle(spec) {
    const { ref, orient, pivot, a, frameRects, measRects, leads, contacts, tabs } = spec;
    const ca = Math.cos(a), sa = Math.sin(a);
    const rot = (x, y) => { const dx = x - pivot[0], dy = y - pivot[1]; return [pivot[0] + dx * ca - dy * sa, pivot[1] + dx * sa + dy * ca]; };
    const unrot = (x, y) => { const dx = x - pivot[0], dy = y - pivot[1]; return [pivot[0] + dx * ca + dy * sa, pivot[1] - dx * sa + dy * ca]; };
    const mm = ([x, y]) => [F.x(x), F.z(y)];
    // px rectangle (unrotated frame) -> rotated mm corners
    const corners = (x0, y0, x1, y1) => [rot(x0, y0), rot(x1, y0), rot(x1, y1), rot(x0, y1)].map(mm);
    const measCorners = (x0, y0, x1, y1) => {
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, [ux, uy] = unrot(cx, cy), w = x1 - x0, h = y1 - y0;
      return corners(ux - w / 2, uy - h / 2, ux + w / 2, uy + h / 2);
    };
    const grp = new THREE.Group();

    const housing = [], tabBoxes = [];
    for (const r of frameRects) housing.push({ c: corners(...r.r), y0: r.y0 ?? 0, y1: r.y1, photo: r.photo ?? true });
    for (const r of measRects) housing.push({ c: measCorners(...r.r), y0: r.y0 ?? 0, y1: r.y1, photo: r.photo ?? true });
    for (const r of tabs) tabBoxes.push({ c: measCorners(...r), y0: 0, y1: H_TAB, photo: true });
    const hm = meshOf(mergeBoxes(housing, { uvFrame: F }), [cream, photo], 'housing'); grp.add(hm);
    const tm = meshOf(mergeBoxes(tabBoxes, { uvFrame: F }), [tabSide, photo], 'solder-tabs'); grp.add(tm);

    // instanced leads (flat foot on the PCB + a thin riser up the wall) and gold contacts in the slots
    const map = (u, v) => (orient === 'h' ? [u, v] : [v, u]);            // (along, across) -> texture px
    // Each lead row may carry its own start offset u0 and pitch (the texture is a warped photo, so the two rows of one connector
    // can differ by a pixel or two); `dark` rows use a dark tin because the photo shows only dark hairline tips there.
    const leadGroups = new Map(), contactItems = [];                      // one instanced mesh per (material, fillet fraction)
    const T = 0.12, LW = 0.26, RISER = 0.9, ry = -a;
    for (const row of leads.rows) {
      const dir = Math.sign(row.tip - row.base) || 1, lenMM = Math.abs(row.tip - row.base) / F.s;
      // feet are prim.footGeometry (flat foot + an assumed concave toe fillet on the unit's +x end, together spanning the unit
      // length, fillet at most 0.3 mm): an instance scaled to lenMM spans exactly base..tip, so the connector's extent (used by the
      // mating fit) is unchanged. Turn the unit's +x towards the lead tip.
      const frac = prim.footFrac(lenMM), key = `${row.dark ? 'dark' : 'tin'}|${frac.toFixed(3)}`;
      if (!leadGroups.has(key)) leadGroups.set(key, { dark: !!row.dark, geo: prim.footGeometry(frac), items: [] });
      const items = leadGroups.get(key).items;
      const u0 = row.u0 ?? leads.u0, pitch = row.pitch ?? leads.pitch;
      const phi = orient === 'h' ? (dir > 0 ? -Math.PI / 2 : Math.PI / 2) : (dir > 0 ? 0 : Math.PI);
      for (let i = 0; i < leads.n; i++) {
        const u = u0 + i * pitch;
        const [cx, cy] = mm(rot(...map(u, row.base + dir * 0.5 * lenMM * F.s)));
        items.push({ p: [cx, T / 2, cy], s: [lenMM, T, LW], ry: ry + phi });
        const [rx, rz] = mm(rot(...map(u, row.base + dir * 0.06 * F.s)));
        items.push({ p: [rx, RISER / 2, rz], s: [0.1, RISER, LW], ry: ry + phi });
      }
    }
    for (const row of contacts.rows) {
      const u0 = row.u0 ?? contacts.u0, pitch = row.pitch ?? contacts.pitch;
      for (let i = 0; i < contacts.n; i++) {
        const u = u0 + i * pitch;
        const [cx, cy] = mm(rot(...map(u, row.v)));
        contactItems.push({ p: [cx, H_FLOOR + contacts.h / 2, cy], s: orient === 'h' ? [0.2, contacts.h, 0.13] : [0.13, contacts.h, 0.2], ry });
      }
    }
    let li = 0;
    for (const { dark, geo, items } of leadGroups.values()) prim.instanced(grp, geo, dark ? footDark : footTin, items, dark ? 'leads-dark' : (li++ ? `leads-${li}` : 'leads'));
    prim.instanced(grp, prim.UNIT_BOX, contactBronze, contactItems, 'contacts');
    prim.meta(grp, {
      ref, kind: 'connector', status: 'photo-verified',
      label: `Board-to-board receptacle ${ref}`,
      desc: `Appears to be a two-row board-to-board receptacle: about ${leads.n} leads per row counted in the photo (the lead pitch is about 11.1 px in the photo texture; the board's millimetre scale rests on an assumed 0.635 mm connector pitch, so a pitch in mm is an assumption here, not a measurement). The designator ${ref} is printed on the board and legible in the photo. Footprint is photo-derived; wall height about ${H_HOUSING} mm, slot depth, contact shapes and the solder fillets at the lead tips are assumed.`,
    });
    return grp;
  }

  const SLOTC = { n: 50, h: CONTACT_H };   // 50 contacts per row, same pitch and offset as the leads (they are the same pins)

  // J201 - along the top edge (texture x 55..757, y 55..195)
  g.add(receptacle({
    ref: 'J201', orient: 'h', pivot: [100, 116], a: -0.029,
    frameRects: [
      { r: [98, 70, 722, 165], y1: H_FLOOR },                     // slot floor
      { r: [98, 70, 722, 88], y1: H_HOUSING },                    // far wall
      { r: [98, 150, 722, 165], y1: H_HOUSING },                  // near wall
      { r: [98, 70, 130, 165], y1: H_HOUSING },                   // left end block
      { r: [706, 70, 722, 165], y1: H_HOUSING },                  // right end block
      { r: [130, 101, 706, 132], y1: H_ISLAND },                  // central island
      { r: [55, 81, 98, 112], y1: H_EAR },                        // left ears
      { r: [55, 161, 98, 195], y1: H_EAR },
      { r: [74, 112, 98, 161], y1: H_EAR },
    ],
    measRects: [
      { r: [722, 55, 757, 141], y1: H_HOUSING * 0.9 },            // right end cap
      { r: [722, 141, 750, 170], y1: H_EAR },
    ],
    tabs: [[42, 121, 64, 155], [741, 94, 760, 130]],
    // 50 leads per row, pitch 11.09 px, first lead at u = 130.5 (comb-fitted on the near row; the far row's dark tips sit at the same u)
    leads: { n: 50, u0: 130.5, pitch: 11.09, rows: [{ base: 170, tip: 196 }, { base: 72, tip: 62, dark: true }] },
    contacts: { ...SLOTC, u0: 130.5, pitch: 11.09, rows: [{ v: 98 }, { v: 138 }] },
  }));

  // J101 - along the bottom edge (texture x 50..787, y 1392..1528)
  g.add(receptacle({
    ref: 'J101', orient: 'h', pivot: [100, 1466], a: -0.014,
    frameRects: [
      { r: [100, 1420, 742, 1513], y1: H_FLOOR },
      { r: [100, 1420, 742, 1433], y1: H_HOUSING },
      { r: [100, 1496, 742, 1513], y1: H_HOUSING },
      { r: [100, 1420, 142, 1513], y1: H_HOUSING },
      { r: [724, 1420, 742, 1513], y1: H_HOUSING },
      { r: [142, 1446, 724, 1484], y1: H_ISLAND },
      { r: [66, 1400, 100, 1420], y1: H_EAR },
      { r: [66, 1500, 100, 1520], y1: H_EAR },
      { r: [84, 1420, 100, 1500], y1: H_EAR },
    ],
    measRects: [
      { r: [742, 1400, 768, 1518], y1: H_HOUSING * 0.9 },
    ],
    tabs: [[50, 1442, 80, 1480], [756, 1442, 786, 1480]],
    // 50 leads per row, pitch 11.15 px, first lead at u = 146.8 (phase read off the slot contacts and lead bars of both rows)
    leads: { n: 50, u0: 146.8, pitch: 11.15, rows: [{ base: 1418, tip: 1392 }, { base: 1512, tip: 1528 }] },
    contacts: { ...SLOTC, u0: 147, pitch: 11.15, rows: [{ v: 1440 }, { v: 1489 }] },
  }));

  // J301 - vertical on the left (texture x 83..214, y 295..1022); `frame` coordinates are (x, y) px as well
  g.add(receptacle({
    ref: 'J301', orient: 'v', pivot: [152, 650], a: -0.02,
    frameRects: [
      { r: [111, 335, 204, 985], y1: H_FLOOR },
      { r: [111, 335, 127, 985], y1: H_HOUSING },
      { r: [194, 335, 204, 985], y1: H_HOUSING },
      { r: [111, 335, 204, 358], y1: H_HOUSING },
      { r: [111, 940, 204, 985], y1: H_HOUSING },
      { r: [136, 358, 175, 940], y1: H_ISLAND },
    ],
    measRects: [
      { r: [85, 308, 125, 340], y1: H_EAR },
      { r: [158, 307, 200, 335], y1: H_HOUSING * 0.9 },
      { r: [95, 975, 125, 1005], y1: H_EAR },
      { r: [158, 975, 205, 1000], y1: H_HOUSING * 0.9 },
    ],
    tabs: [[125, 295, 160, 326], [128, 993, 170, 1022]],
    // 50 leads per column; the two columns are fitted separately (left u0 384.25 / 11.10 px, right 384.5 / 11.17 px)
    leads: { n: 50, u0: 384.25, pitch: 11.10, rows: [{ base: 107, tip: 82 }, { base: 196, tip: 214, u0: 384.5, pitch: 11.17 }] },
    contacts: { ...SLOTC, u0: 384.5, pitch: 11.13, rows: [{ v: 131 }, { v: 179 }] },
  }));

  // ---------------------------------------------------------------- pin headers J1..J16
  // Shared geometry, built once around (0,0): 2 columns x 5 rows. The pad rows measure 22.75 px apart in the texture (1.1375 mm
  // in this file's 20 px/mm space); the two pin columns are taken at the same spacing.
  const PITCH = 22.75 / 20, PX = PITCH / 2, FOOT_X = 2.25;
  const rowsZ = [-2, -1, 0, 1, 2].map((i) => i * PITCH);
  const bodyBoxes = [
    { c: rectMM(0, 0, 2.9, 5.6), y0: 0, y1: HDR_BODY - 0.2 },
    { c: rectMM(0, 0, 2.9, 5.6), y0: HDR_BODY - 0.2, y1: HDR_BODY, taper: 0.16 },
  ];
  const pinBoxes = [], footBoxes = [];
  for (const cx of [-PX, PX]) for (const z of rowsZ) {
    pinBoxes.push({ c: rectMM(cx, z, 0.4, 0.4), y0: 0.6, y1: HDR_PIN_TOP - 0.5 });
    pinBoxes.push({ c: rectMM(cx, z, 0.4, 0.4), y0: HDR_PIN_TOP - 0.5, y1: HDR_PIN_TOP, taper: 0.13 });
  }
  for (const s of [-1, 1]) for (const z of rowsZ) {
    // gull-wing lead: stub out of the body side, short vertical leg, foot lying on the pad
    footBoxes.push({ c: rectMM(s * 1.55, z, 0.8, 0.3), y0: 0.7, y1: 0.88 });
    footBoxes.push({ c: rectMM(s * 1.78, z, 0.16, 0.3), y0: 0.0, y1: 0.88 });
    // foot + toe fillet together fill the photographed solder pad (x 1.55..2.95): the box stops 0.3 mm short of the pad end and the
    // ASSUMED concave toe fillet completes it; a heel fillet climbs the leg (gallery-1 shows bright reflowed solder at every foot)
    footBoxes.push({ c: rectMM(s * (FOOT_X - 0.15), z, 1.1, 0.6), y0: 0.0, y1: 0.14 });
    footBoxes.push({ fillet: { o: [s * (FOOT_X + 0.4), z], ry: s > 0 ? 0 : Math.PI, L: 0.3, H: 0.14, W: 0.66 } });
    footBoxes.push({ fillet: { o: [s * 1.86, z], ry: s > 0 ? 0 : Math.PI, L: 0.3, H: 0.4, W: 0.66 } });
  }
  const bodyGeo = mergeBoxes(bodyBoxes), pinGeo = mergeBoxes(pinBoxes), footGeo = mergeBoxes(footBoxes);

  // header centres (texture px), template-matched on the solder pads; the ncc offset (+4,+2) centres on the pad pair
  const HDR = {
    J1: [358, 1225], J2: [534, 1225], J3: [709, 1224],
    J4: [357, 1047], J5: [532, 1045], J6: [708, 1043],
    J7: [355, 867], J8: [530, 864], J9: [706, 861],
    J10: [353, 690], J11: [529, 685], J12: [703, 681],
    J13: [351, 512], J14: [526, 508], J15: [700, 502],
    J16: [697, 328],
  };
  for (const [ref, [px, py]] of Object.entries(HDR)) {
    const x = F.x(px + 4), z = F.z(py + 2);
    const hg = new THREE.Group(); hg.position.set(x, 0, z);
    hg.add(meshOf(bodyGeo, darkBody, 'body'), meshOf(pinGeo, pinGold, 'pins'), meshOf(footGeo, footTin, 'feet'));
    prim.meta(hg, {
      ref, kind: 'pin', status: 'photo-verified', label: `Pin header ${ref}`,
      desc: `Appears to be a 2 x 5 surface-mount pin header with vertical pins: 10 pins and 10 gull-wing solder pads counted in the photos; the pad rows are about 22.75 px apart in the photo texture (about 1.3 mm at the model scale, which itself rests on an assumed 0.635 mm connector pitch). The designator ${ref} is printed on the board and legible in the photo. The pins are modelled upright because the flat-lay photos show their tips end-on as two columns of small gold squares inside the body and nothing lying on the board beside it; in the 3/4 photo (gallery-1) they lean to the right only as every vertical edge at that edge of the frame does. Footprint is photo-derived; the body height (about ${HDR_BODY} mm), the pin height (about ${HDR_PIN_TOP} mm, in a range of about 4 to 5 mm from a camera fitted to gallery-1), the pin-tip taper and the solder fillets at the feet are assumed.`,
    });
    g.add(hg);
  }

  const dm = ctx.scale.dims_mm?.peri;
  const sizeTxt = dm ? `about ${dm[0].toFixed(0)} x ${dm[1].toFixed(0)} mm` : 'size not stated';
  prim.meta(g, { label: 'PeriBoard', kind: 'board', status: 'photo-derived', desc: `Board outline and size (${sizeTxt}; not independently verified, because the scale rests on an assumed 0.635 mm pitch of its board-to-board connectors) derived from the photos; 1.6 mm thickness assumed; the underside is not photographed and is shown plain.` });
  g.userData.anchors = {};
  return g;
}
