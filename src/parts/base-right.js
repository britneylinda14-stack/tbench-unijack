// base-right builder: the right-hand part of the UniJack base board (texture x >= ~570 px) plus the FPGA and the oscillator left of it.
// Everything is placed from PIXEL coordinates of assets/tex/base-top.webp (converted by ctx.frames.base); footprints follow the
// APPARENT outline of each part in the photo so the top-down view reproduces the photo. Heights are typical values (ASSUMED).
import { pxBoxPart, leadRows, flatPads, pinSet, mergedBoxes, ballGrid, uniqueNames } from './base-right-helpers.js';

// --- assumed stack: PeriBoard underside rests on the tops of the three long connectors -------------------------------------
const CONN_H = 6.0;            // ASSUMED connector / mated stack height (mm). Real value not visible in any photo.
const PERI_T = 1.6;            // ASSUMED PeriBoard thickness (mm)
const CONN_TOP = CONN_H - 0.02; // housing tops sit a hair below the PeriBoard underside so nothing intersects
const PERI_MOUNT = { x: 57.6, z: -1.5, y: CONN_H + PERI_T };   // x,z measured to about +-1 mm (notes at the bottom), y assumed

const range = (n, a, pitch) => Array.from({ length: n }, (_, i) => a + i * pitch);

export async function build(ctx, group) {
  const { THREE, prim, mat, frames, tex } = ctx;
  const f = frames.base;
  const std = (c, r, m = 0) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
  const top = mat.photoTop(tex.base, { roughness: 0.55, env: 0.5 });   // one shared photo-top material (same response as the board slab)
  const M = {
    // the three long connectors are the same tan-brown in every photo: ONE material for all three. Colour = median of the housing
    // walls of the three connectors in base-top.webp, about #8e7867 (tools: numpy median over the wall strips), darkened about 15 percent
    // because vertical faces receive less light in the viewer than the flat-lay tops do.
    connectorTan: std('#796658', 0.5),
    tantalum: std('#c48d14', 0.45), cream: std('#d3c9ae', 0.45), darkGrey: std('#2a2c2e', 0.5), shellAlu: std('#b8bcc0', 0.3, 0.9),
    ceramicLid: std('#9a9688', 0.4, 0.4), resistor: std('#26282b', 0.55), ballField: std('#8f949a', 0.4, 0.8),
    lead: std('#a9adb2', 0.4, 0.85), solder: std('#b4b8bc', 0.35, 0.9),
  };
  const LM = { top, side: M.lead };   // lead / pad boxes: real photo on top, bare metal on the sides
  const mk = (ud) => { const g = new THREE.Group(); group.add(g); prim.meta(g, ud); return g; };

  /* =============================================================================================================== */
  /* FPGA + oscillator                                                                                               */
  /* =============================================================================================================== */
  {
    const g = mk({ label: 'Lattice FPGA (BGA-style IC)', kind: 'ic', status: 'photo-verified',
      desc: 'Package marking legible in the photo: "LATTICE iCE40HX8K CT256". It appears to be a BGA-style package, but no photo shows the underside, so the ball grid drawn under the body is illustrative (a full 16 x 16 array is assumed from the CT256 marking). Body outline measured from the photo (about 15 x 15 mm at the corrected board scale, which is uncertain by several percent). Height and ball stand-off are assumed.' });
    pxBoxPart(ctx, g, [643, 229, 777, 345], 1.25, { y0: 0.3, top, side: mat.icBlack, radius: 0.18, name: 'body' });
    // "CT256" marking = 256 balls: a full 16 x 16 array is assumed (balls are hidden under the body in every photo)
    const balls = [];
    for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) balls.push({ x: 654 + i * (112 / 15), z: 239.5 + j * (95 / 15) });
    ballGrid(ctx, g, M.solder, balls, { d: 0.42, yc: 0.15, name: 'balls' });
  }
  {
    const g = mk({ label: 'SMD oscillator-style package', kind: 'other', status: 'photo-derived',
      desc: 'Small 4-pad ceramic package with a metal-coloured lid and a yellow label, left of the FPGA. Footprint from the photo; height assumed; markings not claimed.' });
    pxBoxPart(ctx, g, [582, 299, 629, 325], 1.3, { top, side: mat.ceramic, radius: 0.12, name: 'body' });
  }

  /* =============================================================================================================== */
  /* Small ICs                                                                                                       */
  /* =============================================================================================================== */
  // SOIC-8 below-right of the FPGA
  {
    const g = mk({ label: 'SOIC-8 style IC', kind: 'ic', status: 'photo-derived',
      desc: 'Appears to be an 8-lead SOIC: 4 gull-wing leads per side counted in the photo. Marking not legible; function not claimed; height, lead shape and solder fillets assumed.' });
    pxBoxPart(ctx, g, [836, 330, 870, 368], 1.5, { top, side: mat.icBlack, radius: 0.1, name: 'body' });
    leadRows(ctx, g, LM, [
      { axis: 'x', face: 836, tip: 821, pos: [336.5, 346.1, 356.1, 366.1], w: 5.5, hTop: 0.75 },
      { axis: 'x', face: 870, tip: 884, pos: [338, 347.5, 357, 366.5], w: 5.5, hTop: 0.75 },
    ], 'leads');
  }
  // QFN near the top middle
  {
    const g = mk({ label: 'QFN-style IC', kind: 'ic', status: 'photo-verified',
      desc: 'Small leadless package near the top middle; the photo shows a logo and the marking "3030" on the top. Footprint and side pads read from the photo; height and pad size assumed; function not claimed.' });
    pxBoxPart(ctx, g, [762, 95, 803, 138], 0.8, { top, side: mat.icBlack, radius: 0.08, name: 'body' });
    const pads = [];
    range(9, 103.7, 3.65).forEach((y) => { pads.push({ b: [759.5, y - 1.3, 764.5, y + 1.3], h: 0.12 }); pads.push({ b: [800.5, y - 1.3, 805, y + 1.3], h: 0.12 }); });
    [771, 775.3, 779.6, 784, 788.4, 792.7].forEach((x) => pads.push({ b: [x - 1.3, 136.5, x + 1.3, 141], h: 0.12 }));
    flatPads(ctx, g, LM, pads, 'pads');
  }
  // unpopulated TSSOP-20 footprint at the top edge
  {
    const g = mk({ label: 'Unpopulated TSSOP-20 footprint', kind: 'other', status: 'photo-derived',
      desc: 'The photo shows 2 x 10 tinned pads and a square exposed pad but no package body, so this footprint appears to be unpopulated. Pads are modelled as a thin layer; thickness assumed.' });
    const pads = [];
    range(10, 22.3, 5.13).forEach((y) => { pads.push({ b: [777, y - 1.9, 791.5, y + 1.9], h: 0.1 }); pads.push({ b: [829, y - 1.9, 843.5, y + 1.9], h: 0.1 }); });
    flatPads(ctx, g, LM, pads, 'pads');
    pxBoxPart(ctx, g, [798, 29.5, 822, 60.5], 0.1, { top, side: mat.tin, name: 'exposed-pad' });
  }
  // right-hand trio of 48-pin level shifters
  const tssop = [
    { b: [966, 87, 1027, 187], lead0: 92 },
    { b: [964, 195, 1027, 295], lead0: 199.5 },
    { b: [968, 302, 1028, 403], lead0: 306 },
  ];
  tssop.forEach((t, i) => {
    const n = i + 4;                                            // the left group of three (base-left.js) is 1 to 3
    const g = mk({ label: `TSSOP-48-style IC ${n}`, kind: 'ic', status: 'photo-verified',
      desc: `One of six similar 48-lead TSSOP-style packages on the base board (24 leads per long side counted in the photo); numbered 1 to 6 here only to tell them apart. This is number ${n}, in the right-hand group of three (4 to 6); the left-hand group (1 to 3) sits under the Mercury module. Marking legible in the photo includes "LVC16T245"; no function claimed. Height, lead shape and the solder fillets at each foot assumed.` });
    pxBoxPart(ctx, g, t.b, 1.1, { top, side: mat.icBlack, radius: 0.08, name: 'body' });
    const ys = range(24, t.lead0, 4.0);
    leadRows(ctx, g, LM, [
      { axis: 'x', face: t.b[0] + 1, tip: 955.5, pos: ys, w: 2.5, hTop: 0.55, t: 0.12 },
      { axis: 'x', face: t.b[2] - 1, tip: 1036.5, pos: ys, w: 2.5, hTop: 0.55, t: 0.12 },
    ], 'leads');
  });

  /* =============================================================================================================== */
  /* Long board-to-board connectors (housing + channel + gold contacts + leads + end tabs)                          */
  /* =============================================================================================================== */
  const floorH = 2.0;
  function longConnector({ ud, side, housing, channel, tabs, lead, contacts }) {
    const g = mk(ud);
    const [hx0, hy0, hx1, hy1] = housing, [cx0, cy0, cx1, cy1] = channel;
    // Walls around the contact channel. The two SHORT end walls run the full depth and the long walls sit between them, so the
    // T-junctions (where prim.freeEdges keeps an edge sharp) fall on the short inner edges and the long channel edges keep their bevel.
    const longAxis = (hx1 - hx0) >= (hy1 - hy0);
    const walls = longAxis
      ? [{ b: [hx0, hy0, cx0, hy1] }, { b: [cx1, hy0, hx1, hy1] }, { b: [cx0, hy0, cx1, cy0] }, { b: [cx0, cy1, cx1, hy1] }]
      : [{ b: [hx0, hy0, hx1, cy0] }, { b: [hx0, cy1, hx1, hy1] }, { b: [hx0, cy0, cx0, cy1] }, { b: [cx1, cy0, hx1, cy1] }];
    mergedBoxes(ctx, g, [
      ...walls.map((w) => ({ ...w, h: CONN_TOP })),
      { b: channel, h: floorH },                   // channel floor (photo shows the gold contacts here)
      ...tabs.map((b) => ({ b, h: 4.6 })),         // end tabs / latches, height assumed
    ], { top, side, name: 'housing' });
    leadRows(ctx, g, LM, [
      { ...lead },
    ], 'leads');
    pinSet(ctx, g, mat.gold, contacts, 'contacts');
    return g;
  }
  const hContacts = (xs, yBack, yFront) => xs.flatMap((x) => [
    { x, z: yBack, y0: 1.4, y1: 3.8, w: 2.0, d: 1.3 }, { x, z: yFront, y0: 1.4, y1: 3.8, w: 2.0, d: 1.3 }]);
  const vContacts = (zs, xLeft, xRight) => zs.flatMap((z) => [
    { x: xLeft, z, y0: 1.4, y1: 3.8, w: 1.3, d: 2.0 }, { x: xRight, z, y0: 1.4, y1: 3.8, w: 1.3, d: 2.0 }]);

  // long horizontal connector along the top-right edge (its designator is cut off at the board edge in the photo: no ref)
  longConnector({
    ud: { label: 'Long board-to-board-style connector (top edge)', kind: 'connector', status: 'photo-derived',
      desc: 'Appears to be a two-row board-to-board-style connector along the top-right edge: about 50 leads counted along its one visible lead row, tan-brown housing with a recessed contact channel. The designator beside it is cut off in the photo, so none is assigned. Height is assumed and sets the PeriBoard stand-off.' },
    side: M.connectorTan,
    housing: [1100, 11, 1412, 60], channel: [1110, 14, 1406, 39],
    tabs: [[1058, 22, 1100, 70], [1412, 11, 1424, 62]],
    lead: { axis: 'y', face: 60, tip: 77, pos: range(50, 1098, 5.612), w: 3.2, hTop: 0.9 },
    contacts: hContacts(range(50, 1116, 5.612), 15.6, 37.4),
  });
  // tall vertical connector, middle right
  longConnector({
    ud: { ref: 'J301', label: 'Long vertical board-to-board-style connector', kind: 'connector', status: 'photo-verified',
      desc: 'Designator J301 is legible beside it. Appears to be a two-row board-to-board-style connector: about 50 leads counted along the visible lead row, tan-brown housing with a recessed gold contact channel. Height is assumed and sets the PeriBoard stand-off.' },
    side: M.connectorTan,
    housing: [1094, 131, 1147, 410], channel: [1113, 134, 1143, 404],
    tabs: [[1096, 121, 1147, 134], [1094, 404, 1142, 447]],
    lead: { axis: 'x', face: 1094, tip: 1077, pos: range(50, 165, 5.13), w: 3.0, hTop: 0.9 },
    contacts: vContacts(range(50, 146, 5.18), 1115, 1140),
  });
  // long horizontal connector along the bottom-right edge
  longConnector({
    ud: { ref: 'J302', label: 'Long horizontal board-to-board-style connector', kind: 'connector', status: 'photo-verified',
      desc: 'Designator J302 is legible beside it. Appears to be a two-row board-to-board-style connector: about 50 leads counted along the visible lead row, tan-brown housing with a recessed contact channel. Height is assumed and sets the PeriBoard stand-off.' },
    side: M.connectorTan,
    housing: [1100, 625, 1421, 663], channel: [1113, 628, 1418, 650],
    tabs: [[1066, 628, 1110, 670], [1400, 650, 1421, 671], [1421, 625, 1432, 650]],
    lead: { axis: 'y', face: 663, tip: 676, pos: range(50, 1104, 5.633), w: 3.2, hTop: 0.9 },
    contacts: hContacts(range(50, 1122, 5.5), 630.5, 647.5),
  });

  /* =============================================================================================================== */
  /* USB connectors on the right                                                                                     */
  /* =============================================================================================================== */
  {
    const g = mk({ label: 'Mini-USB-style connector', kind: 'connector', status: 'photo-derived',
      desc: 'Appears to be a mini-USB-style receptacle with a gold/orange-coloured shell at the upper right; the shell sits close to the right board edge. Outline from the photo; height assumed; the end-face opening is an assumed shape. The amber pattern on its top face appears to show part of the receptacle opening seen at an angle in the flat-lay photo, so it is not a clean view of the top surface.' });
    pxBoxPart(ctx, g, [1361, 128, 1444, 190], 4.0, { top, side: mat.usbGold, radius: 0.15, name: 'shell' });
    pxBoxPart(ctx, g, [1345, 128, 1362, 188], 3.0, { top, side: mat.plasticBlack, name: 'rear-housing' });
    pxBoxPart(ctx, g, [1444, 133, 1444.7, 185], 2.4, { y0: 0.9, side: mat.plasticBlack, name: 'opening' });   // receptacle opening on the end face: shape ASSUMED
    flatPads(ctx, g, LM, [...[156, 162.5, 168.5, 174.5, 180.5].map((y) => ({ b: [1340, y - 1.7, 1356, y + 1.7], h: 0.12 })),
      { b: [1343, 193, 1362, 211], h: 0.12 }, { b: [1392, 193, 1412, 211], h: 0.12 }], 'pads');
  }
  {
    const g = mk({ label: 'Micro-USB-style connector (two-lobed shell)', kind: 'connector', status: 'photo-derived',
      desc: 'Appears to be a wide micro-USB-style receptacle (double-width shell) on the right edge; the shell runs off the right edge of the photo texture. Outline from the photo; height assumed; the end-face opening is an assumed shape. The flat-lay photo appears to show part of its end and side faces, so its top-face pixels are approximate.' });
    pxBoxPart(ctx, g, [1404, 410, 1450, 513], 2.9, { top, side: M.shellAlu, radius: 0.12, name: 'shell' });
    pxBoxPart(ctx, g, [1388, 412, 1405, 512], 2.4, { top, side: mat.plasticBlack, name: 'rear-housing' });
    pxBoxPart(ctx, g, [1450, 416, 1450.7, 507], 1.7, { y0: 0.6, side: mat.plasticBlack, name: 'opening' });   // receptacle opening on the end face: shape ASSUMED
    flatPads(ctx, g, LM, [424.3, 429.3, 434.3, 439.3, 444.7, 476.7, 481.9, 487, 492.6, 497.9].map((y) => ({ b: [1383.5, y - 1.5, 1392, y + 1.5], h: 0.12 })), 'pads');
  }

  /* =============================================================================================================== */
  /* QFP-64, other QFN/SOIC/BGA, switch, tantalums, DPAK on the right                                               */
  /* =============================================================================================================== */
  {
    const g = mk({ label: 'QFP-64-style IC', kind: 'ic', status: 'photo-derived',
      desc: 'Appears to be a 64-lead QFP: 16 gull-wing leads per side counted in the photo. The rotated marking is only partly legible; function not claimed; height, lead shape and solder fillets assumed.' });
    pxBoxPart(ctx, g, [1232, 277, 1320, 357], 1.5, { top, side: mat.icBlack, radius: 0.1, name: 'body' });
    leadRows(ctx, g, LM, [
      { axis: 'x', face: 1233, tip: 1212, pos: range(16, 289, 3.95), w: 2.3, hTop: 0.7, t: 0.12 },
      { axis: 'x', face: 1319, tip: 1331, pos: range(16, 288, 4.0), w: 2.3, hTop: 0.7, t: 0.12 },
      { axis: 'y', face: 278, tip: 266, pos: range(16, 1237.5, 4.42), w: 2.5, hTop: 0.7, t: 0.12 },
      { axis: 'y', face: 356, tip: 372, pos: range(16, 1242, 4.47), w: 2.5, hTop: 0.7, t: 0.12 },
    ], 'leads');
  }
  {
    const g = mk({ label: 'SOIC-8 style IC (right)', kind: 'ic', status: 'photo-derived',
      desc: 'Appears to be an 8-lead SOIC with 4 leads on each long side (top and bottom in the photo). Marking not legible; function not claimed; height, lead shape and solder fillets assumed.' });
    pxBoxPart(ctx, g, [1376, 329, 1420, 357], 1.5, { top, side: mat.icBlack, radius: 0.1, name: 'body' });
    leadRows(ctx, g, LM, [
      { axis: 'y', face: 329, tip: 319, pos: [1377, 1388, 1399, 1409.5], w: 5, hTop: 0.75 },
      { axis: 'y', face: 357, tip: 372, pos: [1382.5, 1393.6, 1404, 1415], w: 5, hTop: 0.75 },
    ], 'leads');
  }
  {
    const g = mk({ label: 'Large leadless IC', kind: 'ic', status: 'photo-derived',
      desc: 'Large square package with no leads visible (appears to be a BGA or leadless style); marking only partly legible, function not claimed. Height and stand-off assumed.' });
    pxBoxPart(ctx, g, [1254, 422, 1342, 496], 0.22, { top: undefined, side: M.ballField, name: 'ball-field', sharp: true });
    pxBoxPart(ctx, g, [1251, 419, 1345, 499], 0.95, { y0: 0.22, top, side: mat.icGrey, radius: 0.12, name: 'body' });
  }
  {
    const g = mk({ label: 'Tactile-switch-style part', kind: 'other', status: 'photo-derived',
      desc: 'Appears to be an SMD tactile push-button: cream body with a dark grey actuator. Outline from the photo; height assumed.' });
    pxBoxPart(ctx, g, [1331, 376, 1404, 412], 2.6, { top, side: M.cream, radius: 0.15, name: 'body' });
    pxBoxPart(ctx, g, [1361, 380, 1392, 397], 0.7, { y0: 2.6, top, side: mat.plasticDark, radius: 0.1, name: 'actuator' });
  }
  {
    const g = mk({ label: 'Two yellow SMD parts (capacitor-style)', kind: 'cap', status: 'photo-derived',
      desc: 'Two yellow moulded SMD parts that appear to be capacitors (possibly tantalum) near the lower right; printed codes are visible on their tops but are not transcribed here. Footprints from the photo; height assumed.' });
    mergedBoxes(ctx, g, [{ b: [1285, 513, 1350, 543], h: 2.6 }, { b: [1279, 557, 1318, 605], h: 2.6 }], { top, side: M.tantalum, name: 'bodies' });
  }
  {
    const g = mk({ label: 'DPAK style power device', kind: 'ic', status: 'photo-derived',
      desc: 'Appears to be a DPAK-style (TO-252-like) part: dark plastic body, 3 legs on the left and a metal tab on the right. Marking not claimed; height, lead shape and solder fillets assumed.' });
    pxBoxPart(ctx, g, [1363, 550, 1414, 600], 2.3, { top, side: mat.icBlack, radius: 0.1, name: 'body' });
    pxBoxPart(ctx, g, [1414, 553, 1421, 600], 0.9, { top, side: mat.tin, name: 'tab' });
    leadRows(ctx, g, LM, [
      { axis: 'x', face: 1363, tip: 1326, pos: [558, 577, 594], w: 6.5, hTop: 1.1, t: 0.22 },
    ], 'leads');
  }

  /* =============================================================================================================== */
  /* Pin headers J305 / J306 / J307 (2 columns, pin-pair counts read from the photo)                                */
  /* =============================================================================================================== */
  // Heights ASSUMED, judged against gallery-1: there the pins stand well clear of a low shroud (exposed pin length about half the
  // shroud width), so the shroud is kept low (2.6 mm) and the pins reach about 5.4 mm; the earlier 3.4 / 4.6 mm hid most of the pin.
  const SHROUD_H = 2.6, PIN_TOP = 5.4;
  function header({ ref, rows, body, tails, colX, pinY }) {
    const g = mk({ ref, label: `2 x ${rows} pin header`, kind: 'connector', status: 'photo-verified',
      desc: `Designator ${ref} is legible. Appears to be a shrouded 2-column SMD pin header with vertical pins; ${rows} pin pairs counted in the photo (gold pin tips visible end-on inside a dark shroud, tails on the left). Shroud height (about ${SHROUD_H} mm) and pin height (about ${PIN_TOP} mm; in the 3/4 photo the pins stand well above the shroud) are assumed, as are the pointed pin tips and the solder fillets at the tails.` });
    const [x0, y0, x1, y1] = body, wall = 7;
    mergedBoxes(ctx, g, [
      { b: body, h: 1.0 },                                  // dark floor of the shroud (photo shows it)
      { b: [x0, y0, x0 + wall, y1], h: SHROUD_H }, { b: [x1 - wall, y0, x1, y1], h: SHROUD_H },
      { b: [x0 + wall, y0, x1 - wall, y0 + 3], h: SHROUD_H }, { b: [x0 + wall, y1 - 3, x1 - wall, y1], h: SHROUD_H },
    ], { top, side: mat.plasticBlack, name: 'shroud' });
    pinSet(ctx, g, mat.gold, colX.flatMap((x) => pinY.map((z) => ({ x, z, y0: 0.6, y1: PIN_TOP, w: 2.6, d: 2.6 }))), 'pins');
    const tl = tails.leadLen || 15, LF = 0.3, LFpx = LF * 8.72;
    mergedBoxes(ctx, g, tails.flatMap((y) => [
      { b: [body[0] - tl + LFpx, y - 2, body[0] + 4, y + 2], h: 0.12, sharp: true },            // foot stops 0.3 mm short of the traced tip ...
      { fillet: { x: body[0] - tl + LFpx, z: y, dir: '-x', L: LF, H: 0.12, W: 4.4 } },           // ... and the assumed toe fillet completes it to the tip
      { fillet: { x: body[0] - 1, z: y, dir: '-x', L: LF, H: 0.4, W: 4.4 } },                   // heel fillet against the shroud wall
    ]), { ...LM, name: 'tails' });
    return g;
  }
  const tails = (ys, len) => { const a = ys.slice(); a.leadLen = len; return a; };
  header({ ref: 'J305', rows: 5, body: [772, 614, 826, 668], colX: [794, 806], pinY: [616, 626, 637, 648, 658], tails: tails([624, 634, 645, 654, 664], 15) });
  header({ ref: 'J306', rows: 7, body: [869, 594, 917, 668], colX: [889.5, 902], pinY: [595.3, 605.5, 615.6, 626.7, 636.7, 647.5, 658.3], tails: tails([603, 614, 624, 634, 644, 654, 664], 19) });
  header({ ref: 'J307', rows: 8, body: [969, 587, 1020, 668], colX: [992.5, 1004.5], pinY: [585.8, 596, 606, 617, 627.5, 638, 649, 659], tails: tails([593.8, 604.4, 615, 625, 635.6, 646, 656, 666], 21) });

  /* =============================================================================================================== */
  /* Column of tiny SMD parts right of J301, and other small passives (merged: one draw call per class)              */
  /* =============================================================================================================== */
  {
    const g = mk({ label: 'Column of 13 small SMD parts', kind: 'passive', status: 'photo-derived',
      desc: 'Thirteen small SMD parts in a vertical column right of J301 (each shows a centre hole/mark in the photo). Footprints from the photo; height assumed; values and function not claimed.' });
    mergedBoxes(ctx, g, range(13, 217.5, 17.05).map((y) => ({ b: [1157.5, y - 4.5, 1179, y + 4.5], h: 0.6 })), { top, side: M.resistor, name: 'parts' });
  }
  {
    const g = mk({ label: 'Tan SMD chip parts (capacitor-style)', kind: 'cap', status: 'photo-derived',
      desc: 'Tan-bodied SMD chip parts that appear to be ceramic capacitors, across the top strip and the right side. Footprints from the photo; heights assumed; values not claimed.' });
    const caps = [
      [631, 12.5, 646, 38, 1.1], [657.5, 47, 673, 73, 1.1], [692, 19.5, 701, 36, 0.6], [710, 17.5, 722, 31.5, 0.8], [715, 49.5, 727.5, 68, 0.7],
      [736, 48, 746, 71, 0.9], [611, 16, 624, 27, 0.6], [757, 26, 770, 38, 0.6], [754, 56, 767.5, 68, 0.6], [900, 65, 917, 83, 1.0],
      [1294, 111, 1306, 132, 0.9], [1297, 189, 1308, 202, 0.6], [1282, 401, 1296, 416, 0.9],
    ];
    mergedBoxes(ctx, g, caps.map(([a, b, c, d, h]) => ({ b: [a, b, c, d], h })), { top, side: mat.ceramic, name: 'caps' });
  }
  {
    const g = mk({ label: 'SMD chip resistors / small parts', kind: 'passive', status: 'photo-derived',
      desc: 'Dark-bodied SMD chip parts (appear to be resistors or similar) and small LED-style parts. Footprints from the photo; heights assumed; values and function not claimed.' });
    const small = [
      [586, 17.5, 606, 28, 0.6], [656, 28, 679, 37, 0.5], [605, 44.5, 625, 58, 0.6], [631, 44.5, 650, 58, 0.6], [684, 48, 705, 56, 0.5],
      [745, 19, 752.5, 31.5, 0.5], [861, 68, 874, 82, 0.6], [880, 68, 894, 82, 0.6],
      [1309, 113.5, 1336, 124.5, 0.5], [1273, 137, 1283, 156, 0.7], [1291, 146, 1304.5, 157, 0.5], [1233, 186, 1246, 199, 0.5],
      [1233, 201.5, 1245.5, 208, 0.4], [1251, 198, 1267, 205.5, 0.5], [1277, 192, 1291, 203.5, 0.5], [1239, 225, 1262, 234.5, 0.5],
      [1254.5, 240.5, 1266, 253, 0.5], [1242, 242, 1250, 254.5, 0.5], [1299, 399, 1307, 412, 0.5], [1360, 479, 1371, 487, 0.5],
      [1363, 527, 1379, 533, 0.5], [1383, 508, 1389, 517, 0.5],
      [1213, 191, 1223, 208, 0.6], [1395, 532, 1414, 541, 0.6], [1378, 454, 1389, 468, 0.8],
      [792, 313, 807, 324, 0.5], [738, 347, 750, 353, 0.4], [738, 354, 750, 361, 0.4], [803, 353, 817, 360, 0.5], [797, 362, 808, 372, 0.5],
      [895, 350, 902, 360, 0.5], [896, 365, 902, 373, 0.5], [598, 333, 610, 344, 0.5],
    ];
    mergedBoxes(ctx, g, small.map(([a, b, c, d, h]) => ({ b: [a, b, c, d], h })), { top, side: M.resistor, name: 'parts' });
  }
  {
    const g = mk({ label: 'SMD oscillator-style packages (3)', kind: 'other', status: 'photo-derived',
      desc: 'Three small square ceramic packages with grey lids on the right side (appear to be crystals or oscillators). Footprints from the photo; height assumed; markings not legible.' });
    mergedBoxes(ctx, g, [[1294, 228, 1327, 250], [1353, 450, 1373, 471], [1349, 502, 1375, 515]].map(([a, b, c, d]) => ({ b: [a, b, c, d], h: 1.0 })), { top, side: M.ceramicLid, name: 'bodies' });
  }

  uniqueNames(group, 'base');
  return { anchors: { periMount: { ...PERI_MOUNT } }, latches: [] };
}
/*
 * PeriBoard mount (anchors.periMount). Measured from the photos to about +-1 mm; parallax of the tall connectors in the flat-lay
 * photo limits the accuracy, and the real mating arrangement (which side the PeriBoard's own connectors are on) is not visible.
 *   x: lead-row centres of the two horizontal connectors give 58.4 mm (base top 1235.5 px / J302 1242 px vs PeriBoard J201 +0.06 mm /
 *      J101 +0.78 mm); the vertical J301 lead column gives 56.7 mm (base 1085.5 px vs PeriBoard -15.5 mm). 57.6 mm splits the difference.
 *   z: +z lead rows of the horizontal connectors give -2.6 (top) and -0.8 (bottom) mm, housing/length centres give -3.1 / -2.3 / -0.75 mm;
 *      -1.5 mm is used.
 *   y = 6.0 mm assumed connector stack + 1.6 mm assumed PeriBoard thickness = 7.6 mm (the gallery-2 magnification of the PeriBoard plane
 *      relative to the base plane, about 1.07, is consistent with a stack of roughly 5 to 8 mm, given an unknown camera distance).
 */
