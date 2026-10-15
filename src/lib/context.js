import * as THREE from 'three';
import { makeFrame } from './frame.js';
import { makeMaterials } from './materials.js';
import * as prim from './primitives.js';

export const BOARD_T = 1.6;   // mm, ASSUMED (standard PCB thickness; not measured)

/** Everything a part builder needs. Builders are pure functions of this context. */
export async function makeContext(baseUrl) {
  // single-file bundles embed the assets (data: URIs) in window.__UNIJACK_ASSETS; otherwise fetch them next to the page
  const EMB = globalThis.__UNIJACK_ASSETS;
  if (!EMB) baseUrl ??= new URL('../../', import.meta.url);
  const scale = EMB ? EMB['data/scale.json'] : await (await fetch(new URL('data/scale.json', baseUrl))).json();
  const loader = new THREE.TextureLoader();
  const load = (n) => new Promise((res, rej) => loader.load(EMB ? EMB['assets/tex/' + n] : new URL('assets/tex/' + n, baseUrl).href, (t) => {
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.generateMipmaps = true; res(t);
  }, undefined, rej));
  const [base, peri, mercuryFront, mercuryBack] = await Promise.all([
    load('base-top.webp'), load('peri-top.webp'), load('mercury-front.webp'), load('mercury-back.webp')]);
  // Surface-finish maps derived from the photos by colour segmentation (tools/derive-maps.py, assets/tex/derived/README.md):
  // <tex>-rm.webp (G roughness, B metalness) and <tex>-nrm.webp (mild relief; none for the back photo). Linear data, same pixel grid.
  // They hang on the colour texture (texture.userData.derived) so mat.photoTop(tex) picks them up; a missing map just means a flat finish.
  const loadData = (n) => new Promise((res) => loader.load(EMB ? EMB['assets/tex/derived/' + n] : new URL('assets/tex/derived/' + n, baseUrl).href, (t) => {
    t.colorSpace = THREE.NoColorSpace; t.anisotropy = 8; t.generateMipmaps = true; res(t);
  }, undefined, () => res(null)));
  await Promise.all([[base, 'base-top'], [peri, 'peri-top'], [mercuryFront, 'mercury-front'], [mercuryBack, 'mercury-back']].map(async ([t, n]) => {
    if (EMB && !EMB['assets/tex/derived/' + n + '-rm.webp']) return;
    const [rm, nrm] = await Promise.all([loadData(n + '-rm.webp'), n === 'mercury-back' ? null : loadData(n + '-nrm.webp')]);
    t.userData.derived = { rm, nrm };
  }));
  const tp = scale.tex_px, sp = scale.tex_px_per_mm;
  return {
    THREE, prim, scale, dims: scale.dims_mm, BOARD_T,
    tex: { base, peri, mercuryFront, mercuryBack },
    mat: makeMaterials(),
    // one frame per source texture: pixel <-> mm for that texture
    frames: {
      base: makeFrame(tp.base, sp.base),
      peri: makeFrame(tp.peri, sp.peri),
      mercuryFront: makeFrame(tp.mercury, sp.mercury),
      mercuryBack: makeFrame(tp.mercury, sp.mercury),
    },
  };
}
