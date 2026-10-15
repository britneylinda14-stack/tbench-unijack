// QA renderer page. Driven by tools/qa-render.mjs via query string:
//   only=all|base|peri|mercury   view=top|bottom|oblique|custom   mode=photo|footprint|clay
//   az, el (degrees, oblique)    ins, exp (0..1 model state)       w, h (px; top/bottom default to the texture size)
//   cam=x,y,z,tx,ty,tz (custom)  fov
//   post=0|1 (EffectComposer: GTAO + SMAA + OutputPass; default ON for oblique/custom photo renders, OFF for top/bottom/footprint/clay)
//   dof=1 (depth of field, needs post)   env=studio|sweep|room   shadow=pcf|vsm   ao=0 (post without AO)   fit=0 (no shadow-camera fit)
//   gain=, penv= (PHOTO_GAIN / PHOTO_ENV calibration sweeps)   look=key:8,fill:4.6,sheen:7,envIntensity:1.25,keyLight:2.4 (stage preset overrides)   exposure=
import * as THREE from 'three';
import { createUniJack } from './model.js';
import { makeStage } from './lib/stage.js';
import { makePost } from './lib/post.js';

const q = new URLSearchParams(location.search);
const only = q.get('only') || 'all', view = q.get('view') || 'oblique', mode = q.get('mode') || 'photo';
const num = (k, d) => (q.has(k) ? parseFloat(q.get(k)) : d);

const KIND_COLOR = { connector: 0xff3b30, ic: 0x34c759, passive: 0xffcc00, cap: 0xff9500, pin: 0xaf52de, latch: 0x5ac8fa, led: 0xff2d92, module: 0x0a84ff, other: 0xffffff };

