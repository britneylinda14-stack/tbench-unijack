// Collision / clearance check, driven by tools/collide.mjs. Samples points on Mercury's body (vertices, instance centres and a
// dense grid over the PCB faces) and tests them against the world AABBs of the base-board parts, at the seated pose and across
// the whole insertion path. AABBs of the base parts are tight (they are axis-aligned boxes), so this has few false positives.
import * as THREE from 'three';
import { createUniJack } from './model.js';

(async () => {
  try {
    const kit = await createUniJack();
    const labelOf = (o) => { for (; o; o = o.parent) if (o.userData?.label && o.userData.kind !== 'board') return (o.userData.ref ? o.userData.ref + ' ' : '') + o.userData.label; return '(board)'; };
    const isEngaging = (l) => /J400|latch/i.test(l);            // the socket and its latches are SUPPOSED to touch the module
    const leaves = (root) => { const L = []; root.traverse((o) => { if ((o.isMesh || o.isInstancedMesh) && o.visible) L.push(o); }); return L; };
    const baseMeshes = leaves(kit.base), merMeshes = leaves(kit.merPivot);
    const baseSlab = baseMeshes.find((o) => o.name === 'pcb');
    const tmp = new THREE.Vector3(), M = new THREE.Matrix4();

    function samplePoints() {
      const pts = [];
      for (const o of merMeshes) {
        const lab = labelOf(o); const pos = o.geometry.attributes.position;
        if (o.isInstancedMesh) { for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, M); tmp.setFromMatrixPosition(M); pts.push({ p: o.localToWorld(tmp.clone()), lab }); } continue; }
        const step = Math.max(1, Math.floor(pos.count / 400));
        for (let i = 0; i < pos.count; i += step) pts.push({ p: o.localToWorld(tmp.fromBufferAttribute(pos, i).clone()), lab });
        if (o.name === 'pcb') {                                   // dense grid over both faces of the module PCB
          o.geometry.computeBoundingBox(); const b = o.geometry.boundingBox;
          for (let x = b.min.x; x <= b.max.x; x += 2) for (let z = b.min.z; z <= b.max.z; z += 2) for (const y of [b.min.y, b.max.y]) pts.push({ p: o.localToWorld(new THREE.Vector3(x, y, z)), lab: 'Mercury PCB' });
        }
      }
      return pts;
    }
    function baseBoxes() {
      kit.root.updateMatrixWorld(true);
      return baseMeshes.filter((o) => o !== baseSlab).map((o) => ({ b: new THREE.Box3().setFromObject(o), lab: labelOf(o) })).filter((x) => !isEngaging(x.lab) && isFinite(x.b.min.x));
    }
    const boxes = baseBoxes();
    const slabBox = new THREE.Box3().setFromObject(baseSlab);

    function check(ins) {
      kit.setInsertion(ins); kit.setExplode(0); kit.root.updateMatrixWorld(true);
      const pts = samplePoints(), hits = new Map(); let clearance = new Map();
      for (const { p, lab } of pts) {
        for (const { b, lab: bl } of boxes) {
          const inXZ = p.x > b.min.x && p.x < b.max.x && p.z > b.min.z && p.z < b.max.z;
          if (!inXZ) continue;
          const c = p.y - b.max.y;                                 // vertical clearance above this part's top
          if (p.y > b.min.y + 0.05) { if (c < 0.05) { const k = lab + ' <> ' + bl; const d = Math.min(-c, p.y - b.min.y); if (!hits.has(k) || hits.get(k) < d) hits.set(k, d); } }
          if (c >= 0 && (!clearance.has(bl) || clearance.get(bl) > c)) clearance.set(bl, c);
        }
        if (p.y < -0.05 && p.x > slabBox.min.x && p.x < slabBox.max.x && p.z > slabBox.min.z && p.z < slabBox.max.z) { const k = lab + ' <> base PCB'; hits.set(k, Math.max(hits.get(k) || 0, -p.y)); }
      }
      return { ins, n: pts.length, hits: [...hits].map(([k, d]) => ({ pair: k, depth_mm: +d.toFixed(2) })).sort((a, b) => b.depth_mm - a.depth_mm), minClearance: [...clearance].map(([k, c]) => ({ part: k, mm: +c.toFixed(2) })).sort((a, b) => a.mm - b.mm).slice(0, 6) };
    }
    const states = [1, 0.95, 0.9, 0.85, 0.8, 0.7, 0.62, 0.5, 0.35, 0.2, 0];
    window.__collide = states.map(check);
    window.__mate = kit.mate;
    kit.setInsertion(1);
    window.__ready = true;
  } catch (e) { console.error(e); window.__error = String((e && e.stack) || e); }
})();
