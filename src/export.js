// Headless GLB export page, driven by tools/export-glb.mjs (?instancing=1 keeps EXT_mesh_gpu_instancing).
// Exports the kit as users see it in the viewer (rectified, seated, not exploded) with
//   * named, unique nodes ('base/J301', 'base/J303/body', ...), scene 'UniJack kit'
//   * only the honesty metadata (ref, label, kind, status, statusNote, desc) in glTF extras; no viewer internals
//   * neutral albedo on the photo materials (the viewer's PHOTO_GAIN is a viewer-specific lighting calibration)
//   * one merged plain Mesh per former InstancedMesh (no extension needed) unless ?instancing=1
//   * the not-CAD note in asset.extras, asset.copyright, the scene and the root node
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createUniJack } from './model.js';

const KEEP_INSTANCING = new URLSearchParams(location.search).has('instancing');
const EXTRAS_WHITELIST = ['ref', 'label', 'kind', 'status', 'statusNote', 'desc'];

const NOTE = 'Illustrative, photo-anchored model of the UniJack kit. NOT CAD. Units: millimetres. Heights, stack height, PCB thickness, '
  + 'plastic and metal colours, detail geometry and the insertion and explode motion are assumed or synthetic. '
  + 'Board sizes are photo-derived (base about 160 x 87 mm, PeriBoard about 45 x 87 mm, Mercury about 35.5 x 69.6 mm). '
  + 'Undersides of the base board and PeriBoard were not photographed.';
const LIGHTING_NOTE = 'Photo textures are exported at neutral albedo (base colour factor 1.0). The UniJack viewer relights the photographs and its '
  + 'colours were matched to the photos by mean luminance only (hue and highlights are approximate); other renderers should light the photo '
  + 'textures accordingly. The photographs already contain their own lighting and highlights. This file carries no lights. '
  + 'The metallic-roughness and normal textures of the photo materials are PHOTO-DERIVED by colour segmentation of the photographs (teal = solder mask, '
  + 'white = silkscreen, grey = tin, black = IC body, tan = gold, pale pixels enclosed by a black body = matte IC marking), not measured; the relief in the '
  + 'normal textures is synthetic (silkscreen proud, pads below the mask); metal pixels use the photo colour as their specular colour. A grey plastic part '
  + '(for example the SO-DIMM socket housing) therefore reads as metal. Each map has a provenance sidecar (assets/tex/derived/<map>.webp.json) in the source repository; they are stored lossless here (PNG), the photo textures as JPEG.';
const COPYRIGHT = 'Illustrative model, NOT CAD. Photo textures are derived from the TBench / Crowd Supply gallery photographs; '
  + 'permission to redistribute them has not been confirmed.';
const STATUS_KEY = {
  'photo-verified': 'A designator or marking is legible in a photo. The footprint is photo-derived and the height is assumed.',
  'photo-derived': 'The footprint is measured from a photo. Height and detail shape are assumed.',
  assumed: 'Not visible in any photo (for example PCB thickness, stack height, undersides).',
};

const setStatus = (t) => { const el = document.getElementById('status'); if (el) el.textContent = t; };

/** Copy only whitelisted string metadata; report which other keys were dropped. */
function sanitiseUserData(obj, dropped) {
  const out = {};
  for (const k of Object.keys(obj.userData || {})) {
    if (EXTRAS_WHITELIST.includes(k) && typeof obj.userData[k] === 'string' && obj.userData[k]) out[k] = obj.userData[k];
    else dropped.set(k, (dropped.get(k) || 0) + 1);
  }
  obj.userData = out;
}

/** One merged indexed Mesh from an InstancedMesh (instance matrices baked into the vertices). */
function mergeInstanced(im) {
  if (Array.isArray(im.material)) throw new Error(`InstancedMesh '${im.name}' has a material array; merge not implemented`);
  const m4 = new THREE.Matrix4(), parts = [];
  for (let i = 0; i < im.count; i++) {
    im.getMatrixAt(i, m4);
    const g = im.geometry.clone(); g.clearGroups(); g.applyMatrix4(m4); parts.push(g);
  }
  const geo = mergeGeometries(parts, false);
  if (!geo) throw new Error(`merge failed for InstancedMesh '${im.name}'`);
  parts.forEach((g) => g.dispose());
  const mesh = new THREE.Mesh(geo, im.material);
  mesh.name = im.name; mesh.visible = im.visible;
  mesh.position.copy(im.position); mesh.quaternion.copy(im.quaternion); mesh.scale.copy(im.scale);
  mesh.userData = im.userData;
  const parent = im.parent, idx = parent.children.indexOf(im);
  parent.children[idx] = mesh; mesh.parent = parent; im.parent = null;
  return { instances: im.count, vertices: geo.attributes.position.count, triangles: (geo.index ? geo.index.count : geo.attributes.position.count) / 3 };
}

