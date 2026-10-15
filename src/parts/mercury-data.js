// Measured data for the Mercury builder. ALL numbers are TEXTURE PIXELS read off assets/tex/mercury-front.webp
// (front, 'F') or assets/tex/mercury-back.webp (back, 'B'), both 801 x 1568 px at 22.53 px/mm, measured with
// tools/crop.py grids (see qa-out/mercury/*.png). Nothing here is CAD or a vendor dimension.

/** Projective registration (homography) of the BACK photo onto the FRONT photo, row-major 3x3, back px -> front px:
 *  [xf, yf, w] = REG_H * [xb, yb, 1],  then divide by w. The back photo is a view from below, so x is mirrored.
 *  Fitted by minimising the boundary distance (truncated at 8 px) between the back photo's board silhouette and the outline traced on
 *  the front photo (both directions), with the four mounting-hole centres as a soft constraint. It replaces an earlier affine fit
 *  (holes + corners only) that left the key notch off by up to 7.9 px. Residuals of this fit: holes <= 2.4 px (0.10 mm); left/right
 *  edges and fingers edge <= 2.8 px (0.12 mm); the three notches <= 6.4 px (0.28 mm; part of that is a real difference in notch
 *  shape between the two photos). Gold via dots that show on both faces still sit 4 to 5 px apart between the photos: that is the
 *  parallax of a 1.2 mm board seen from two viewpoints, not a registration error. Fit scripts: qa-out/fix-peri-mercury/homog*.py. */
export const REG_H = [
  [-1.000900831500494, 0.008334525956585044, 787.9050604991129],
  [0.0023701615932154472, 0.9957737445051139, -4.142280937329417],
  [-7.350487257792594e-07, -3.7691910944587216e-06, 1.0],
];

/** Mounting-hole centres in FRONT px (centres of the gold annulus fitted on the photo). Outer ring diameter measures 69 px = 3.06 mm,
 *  the see-through disc about 45 px = 2.0 mm. */
export const HOLES_F = [[135.3, 43.5], [723.6, 45.1], [136.0, 1522.5], [731.4, 1522.5]];
export const HOLE_R_MM = 1.0, RING_OUTER_MM = 1.53;

/** Fingers (gold contacts), counted on the photos. Each group: first finger centre (px y), pitch (px), count.
 *  FRONT: fingers span x 1.5 .. 60.5 px.  BACK: same span after registration. */
export const FINGERS_F = [{ y0: 31.6, pitch: 11.223, n: 72 }, { y0: 884.0, pitch: 11.312, n: 58 }];
export const FINGERS_B = [{ y0: 39.2, pitch: 11.268, n: 72 }, { y0: 896.5, pitch: 11.164, n: 58 }];   // BACK px (x ~ 729..790 there)
export const FINGER_X_F = [1.5, 60.5];   // front px
export const FINGER_W_MM = 0.30, FINGER_H_MM = 0.05;

/** Board outline, FRONT px, clockwise from top-left. Top-surface boundary measured on the photo:
 *  top edge y = -0.09 + 0.00446 x, right edge x = 786 + 0.0058 y, bottom edge y = 1566, fingers edge x = 0.3 + 0.00075 y.
 *  Notches: top  x 404.5..500, floor y 44.5;  bottom x 411..505, ceiling y 1521;  key notch in the fingers edge: floor x 90.8, y 846.5..868.5. */
export const OUT = {
  tl: [0.5, 0.0], tr: [786.0, 3.4], br: [795.1, 1566], bl: [1.5, 1566],
  topNotch: { x0: 404.5, x1: 500, y: 44.5, r: 8 },
  botNotch: { x0: 411, x1: 505, y: 1521, r: 8 },
  keyNotch: { xEnd: 90.8, y0: 846.5, y1: 868.5 },
};

// ------------------------------------------------------------------ FRONT parts (top-face boxes, FRONT px [x0,y0,x1,y1])
export const F = {
  vns: { body: [100, 139, 230, 297], tabTop: [127, 124, 201, 140], tabBot: [120, 299, 207, 324] },
  ecap: { c: [291, 180], r: 75, tab: [311, 275, 349, 305] },
  tssop: { body: [521, 191, 610, 301], n: 8, pitch: 12.86, leadsCy: 249.0 },
  ind472: [372, 325, 466, 418],
  ind222: [671, 307, 776, 400],
  brown: { lid: [397, 520, 561, 620], term: [380, 550, 398, 600] },
  blue: { c: [675, 573], r: 75, base: [604, 488, 764, 670], tab: [660, 648, 715, 668], blob: [730, 625, 762, 647], blobL: [608, 505, 626, 521] },
  bga: [304, 673, 582, 950],
  ham: { body: [652, 701, 730, 777], rightY: [704, 719, 733, 747.5, 762.5], leftY: [719, 733, 748, 762] },
  sotA: { body: [261, 498, 329, 529], leadsTop: [271.5, 319], leadBot: 296 },   // 2 leads on top (-z) side, 1 on bottom (+z)
  sotB: { body: [212.5, 594, 239, 656], leadsRight: [601, 646.5], leadLeft: 624 },  // 2 leads on right (+x) side, 1 on left
};

