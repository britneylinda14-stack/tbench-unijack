// Chip passives and bare footprints for Mercury (owner: key 'mercury'). Everything is merged into a few meshes (one per face + pads)
// so the ~100 small parts cost only a few draw calls. Positions come from mercury-data.js (measured on the photos).
import * as D from './mercury-data.js';

export function buildChips({ ctx, g, grp, reg, f, fB, T }) {
  const { THREE, prim, mat, tex } = ctx;
  const std = (color, roughness, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
  const body = { black: std('#1b1d21', 0.5), tan: std('#5c4832', 0.6), white: std('#9b968a', 0.55) };
  const photoF = mat.photoTop(tex.mercuryFront), photoB = mat.photoTop(tex.mercuryBack);
  const tinEnd = std('#8f959a', 0.45, 0.85);

  /** merged box batch. Buckets: 0 photo, 1 tin (ends / pads), 2 black, 3 tan, 4 white. */
  class Batch {
    constructor(face) { this.face = face; this.k = [0, 1, 2, 3, 4].map(() => ({ p: [], n: [], u: [] })); this.count = 0; }
    add({ cx, cz, w, d, h, y0, ori, type }) {
      const geo = new THREE.BoxGeometry(w, h, d); geo.translate(cx, y0 + h / 2, cz);
      const P = geo.attributes.position, N = geo.attributes.normal, I = geo.index.array;
      const bodyB = { black: 2, tan: 3, white: 4 }[type] ?? 2;
      for (let fi = 0; fi < 6; fi++) {
        let b;
        if (fi === 2) b = this.face === 'front' ? 0 : bodyB;           // +y
        else if (fi === 3) b = this.face === 'front' ? bodyB : 0;      // -y
        else if (ori === 'p') b = 1;                                   // bare pad: tin on every side
        else if (fi < 2) b = ori === 'x' ? 1 : bodyB;                  // +-x faces
        else b = ori === 'z' ? 1 : bodyB;                              // +-z faces
        const K = this.k[b];
        for (let t = 0; t < 6; t++) {
          const v = I[fi * 6 + t];
          const x = P.getX(v), y = P.getY(v), z = P.getZ(v);
          K.p.push(x, y, z); K.n.push(N.getX(v), N.getY(v), N.getZ(v));
          if (b === 0) { const uv = this.face === 'front' ? [(x + f.W / 2) / f.W, 1 - (z + f.D / 2) / f.D] : reg.uv(x, z); K.u.push(uv[0], uv[1]); } else K.u.push(0, 0);
        }
      }
      geo.dispose(); this.count++;
    }
    mesh(materials, name) {
      const tot = this.k.reduce((a, K) => a + K.p.length / 3, 0);
      const P = new Float32Array(tot * 3), N = new Float32Array(tot * 3), U = new Float32Array(tot * 2);
      const geo = new THREE.BufferGeometry(); let w = 0;
      this.k.forEach((K, mi) => {
        const n = K.p.length / 3; if (!n) return;
        P.set(K.p, w * 3); N.set(K.n, w * 3); U.set(K.u, w * 2);
        geo.addGroup(w, n, mi); w += n;
      });
      geo.setAttribute('position', new THREE.BufferAttribute(P, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(N, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(U, 2));
      const m = new THREE.Mesh(geo, materials); m.name = name; m.castShadow = m.receiveShadow = true;
      return m;
    }
  }

  const heightFor = (type, wmm, dmm) => {
    const s = Math.min(wmm, dmm);
    return type === 'tan' ? 0.4 + 0.45 * s : type === 'white' ? 0.55 : (s > 1.3 ? 0.6 : 0.5);
  };
  const mats = [photoF, tinEnd, body.black, body.tan, body.white];
  const matsB = [photoB, tinEnd, body.black, body.tan, body.white];

  // ---- front chips
  {
    const B = new Batch('front');
    for (const [x0, y0, x1, y1, ori, type] of D.CHIPS_F) {
      const b = f.box([x0, y0, x1, y1]);
      B.add({ cx: b.cx, cz: b.cz, w: b.w, d: b.d, h: heightFor(type, b.w, b.d), y0: 0, ori, type });
    }
    const gg = grp('chips-front', { label: `Chip passives, front (${B.count})`, kind: 'passive', status: 'photo-derived',
      desc: `${B.count} larger chip parts (resistor/capacitor class, roughly 0603 to 1210 sized) traced on photo 4 (front). Body colour classes (black, tan, light) follow the photo; heights are assumed. 0402-class parts and bare pad pairs stay texture-only.` });
    gg.add(B.mesh(mats, 'chips-front'));
  }
  // ---- back chips
  {
    const B = new Batch('back');
    for (const [x0, y0, x1, y1, ori, type] of D.CHIPS_B) {
      const b = reg.box([x0, y0, x1, y1]);
      const h = Math.min(0.85, heightFor(type, b.w, b.d));
      B.add({ cx: b.cx, cz: b.cz, w: b.w, d: b.d, h, y0: -T - h, ori, type });
    }
    const gg = grp('chips-back', { label: `Chip passives, back (${B.count})`, kind: 'passive', status: 'photo-derived',
      desc: `${B.count} larger chip parts (resistor/capacitor class) traced on photo 4 (back); they hang a short distance below the underside. Body colour classes follow the photo; heights are assumed (kept under 0.9 mm so the module still seats). Tiny parts stay texture-only.` });
    gg.add(B.mesh(matsB, 'chips-back'));
  }
  // ---- bare (unpopulated) footprints on the back: thin raised tin pads
  {
    const padH = 0.05;
    const mk = (list) => {
      const B = new Batch('back');
      for (const box of list) { const b = reg.box(box); B.add({ cx: b.cx, cz: b.cz, w: b.w, d: b.d, h: padH, y0: -T - padH, ori: 'p', type: 'black' }); }
      return B;
    };
    const q = mk(D.BARE_QFN_B);
    const gq = grp('qfn-footprint-back', { label: 'Unpopulated QFN-style footprint (back)', kind: 'other', status: 'photo-derived',
      desc: 'Photo 4 (back) shows bare silver pads here (40 perimeter pads at about 0.4 mm pitch and a 3 x 3 centre pad) and no package body, so no IC is modelled; the pads are drawn as thin raised tin only. Pad sizes are traced from the photo, thickness is assumed.' });
    gq.add(q.mesh(matsB, 'qfn-pads'));
    const bg = mk(D.BARE_BIG_B);
    const gb = grp('bare-pads-back', { label: 'Unpopulated large pads (back)', kind: 'other', status: 'photo-derived',
      desc: 'Six large rectangular bare solder pads on the back face with nothing mounted on them in photo 4 (back); drawn as thin raised tin. Their intended use is not stated.' });
    gb.add(bg.mesh(matsB, 'big-pads'));
  }
}