/**
 * Unique, meaningful node names.
 *   structural nodes keep their names (UniJack-kit, base, peri, mercury, mercury-pivot, peri-rig)
 *   labelled parts keep their board-prefixed names ('base/J301', 'peri/J301', 'mercury/...'); a labelled part without a designator becomes '<board>/<label>'
 *   every other node is '<parent name>/<own name or mesh|group>'; siblings that would share a name get '_1', '_2', ...
 *   a last global pass appends '#2', '#3' to any remaining duplicate
 */
function nameNodes(kit) {
  const boards = new Map([[kit.base, 'base'], [kit.peri, 'peri'], [kit.mercury, 'mercury']]);
  for (const [o, n] of boards) o.name = n;
  const structural = new Set([kit.root, kit.merPivot, kit.periRig, ...boards.keys()]);
  const count = new Map(); kit.root.traverse((o) => count.set(o.name, (count.get(o.name) || 0) + 1));
  const used = new Set(); let renamed = 0;
  const isLabelled = (o) => !!o.userData?.label && o.userData.kind !== 'board';
  const claim = (n) => { let r = n, k = 1; while (used.has(r)) r = `${n}#${++k}`; used.add(r); return r; };
  const leaf = (n) => n.slice(n.lastIndexOf('/') + 1);
  const visit = (o, board) => {
    const parentName = o.name, cand = new Map();
    const kids = o.children.filter((c) => !structural.has(c));
    for (const c of kids) {
      const stem = (c.name || (c.isMesh ? 'mesh' : 'group')).replace(/\s*\/\s*/g, ' - ');                    // a '/' inside a label must not look like a path separator
      let n;
      if (c.name.startsWith(`${board}/`) && count.get(c.name) === 1) n = c.name;                                   // board-prefixed and unique (model.js / builders): keep
      else if (isLabelled(c)) n = c.name.startsWith(`${board}/`) ? c.name : `${isLabelled(o) ? parentName : board}/${stem}`;
      else { const pl = leaf(parentName); n = `${parentName}/${stem.startsWith(`${pl}-`) ? stem.slice(pl.length + 1) : stem}`; }
      c._cand = n; cand.set(n, (cand.get(n) || 0) + 1);
    }
    const seen = new Map();
    for (const c of kids) {
      let n = c._cand; delete c._cand;
      if (cand.get(n) > 1 && !(c.name.startsWith(`${board}/`) && count.get(c.name) === 1)) { const i = (seen.get(n) || 0) + 1; seen.set(n, i); n = `${n}_${i}`; }
      const before = c.name; c.name = claim(n); if (c.name !== before) renamed++;
      visit(c, boards.get(c) || board);
    }
  };
  for (const s of structural) used.add(s.name);
  // structural children of the root that are not in `kids` still need their own subtrees named
  for (const s of structural) if (s !== kit.root) visit(s, boards.get(s) || (s === kit.merPivot ? 'mercury' : s === kit.periRig ? 'peri' : 'base'));
  visit(kit.root, 'base');
  return { renamed };
}