globalThis.__PHOTO_GAIN = q.has('gain') ? parseFloat(q.get('gain')) : undefined;   // calibration sweeps
globalThis.__PHOTO_ENV = q.has('penv') ? parseFloat(q.get('penv')) : undefined;    // (was `env`, which collided with the stage's env kind and fed NaN into the shader for --env=room)
// stage preset overrides: map radiances (key, fill, rim, sheen, top, bottom, ceiling) and light intensities (envIntensity, keyLight, rimLight, hemi)
function parseLook(s) {
  if (!s) return null;
  const look = { map: {} }, lights = { envIntensity: 'envIntensity', keyLight: 'key', rimLight: 'rim', hemi: 'hemi' }, satin = {};
  for (const kv of s.split(',')) {
    const [k, v] = kv.split(':'); if (!k || v === undefined) continue;
    if (lights[k]) look[lights[k]] = parseFloat(v);
    else if (k === 'satinColor') satin.color = '#' + v; else if (k === 'satinEnv') satin.envMapIntensity = parseFloat(v); else if (k === 'satinSpec') satin.specularIntensity = parseFloat(v);
    else look.map[k] = parseFloat(v);
  }
  if (Object.keys(satin).length) look.satin = { color: '#22262b', envMapIntensity: 0.6, specularIntensity: 0.3, ...satin };
  return look;
}
(async () => {
  try {
    const rectify = q.has('rectify') ? q.get('rectify') === '1' : !(mode === 'footprint' || view === 'top' || view === 'bottom');   // overlays compare against UNrectified textures
    const kit = await createUniJack({ rectify });
    const fr = kit.ctx.frames;
    const frame = only === 'base' ? fr.base : only === 'peri' ? fr.peri : only === 'mercury' ? fr.mercuryFront : null;
    let W = num('w', 0), H = num('h', 0);
    if ((view === 'top' || view === 'bottom') && frame && !W) { W = frame.wpx; H = frame.hpx; }
    if ((view === 'top' || view === 'bottom') && !frame && !W) {   // whole kit: canvas in the kit's plan aspect (the ortho frame below is the kit box)
      kit.setVisible({ base: true, peri: true, mercury: true }); kit.setInsertion(num('ins', 1)); kit.setExplode(num('exp', 0)); kit.root.updateMatrixWorld(true);
      const b = new THREE.Box3(); kit.root.traverse((o) => { if ((o.isMesh || o.isInstancedMesh) && !o.userData.stage) b.expandByObject(o); });
      const s = b.getSize(new THREE.Vector3()); W = 1600; H = Math.round(W * s.z / s.x);
    }
    W = W || 1600; H = H || 900;

    const canvas = document.createElement('canvas'); document.body.appendChild(canvas);
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1); renderer.setSize(W, H, false);
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';

    const footprint = mode === 'footprint';
    const stage = makeStage(renderer, { shadows: !footprint, env: q.get('env') || 'studio', shadowType: q.get('shadow') || 'pcf', look: parseLook(q.get('look')), exposure: num('exposure', 1.0) });
    const wantPost = q.has('post') ? q.get('post') === '1' : (mode === 'photo' && (view === 'oblique' || view === 'custom'));
    kit.setVisible({ base: only === 'all' || only === 'base', peri: only === 'all' || only === 'peri', mercury: only === 'all' || only === 'mercury' });
    kit.setInsertion(num('ins', 1)); kit.setExplode(num('exp', 0));
    for (const n of (q.get('hide') || '').split(',').filter(Boolean)) { const o = kit.root.getObjectByName(n); if (o) o.visible = false; else console.warn('hide: no object named', n); }
    if (kit.base.userData.buildErrors?.length) console.error('BUILD ERRORS: ' + kit.base.userData.buildErrors.join(' ; '));
    stage.scene.add(kit.root);

    if (footprint) {
      renderer.toneMapping = THREE.NoToneMapping; stage.scene.background = new THREE.Color(0x000000);
      stage.scene.environment = null; stage.ground.visible = false; stage.backdrop.visible = false; stage.scene.fog = null;
      stage.scene.traverse((o) => {
        if (!(o.isMesh || o.isInstancedMesh) || o.userData.stage) return;
        let k = null, n = o; while (n && !k) { k = n.userData?.kind; n = n.parent; }
        const col = k === 'board' ? 0x000000 : (KIND_COLOR[k] ?? KIND_COLOR.other);
        o.material = new THREE.MeshBasicMaterial({ color: col });
      });
    } else if (mode === 'clay') {
      stage.scene.traverse((o) => { if ((o.isMesh || o.isInstancedMesh) && !o.userData.stage) o.material = new THREE.MeshStandardMaterial({ color: 0xb8c0c8, roughness: 0.7 }); });
    }

    // camera
    kit.root.updateMatrixWorld(true);
    const box = new THREE.Box3();
    kit.root.traverseVisible((o) => { if ((o.isMesh || o.isInstancedMesh) && !o.userData.stage) box.expandByObject(o); });
    const ctr = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
    let cam;
    if (view === 'top' || view === 'bottom') {
      // exact orthographic frame of the board's texture so the render overlays the photo 1:1; for the whole kit (only=all) the frame is
      // the kit's bounding box with a 2 percent margin, centred on it (it used to centre on Mercury, which cropped the kit)
      const target = new THREE.Vector3();
      if (frame) (only === 'base' ? kit.base : only === 'peri' ? kit.peri : kit.mercury).getWorldPosition(target); else target.copy(ctr);
      const hw = frame ? frame.W / 2 : size.x / 2 * 1.02, hd = frame ? frame.D / 2 : size.z / 2 * 1.02;
      cam = new THREE.OrthographicCamera(-hw, hw, hd, -hd, 0.1, 1000);
      cam.up.set(0, 0, -1);
      const dir = view === 'top' ? 1 : -1;
      cam.position.set(target.x, target.y + dir * 300, target.z); cam.lookAt(target.x, target.y, target.z);
    } else {
      const fov = num('fov', 30);
      cam = new THREE.PerspectiveCamera(fov, W / H, 1, 3000);
      if (view === 'custom' && q.has('cam')) {
        const c = q.get('cam').split(',').map(Number);
        cam.position.set(c[0], c[1], c[2]); cam.lookAt(c[3], c[4], c[5]);
      } else {
        const r = (size.length() / 2) / Math.sin(THREE.MathUtils.degToRad(fov / 2)) * 0.92;
        const az = THREE.MathUtils.degToRad(num('az', 35)), el = THREE.MathUtils.degToRad(num('el', 35));
        cam.position.set(ctr.x + r * Math.cos(el) * Math.sin(az), ctr.y + r * Math.sin(el), ctr.z + r * Math.cos(el) * Math.cos(az));
        cam.lookAt(ctr);
      }
    }
    if (q.get('fit') !== '0') stage.fitShadow(box);
    const post = wantPost ? makePost(renderer, stage.scene, cam, { ao: q.get('ao') !== '0', dof: q.get('dof') === '1', aa: true }) : null;
    if (post) post.focusAt(ctr); window.__post = post;
    renderer.info.autoReset = false;   // count the whole frame (shadow pass + every post pass), not just the last renderer.render()
    const draw = () => { renderer.info.reset(); if (post) post.render(); else renderer.render(stage.scene, cam); };
    // frame time INCLUDING GPU completion: readPixels of one pixel after gl.finish() blocks until the frame is done (plain performance.now() around
    // the draw only measures command submission, which once read 75 ms plain vs 31 ms with the post chain, the inverse of the real cost)
    const gl = renderer.getContext(), px = new Uint8Array(4);
    const sync = () => { gl.finish(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
    draw(); sync();
    const t0 = performance.now(); draw(); sync(); const frameMs = performance.now() - t0;

    let meshes = 0, tris = 0;
    kit.root.traverseVisible((o) => {
      if (!(o.isMesh || o.isInstancedMesh)) return; meshes++;
      const g = o.geometry, n = (g.index ? g.index.count : g.attributes.position.count) / 3;
      tris += n * (o.isInstancedMesh ? o.count : 1);
    });
    window.__stats = { meshes, triangles: Math.round(tris), canvas: [W, H], drawCalls: renderer.info.render.calls, post: post ? post.state : null, passes: post ? post.passCount : 0, frameMs: Math.round(frameMs), env: stage.envKind };
    window.__stage = stage; window.__kit = kit; window.__cam = cam; window.__renderer = renderer;
    window.__ready = true;
  } catch (e) { console.error(e); window.__error = String(e && e.stack || e); }
})();
