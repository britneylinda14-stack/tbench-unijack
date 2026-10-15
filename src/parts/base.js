// Orchestrator for the base board. The slab is built here; the two halves are built by separate modules
// (base-left.js, base-right.js) that can be developed independently. A failing half is reported, not fatal.
export async function build(ctx) {
  const { THREE, prim, mat, frames, tex, BOARD_T } = ctx;
  const g = new THREE.Group(); g.name = 'base';
  prim.boardSlab(g, { frame: frames.base, topTex: tex.base, mats: mat, thickness: BOARD_T, radius: 0.8, box: ctx.scale.board_px_box?.base });
  prim.meta(g, { label: 'UniJack base board', kind: 'board', status: 'photo-derived', desc: 'Board outline and size derived from the flat-lay photo; 1.6 mm thickness assumed.' });
  g.userData.anchors = {};
  g.userData.latches = [];
  g.userData.buildErrors = [];
  const HALVES = [['base-left', () => import('./base-left.js')], ['base-right', () => import('./base-right.js')]];
  for (const [name, load] of HALVES) {
    const grp = new THREE.Group(); grp.name = name; g.add(grp);
    try {
      const mod = await load();
      const r = (await mod.build(ctx, grp)) || {};
      Object.assign(g.userData.anchors, r.anchors || {});
      g.userData.latches.push(...(r.latches || []));
    } catch (e) { console.error(`${name} failed:`, e); g.userData.buildErrors.push(`${name}: ${e && e.message}`); }
  }
  // defaults if a half did not supply its anchors
  g.userData.anchors.socket ??= { x: -37, z: -2.5, seatY: 3.5 };
  g.userData.anchors.periMount ??= { x: 58.5, z: 0, y: 9.6 };
  return g;
}
