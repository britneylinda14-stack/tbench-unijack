#!/usr/bin/env node
// Export the assembled kit (seated, not exploded, rectified as in the viewer) to assets/unijack.glb, then check the result.
//   node tools/export-glb.mjs [--out=assets/unijack.glb] [--instancing] [--validator=<dir of the gltf-validator package or its node_modules parent>]
//   --instancing   keep EXT_mesh_gpu_instancing (default: merge every InstancedMesh into one plain Mesh, no extension needed)
// Prints size, node/mesh/material counts, duplicate-name count, extras size and the Khronos glTF validator result
// (validator: `npm i gltf-validator` in this folder, in any qa-out/<dir>, or in another scratch dir with --validator=<that dir> or GLTF_VALIDATOR_DIR set).
// Exit code 1 when the export fails, the validator reports errors, node names are missing or duplicated, extras carry anything
// beyond the allowed keys, a required extension is present without --instancing, or a photo material is not at neutral albedo.
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const OUT = path.resolve(ROOT, args.out || 'assets/unijack.glb');
const INSTANCING = !!args.instancing;
const NODE_EXTRAS_OK = new Set(['ref', 'label', 'kind', 'status', 'statusNote', 'desc', 'note']);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/favicon')) { res.writeHead(204); return res.end(); }
  const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const exe = (() => { const b = '/opt/pw-browsers'; for (const d of fs.existsSync(b) ? fs.readdirSync(b) : []) { const c = path.join(b, d, 'chrome-linux', 'chrome'); if (d.startsWith('chromium-') && fs.existsSync(c)) return c; } })();

/** Load the Khronos glTF validator from the first place it is installed, else null. */
function loadValidator() {
  const scratch = []; try { for (const d of fs.readdirSync(path.join(ROOT, 'qa-out'))) scratch.push(path.join(ROOT, 'qa-out', d)); } catch { /* no qa-out */ }   // a scratch install (npm i gltf-validator) under any qa-out/<dir>
  const dirs = [args.validator, process.env.GLTF_VALIDATOR_DIR, ROOT, ...scratch].filter((d) => typeof d === 'string').map((d) => path.resolve(d));
  for (const d of dirs) {
    for (const c of [d, path.join(d, 'node_modules', 'gltf-validator')]) {
      let isPkg = false; try { isPkg = JSON.parse(fs.readFileSync(path.join(c, 'package.json'), 'utf8')).name === 'gltf-validator'; } catch { /* not a package dir */ }
      if (isPkg) {
        try { return { mod: createRequire(path.join(c, 'x.js'))(c), dir: c }; } catch (e) { console.log(`validator at ${c} failed to load: ${e.message}`); }
      }
    }
  }
  return null;
}