// ------------------------------------------------------------------ BACK parts (BACK px)
export const B = {
  soic: { body: [411, 219, 527, 303], leadX: [425.7, 455.7, 483.4, 513.4], tipTop: 181, tipBot: 339 },
  sot: { body: [157, 280, 224, 304], leadTop: 192.5, leadsBot: [171, 215], tipTop: 258, tipBot: 328 },
};

// ------------------------------------------------------------------ CHIP PASSIVES  [x0, y0, x1, y1, long-axis, body]
// Hand-annotated on gridded 2x tiles of the textures, then snapped to the chip bodies with a colour segmentation and shrunk by the
// solder fillet. long-axis: 'x' or 'z' (which way the chip is oriented in the photo); body: black | tan | white (body colour class).
// Tiny 0402-class parts, bare pad pairs and pad clusters are NOT listed: they stay texture-only.
export const CHIPS_F = [
  [401, 97.5, 452, 125.5, 'x', 'black'],
  [505, 81.5, 553, 112.5, 'x', 'white'],
  [526.5, 117, 560.5, 158, 'z', 'black'],
  [556.5, 119, 586.5, 161, 'z', 'tan'],
  [586.5, 121, 618.5, 161, 'z', 'tan'],
  [617.5, 120, 649.5, 161, 'z', 'tan'],
  [647.5, 120, 676.5, 161, 'z', 'tan'],
  [415.5, 144, 449.5, 192, 'z', 'brown'],
  [411, 205.5, 465, 227.5, 'x', 'black'],
  [405.5, 247, 442.5, 294, 'z', 'black'],
  [434.5, 249, 468.5, 295, 'z', 'black'],
  [685, 176.5, 733, 206.5, 'x', 'black'],
  [667, 203.5, 717, 236.5, 'x', 'black'],
  [503, 330.5, 556, 360.5, 'x', 'tan'],
  [503, 356.5, 556, 393.5, 'x', 'tan'],
  [574, 365.5, 623, 386.5, 'x', 'white'],
  [285.5, 355, 325.5, 391, 'z', 'black'],
  [305.5, 419, 333.5, 463, 'z', 'black'],
  [331.5, 420, 365.5, 463, 'z', 'tan'],
  [251, 447.5, 294, 475.5, 'x', 'black'],
  [596, 426.5, 666, 462.5, 'x', 'tan'],
  [714, 424.5, 762, 453.5, 'x', 'tan'],
  [714, 452.5, 763, 484.5, 'x', 'tan'],
  [537, 435.5, 588, 461.5, 'x', 'black'],
  [496.5, 440, 530.5, 495, 'z', 'tan'],
  [126.5, 477, 158.5, 522, 'z', 'black'],
  [342.5, 553, 375.5, 592, 'z', 'black'],
  [283, 573.5, 334, 602.5, 'x', 'black'],
  [283, 599.5, 337, 631.5, 'x', 'black'],
  [284, 631.5, 337, 665.5, 'x', 'black'],
  [89, 579.5, 138, 610.5, 'x', 'black'],
  [425, 619.5, 488, 655.5, 'x', 'black'],
  [186.5, 672, 217.5, 717, 'z', 'black'],
  [154.5, 672, 188.5, 717, 'z', 'white'],
  [83, 726.5, 138, 756.5, 'x', 'black'],
  [83, 756.5, 138, 788.5, 'x', 'black'],
  [247, 666.5, 300, 694.5, 'x', 'black'],
  [592.5, 700, 643.5, 772, 'z', 'tan'],
  [396.5, 987, 425.5, 1033, 'z', 'black'],
  [534.5, 1032, 563.5, 1079, 'z', 'black'],
  [556.5, 1033, 590.5, 1080, 'z', 'black'],
  [589.5, 1034, 623.5, 1080, 'z', 'black'],
  [548, 1092.5, 606, 1128.5, 'x', 'white'],
  [637, 946.5, 693, 980.5, 'x', 'tan'],
  [637, 976.5, 700, 1010.5, 'x', 'black'],
  [643, 1009.5, 700, 1040.5, 'x', 'tan'],
  [643, 1069.5, 693, 1100.5, 'x', 'black'],
  [643.5, 1115, 675.5, 1166, 'z', 'tan'],
  [667.5, 1114, 702.5, 1163, 'z', 'tan'],
  [651, 1176.5, 701, 1208.5, 'x', 'tan'],
  [353.5, 1233, 390.5, 1281, 'z', 'tan'],
  [381.5, 1233, 418.5, 1281, 'z', 'tan'],
  [412.5, 1232, 450.5, 1281, 'z', 'tan'],
  [447.5, 1235, 480.5, 1280, 'z', 'black'],
  [650, 1204.5, 700, 1237.5, 'x', 'tan'],
  [651, 1236.5, 701, 1268.5, 'x', 'tan'],
  [652, 1264.5, 701, 1294.5, 'x', 'tan'],
];
export const CHIPS_B = [
  [436, 75.5, 486, 105.5, 'x', 'tan'],
  [503, 75.5, 554, 105.5, 'x', 'tan'],
  [436, 104.5, 485, 132.5, 'x', 'black'],
  [498, 104.5, 555, 135.5, 'x', 'tan'],
  [471, 135.5, 525, 161.5, 'x', 'black'],
  [167, 341.5, 218, 370.5, 'x', 'black'],
  [168, 369.5, 215, 397.5, 'x', 'black'],
  [498, 354.5, 555, 385.5, 'x', 'tan'],
  [506, 414.5, 555, 447.5, 'x', 'black'],
  [426, 606.5, 475, 628.5, 'x', 'black'],
  [426, 639.5, 480, 668.5, 'x', 'black'],
  [477.5, 614, 510.5, 668, 'z', 'black'],
  [211, 616.5, 267, 647.5, 'x', 'tan'],
  [210, 644.5, 267, 677.5, 'x', 'tan'],
  [152, 647.5, 201, 674.5, 'x', 'black'],
  [267.5, 530, 297.5, 581, 'z', 'tan'],
  [319.5, 530, 346.5, 578, 'z', 'tan'],
  [265.5, 594, 297.5, 645, 'z', 'black'],
  [356, 637.5, 406, 668.5, 'x', 'black'],
  [567, 454.5, 618, 493.5, 'x', 'black'],
  [561, 488.5, 618, 526.5, 'x', 'black'],
  [561, 518.5, 618, 549.5, 'x', 'black'],
  [570, 586.5, 620, 624.5, 'x', 'black'],
  [570, 616.5, 619, 654.5, 'x', 'black'],
  [569, 648.5, 621, 682.5, 'x', 'black'],
  [570, 686.5, 619, 718.5, 'x', 'black'],
  [569, 712.5, 619, 750.5, 'x', 'black'],
  [561, 745.5, 619, 783.5, 'x', 'black'],
  [561, 776.5, 619, 814.5, 'x', 'black'],
  [500.5, 717, 533.5, 777, 'z', 'black'],
  [187.5, 734, 223.5, 766, 'z', 'tan'],
  [315, 768.5, 352, 788.5, 'x', 'tan'],
  [346, 761.5, 388, 788.5, 'x', 'tan'],
  [31, 846.5, 88, 877.5, 'x', 'tan'],
  [34, 876.5, 90, 904.5, 'x', 'tan'],
  [97, 843.5, 151, 875.5, 'x', 'black'],
  [97, 876.5, 151, 908.5, 'x', 'tan'],
  [98, 906.5, 152, 935.5, 'x', 'tan'],
  [129, 798.5, 170, 827.5, 'x', 'black'],
  [187.5, 804, 220.5, 837, 'z', 'tan'],
  [499.5, 810, 540.5, 855, 'z', 'tan'],
  [285.5, 803, 315.5, 835, 'z', 'tan'],
  [308, 854.5, 350, 873.5, 'x', 'tan'],
  [346, 854.5, 388, 880.5, 'x', 'tan'],
];