(async () => {
  try {
    const report = { instancing: KEEP_INSTANCING };
    setStatus('building kit...');
    const kit = await createUniJack();
    kit.setInsertion(1); kit.setExplode(0);                      // seated and not exploded, rectified (model.js default)

    // ---- drop viewer-only objects ----
    kit.root.getObjectByName('explode-guides')?.removeFromParent();
    report.patchesRemoved = 0; report.patchesVisibleBeforeRemoval = 0;
    for (const p of kit.patches || []) { if (p.visible) report.patchesVisibleBeforeRemoval++; p.removeFromParent(); report.patchesRemoved++; }   // synthetic latch texture patch: hidden when seated; never exported
    const invisible = []; kit.root.traverse((o) => { if (!o.visible) invisible.push(o.name || o.type); });
    report.invisibleSkipped = invisible;

    // ---- textures and materials ----
    const texNames = new Map([[kit.ctx.tex.base, 'base-top'], [kit.ctx.tex.peri, 'peri-top'], [kit.ctx.tex.mercuryFront, 'mercury-front'], [kit.ctx.tex.mercuryBack, 'mercury-back']]);
    for (const [t, n] of texNames) {
      t.name = n; t.userData.mimeType = 'image/jpeg';   // JPEG keeps the GLB small
      const d = t.userData.derived || {};                // derived finish maps ride along as metallicRoughness / normal textures
      if (d.rm) { d.rm.name = n + '-rm'; d.rm.userData.mimeType = 'image/png'; }     // data maps stay lossless (JPEG put errors of up to 0.48 into the metalness channel)
      if (d.nrm) { d.nrm.name = n + '-nrm'; d.nrm.userData.mimeType = 'image/png'; }
    }
    const libNames = new Map(Object.entries(kit.ctx.mat).filter(([, v]) => v && v.isMaterial).map(([k, v]) => [v, k]));
    const allMats = new Set(); kit.root.traverse((o) => { for (const m of [].concat(o.material || [])) allMats.add(m); });
    report.materialsBefore = allMats.size;
    // neutral albedo on the photo materials: the viewer's PHOTO_GAIN is a viewer-specific lighting calibration, not a property of the photos
    const gainBefore = new Set();
    for (const m of allMats) if (m.map) { gainBefore.add(JSON.stringify([m.color.r, m.color.g, m.color.b].map((v) => +v.toFixed(3)))); m.color.setRGB(1, 1, 1); }
    // identical materials (everything glTF can express) become one shared material; the shared ctx.mat library entries win
    const sig = (m) => JSON.stringify([m.type, m.color.getHex(), m.roughness, m.metalness, m.opacity, m.transparent, m.alphaTest, m.side, m.emissive.getHex(), m.emissiveIntensity,
      [m.map, m.normalMap, m.roughnessMap, m.metalnessMap, m.emissiveMap, m.aoMap, m.bumpMap].map((t) => t?.uuid)]);
    const canon = new Map(), rep = new Map();
    for (const m of [...allMats].sort((a, b) => libNames.has(b) - libNames.has(a))) { const k = sig(m); if (!canon.has(k)) canon.set(k, m); rep.set(m, canon.get(k)); }
    kit.root.traverse((o) => { if (o.material) o.material = Array.isArray(o.material) ? o.material.map((m) => rep.get(m)) : rep.get(o.material); });
    const usedMatNames = new Set();
    for (const m of canon.values()) {
      const pct = (v) => Math.round(v * 100), hex = m.color.getHexString();
      const n = libNames.get(m) || (m.map ? `photo-${texNames.get(m.map) || 'texture'}-r${pct(m.roughness)}`
        : `mat-${hex}-r${pct(m.roughness)}-m${pct(m.metalness)}${m.side === THREE.DoubleSide ? '-ds' : ''}${m.emissive.getHex() ? '-emissive' : ''}`);
      let r = n, k = 1; while (usedMatNames.has(r)) r = `${n}#${++k}`;
      usedMatNames.add(r); m.name = r;
      if (m.map && !m.map.userData.mimeType) m.map.userData.mimeType = 'image/jpeg';
    }
    const mats = new Set(canon.values());
    report.materialsAfter = mats.size;
    report.photoAlbedoBefore = [...gainBefore].map((g) => JSON.parse(g));
    report.photoAlbedoAfter = [...new Set([...mats].filter((m) => m.map).map((m) => JSON.stringify([m.color.r, m.color.g, m.color.b])))].map((g) => JSON.parse(g));

    // ---- UVs only where a texture uses them ----
    const geoUsers = new Map();
    kit.root.traverse((o) => { if ((o.isMesh || o.isInstancedMesh) && o.geometry) { const t = [].concat(o.material || []).some((m) => m.map); geoUsers.set(o.geometry, (geoUsers.get(o.geometry) || false) || t); } });
    report.uvDropped = 0;
    for (const [g, textured] of geoUsers) if (!textured) for (const a of ['uv', 'uv1', 'uv2', 'uv3']) if (g.attributes[a]) { g.deleteAttribute(a); report.uvDropped++; }

    // ---- InstancedMesh -> one merged Mesh (unless ?instancing=1) ----
    const inst = []; kit.root.traverse((o) => { if (o.isInstancedMesh) inst.push(o); });
    report.instancedMeshes = inst.length; report.instances = inst.reduce((s, o) => s + o.count, 0);
    if (!KEEP_INSTANCING) {
      let v = 0, t = 0;
      for (const im of inst) { const r = mergeInstanced(im); v += r.vertices; t += r.triangles; }
      report.mergedVertices = v; report.mergedTriangles = t;
    }

    // ---- names, then sanitised extras ----
    report.naming = nameNodes(kit);
    const dropped = new Map();
    kit.root.traverse((o) => {
      sanitiseUserData(o, dropped);
      for (const m of [].concat(o.material || [])) m.userData = {};
      if (o.geometry) o.geometry.userData = {};
    });
    report.droppedUserDataKeys = Object.fromEntries(dropped);

    // ---- honesty notes: root node, scene, asset ----
    const ns = (o) => ({ x: +o.scale.x.toFixed(4), y: +o.scale.y.toFixed(4), z: +o.scale.z.toFixed(4) });
    const rectification = { base: ns(kit.base), peri: ns(kit.peri), mercury: ns(kit.mercury) };
    const fmt = (k, o) => `${k} x ${o.x} and z ${o.z}`;
    const scaleNote = `Node scale is deliberately non-uniform: the base board group is scaled ${fmt('', rectification.base).trim()}, the PeriBoard group ${fmt('', rectification.peri).trim()}, `
      + `Mercury ${fmt('', rectification.mercury).trim()}. This rectifies each board's photo texture to its measured true scale (the flat-lay photo is a composite of separately scaled cut-outs); heights (y) are not scaled. `
      + 'Keep the node transforms as stored: a tool that ignores non-uniform node scale will show these boards at their unrectified photo proportions.';
    const fullNote = `${NOTE} ${LIGHTING_NOTE} ${scaleNote}`;    // one complete note: importers that show only one of these fields still get every caveat
    const assetExtras = {
      note: fullNote,
      units: 'millimetres (1 glTF unit = 1 mm)',
      frame: 'Board-local axes: +x right in the photo, +z down in the photo, +y up out of the board. The base board top surface is y = 0.',
      pose: 'Assembled and seated (insertion complete, latches closed, not exploded). No animation. The synthetic texture patch used while the latches are open is not included.',
      rectification,
      statusKey: STATUS_KEY,
      nodeExtras: 'Node extras carry ref, label, kind, status, statusNote and desc only. A ref is a designator printed on the board and legible in a photo.',
    };
    kit.root.userData = { ...kit.root.userData, note: fullNote };
    const scene = new THREE.Scene(); scene.name = 'UniJack kit';
    scene.userData = { note: fullNote };
    scene.add(kit.root);

    // board extents as exported (world, mm): checks the sizes quoted in the note against the geometry
    scene.updateMatrixWorld(true);
    report.boardExtentsMm = {};
    for (const [k, b] of [['base', kit.base], ['peri', kit.peri], ['mercury', kit.mercury]]) {
      const pcb = b.children.find((c) => c.name === `${k}/pcb`) || b.getObjectByName(`${k}/pcb`);
      if (pcb) { const bb = new THREE.Box3().setFromObject(pcb); report.boardExtentsMm[k] = [+(bb.max.x - bb.min.x).toFixed(1), +(bb.max.z - bb.min.z).toFixed(1), +(bb.max.y - bb.min.y).toFixed(2)]; }
    }

    kit.root.traverse((o) => { if (o.isMesh || o.isInstancedMesh) o.castShadow = o.receiveShadow = false; });

    setStatus('exporting...');
    const exporter = new GLTFExporter();
    exporter.register((writer) => ({
      afterParse() {
        writer.json.asset.generator = `unijack-3d src/export.js via THREE.GLTFExporter r${THREE.REVISION}`;
        writer.json.asset.extras = assetExtras;
        for (const n of writer.json.nodes || []) { const m = n.mesh !== undefined && writer.json.meshes[n.mesh]; if (m && !m.name && n.name) m.name = n.name; }   // glTF mesh names = node names (unique per node)
      },
    }));
    const buf = await exporter.parseAsync(scene, { binary: true, trs: true, maxTextureSize: 2048, copyright: COPYRIGHT });
    let bin = ''; const u8 = new Uint8Array(buf); const CH = 0x8000;
    for (let i = 0; i < u8.length; i += CH) bin += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    window.__report = report;
    window.__glb = btoa(bin); window.__ready = true;
    setStatus(`done: ${(u8.length / 1048576).toFixed(2)} MB`);
  } catch (e) { console.error(e); window.__error = String((e && e.stack) || e); setStatus(window.__error); }
})();