const fail = []; // hard failures (exit code 1)
const browser = await chromium.launch({ executablePath: exe, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
try {
  const page = await browser.newPage(); const errs = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(`${m.type()}: ${m.text()}`); });
  await page.goto(`http://127.0.0.1:${server.address().port}/export.html${INSTANCING ? '?instancing=1' : ''}`);
  await page.waitForFunction(() => window.__ready || window.__error, null, { timeout: 240000 });
  const err = await page.evaluate(() => window.__error); if (err) throw new Error(err);
  const b64 = await page.evaluate(() => window.__glb);
  const rep = await page.evaluate(() => window.__report);
  const buf = Buffer.from(b64, 'base64'); fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT, buf);

  // ---- parse the container ----
  if (buf.subarray(0, 4).toString() !== 'glTF') throw new Error('not a GLB');
  const jlen = buf.readUInt32LE(12), json = JSON.parse(buf.subarray(20, 20 + jlen).toString()), blen = buf.readUInt32LE(20 + jlen);
  const nodes = json.nodes || [], meshes = json.meshes || [], mats = json.materials || [], acc = json.accessors || [];
  const mb = (n) => (n / 1048576).toFixed(2);
  console.log(`${OUT}`);
  console.log(`size      ${mb(buf.length)} MB  (json ${mb(jlen)} MB, bin ${mb(blen)} MB)   mode: ${INSTANCING ? 'EXT_mesh_gpu_instancing kept' : 'instances merged into plain meshes'}`);

  // ---- counts ----
  const prims = meshes.flatMap((m) => m.primitives);
  const verts = prims.reduce((s, p) => s + acc[p.attributes.POSITION].count, 0);
  const tris = prims.reduce((s, p) => s + (p.indices !== undefined ? acc[p.indices].count : acc[p.attributes.POSITION].count) / 3, 0);
  const images = json.images || [];
  const imgBytes = images.reduce((s, im) => s + json.bufferViews[im.bufferView].byteLength, 0);
  console.log(`counts    nodes=${nodes.length} meshes=${meshes.length} primitives=${prims.length} materials=${mats.length} textures=${(json.textures || []).length} images=${images.length} (${mb(imgBytes)} MB)  vertices=${verts} triangles=${Math.round(tris)}`);
  const ext = { used: json.extensionsUsed || [], required: json.extensionsRequired || [] };
  console.log(`extensions used=[${ext.used.join(', ')}] required=[${ext.required.join(', ')}]`);
  if (!INSTANCING && ext.required.length) fail.push(`required extensions without --instancing: ${ext.required.join(', ')}`);

  // ---- names ----
  const names = nodes.map((n) => n.name || ''), cnt = new Map(); names.forEach((n) => n && cnt.set(n, (cnt.get(n) || 0) + 1));
  const dups = [...cnt].filter(([, c]) => c > 1), unnamed = names.filter((n) => !n).length;
  console.log(`names     unnamed=${unnamed} duplicate-names=${dups.length}${dups.length ? ' ' + JSON.stringify(dups.slice(0, 8)) : ''}  scene='${json.scenes?.[0]?.name}'  labelled=${nodes.filter((n) => n.extras?.label).length} with-ref=${nodes.filter((n) => n.extras?.ref).length}`);
  if (dups.length) fail.push(`${dups.length} duplicate node names`);
  if (unnamed) fail.push(`${unnamed} unnamed nodes`);
  if (json.scenes?.[0]?.name !== 'UniJack kit') fail.push(`scene name is '${json.scenes?.[0]?.name}'`);
  const matNames = mats.map((m) => m.name || ''), mcnt = new Map(); matNames.forEach((n) => mcnt.set(n, (mcnt.get(n) || 0) + 1));
  console.log(`materials unnamed=${matNames.filter((n) => !n).length} duplicate-names=${[...mcnt].filter(([n, c]) => n && c > 1).length}`);

  // ---- extras ----
  const exNodes = nodes.map((n, i) => ({ n, size: n.extras ? JSON.stringify(n.extras).length : 0 })).filter((x) => x.size);
  const totalEx = exNodes.reduce((s, x) => s + x.size, 0), big = exNodes.sort((a, b) => b.size - a.size)[0];
  const keys = new Set(); nodes.forEach((n) => n.extras && Object.keys(n.extras).forEach((k) => keys.add(k)));
  const bad = [...keys].filter((k) => !NODE_EXTRAS_OK.has(k));
  const otherEx = [...(json.materials || []), ...(json.scenes || []), ...prims].filter((o) => o.extras).length;
  console.log(`extras    node extras=${exNodes.length} total=${(totalEx / 1024).toFixed(1)} KB largest=${big ? big.size + ' B (' + big.n.name + ')' : '-'} keys=[${[...keys].join(', ')}]  unexpected=[${bad.join(', ')}]  material/primitive/scene extras=${otherEx}`);
  if (bad.length) fail.push(`unexpected extras keys: ${bad.join(', ')}`);
  const ax = json.asset || {};
  console.log(`asset     generator='${ax.generator}'  copyright=${ax.copyright ? 'yes' : 'NO'}  extras keys=[${Object.keys(ax.extras || {}).join(', ')}]  note ${ax.extras?.note ? 'present (' + ax.extras.note.length + ' chars, "NOT CAD": ' + /NOT CAD/.test(ax.extras.note) + ')' : 'MISSING'}`);
  const NEED = [/NOT CAD/, /Units: millimetres/, /neutral albedo/, /relights the photographs/, /mean luminance only/, /non-uniform/, /not photographed/];
  const miss = (t) => NEED.filter((re) => !re.test(t || '')).map(String);
  if (miss(ax.extras?.note).length) fail.push(`asset.extras.note lacks ${miss(ax.extras?.note).join(' ')}`);
  const root = nodes[json.scenes?.[0]?.nodes?.[0]];
  console.log(`root      '${root?.name}' extras.note=${root?.extras?.note ? 'present (' + root.extras.note.length + ' chars)' : 'MISSING'}  scene note ${json.scenes?.[0]?.extras?.note ? 'present' : 'MISSING'}  note covers: CAD, units, albedo, relighting, luminance, node scale, undersides -> ${miss(root?.extras?.note).length ? 'INCOMPLETE ' + miss(root?.extras?.note).join(' ') : 'all'}`);
  if (miss(root?.extras?.note).length) fail.push(`root note lacks ${miss(root?.extras?.note).join(' ')}`);
  if (!json.scenes?.[0]?.extras?.note) fail.push('scene note missing');

  // ---- node scale (rectification), materials ----
  for (const nm of ['base', 'peri', 'mercury']) { const n = nodes.find((x) => x.name === nm); console.log(`scale     ${nm.padEnd(8)} scale=${JSON.stringify(n?.scale ?? [1, 1, 1])} translation=${JSON.stringify(n?.translation ?? [0, 0, 0])}`); }
  const photo = mats.filter((m) => m.pbrMetallicRoughness?.baseColorTexture);
  const factors = [...new Set(photo.map((m) => JSON.stringify(m.pbrMetallicRoughness.baseColorFactor ?? [1, 1, 1, 1])))];
  console.log(`photo     materials=${photo.length} baseColorFactor=${factors.join(' ')}  (the viewer's photo gain was ${JSON.stringify(rep?.photoAlbedoBefore)}, not exported)`);
  if (factors.some((f) => JSON.parse(f).slice(0, 3).some((v) => v !== 1))) fail.push('photo materials not at neutral albedo');
  // a plain-material primitive that shares its mesh's single UV accessor with a photo-textured sibling primitive costs nothing (one accessor)
  const hasTex = (p) => !!mats[p.material]?.pbrMetallicRoughness?.baseColorTexture;
  let uvShared = 0, uvLoose = 0;
  for (const m of meshes) for (const p of m.primitives) if (p.attributes.TEXCOORD_0 !== undefined && !hasTex(p)) (m.primitives.some((q) => hasTex(q) && q.attributes.TEXCOORD_0 === p.attributes.TEXCOORD_0) ? uvShared++ : uvLoose++);
  const bytesOf = (name) => { const seen = new Set(); let s = 0; for (const p of prims) { const a = p.attributes[name]; if (a !== undefined && !seen.has(a)) { seen.add(a); const x = acc[a]; s += x.count * ({ VEC3: 12, VEC2: 8, VEC4: 16 }[x.type] || 4); } } return s; };
  const idxBytes = (() => { const seen = new Set(); let s = 0; for (const p of prims) if (p.indices !== undefined && !seen.has(p.indices)) { seen.add(p.indices); s += acc[p.indices].count * ({ 5125: 4, 5123: 2, 5121: 1 }[acc[p.indices].componentType] || 4); } return s; })();
  console.log(`uv        TEXCOORD_0 on plain-material primitives: sharing the UV accessor of a photo-textured sibling primitive=${uvShared} (no size cost), on meshes with no texture at all=${uvLoose}`);
  console.log(`geometry  bytes: POSITION ${mb(bytesOf('POSITION'))} MB, NORMAL ${mb(bytesOf('NORMAL'))} MB, TEXCOORD_0 ${mb(bytesOf('TEXCOORD_0'))} MB, indices ${mb(idxBytes)} MB`);
  if (uvLoose) fail.push(`${uvLoose} untextured meshes still carry UVs`);

  // ---- page-side report ----
  console.log(`page      photo albedo ${JSON.stringify(rep.photoAlbedoBefore)} -> ${JSON.stringify(rep.photoAlbedoAfter)}  materials ${rep.materialsBefore} -> ${rep.materialsAfter}  uv attributes dropped=${rep.uvDropped}`);
  console.log(`          instanced meshes=${rep.instancedMeshes} (${rep.instances} instances)${INSTANCING ? '' : ` merged -> ${rep.mergedVertices} vertices, ${rep.mergedTriangles} triangles`}  patches removed=${rep.patchesRemoved} (visible before removal: ${rep.patchesVisibleBeforeRemoval}) invisible skipped=${rep.invisibleSkipped.length}  nodes renamed=${rep.naming.renamed}`);
  console.log(`          userData keys dropped from extras: ${JSON.stringify(rep.droppedUserDataKeys)}`);
  console.log(`          board extents as exported [x, z, thickness] mm: ${JSON.stringify(rep.boardExtentsMm)}`);

  // ---- Khronos validator ----
  const V = loadValidator();
  if (!V) console.log('validator not installed: run `npm i gltf-validator` in a scratch dir and pass --validator=<dir> (or set GLTF_VALIDATOR_DIR)');
  else {
    const res = await V.mod.validateBytes(new Uint8Array(buf), { maxIssues: 0, uri: path.basename(OUT) });
    const is = res.issues, codes = {};
    for (const m of is.messages) codes[`${['error', 'warning', 'info', 'hint'][m.severity]}:${m.code}`] = (codes[`${['error', 'warning', 'info', 'hint'][m.severity]}:${m.code}`] || 0) + 1;
    console.log(`validator gltf-validator ${V.mod.version?.() ?? ''}: errors=${is.numErrors} warnings=${is.numWarnings} infos=${is.numInfos} hints=${is.numHints}  ${JSON.stringify(codes)}`);
    for (const m of is.messages.filter((x) => x.severity <= 1).slice(0, 10)) console.log(`          ${['ERROR', 'WARNING'][m.severity]} ${m.code} ${m.pointer}: ${m.message}`);
    if (is.numErrors) fail.push(`${is.numErrors} validator errors`);
  }
  if (errs.length) console.log('console messages:', errs.slice(0, 5));
  if (fail.length) { console.log('FAIL: ' + fail.join('; ')); process.exitCode = 1; } else console.log('OK');
} catch (e) { console.error('export failed:', e.message); process.exitCode = 1; }
finally { await browser.close(); server.close(); }