// ------------------------------------------------------------------ BARE (unpopulated) PADS on the BACK, BACK px [x0, y0, x1, y1]
// The back photo shows a QFN-style footprint (40 perimeter pads at about 0.4 mm pitch + a 3x3 centre pad) and six large rectangular
// pads with NO package or part on them. They are modelled as thin raised tin pads only.
const QFN_Y = Array.from({ length: 10 }, (_, k) => 1013.6 + 8.82 * k);
const QFN_X = Array.from({ length: 10 }, (_, k) => 474 + 8.9 * k);
export const BARE_QFN_B = [
  ...[[477, 497], [502, 527], [531, 552]].flatMap(([a, b]) => [[1017, 1037], [1044, 1063], [1073, 1091]].map(([c, d]) => [a, c, b, d])),
  ...QFN_Y.map((y) => [449, y - 2.6, 469, y + 2.6]),
  ...QFN_Y.map((y) => [562, y - 2.6, 582, y + 2.6]),
  ...QFN_X.map((x) => [x - 2.6, 988, x + 2.6, 1004]),
  ...QFN_X.map((x) => [x - 2.6, 1101, x + 2.6, 1118]),
];
export const BARE_BIG_B = [[330, 1176, 368, 1233], [398, 1176, 436, 1231], [469, 1193, 503, 1226], [469, 1231, 503, 1263], [517, 1193, 551, 1226], [517, 1233, 551, 1261]];
