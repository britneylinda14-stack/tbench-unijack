import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export const BG = '#080b10';
// graded studio backdrop (a rendering choice, not the photo's white sweep): like a dark sweep lit from the front it is lightest at the horizon,
// where it meets the satin table, and falls off to near-black overhead. The values are PRE tone mapping: Khronos PBR Neutral subtracts a black
// offset from dark colours (and shifts their hue), so '#44474b' comes out about (38,42,47) and '#282a2c' about (10,13,17) on screen.
export const BACKDROP_TOP = '#282a2c', BACKDROP_BOTTOM = '#44474b';

/**
 * The two environments the viewer offers. Both are rendering choices; neither is the photographer's set-up (the gallery photos were shot on a
 * white sweep, the 'sweep' option imitates that). `map` are the radiances of the StudioEnvironment panels, `envIntensity` scales the whole
 * map, `key`/`rim` are the shadow-casting directional key and the cool rim, `backdrop` colours are pre tone mapping (sweep whites are over 1
 * so they come out near paper white after the Neutral shoulder). The two share the same light energy on the board (the mask colour differs
 * by under 10 percent between them, checked by tools/viewer-shots.mjs); the sweep's walls are bright so metals reflect something.
 */
export const ENVS = {
  studio: {
    map: { key: 11.0, fill: 6.5, rim: 4.5, sheen: 1.8, top: 0.7, bottom: 0.18, ceiling: 1.3 },
    envIntensity: 1.25, key: 3.2, rim: 0.55, hemi: 0.25,
    backdrop: { top: BACKDROP_TOP, horizon: BACKDROP_BOTTOM }, ground: 'satin',
    satin: { color: '#22262b', envMapIntensity: 0.45, specularIntensity: 0.3 },
  },
  sweep: {
    map: { key: 7.3, fill: 4.9, rim: 2.0, sheen: 1.8, top: 1.7, bottom: 1.35, ceiling: 1.85 },
    envIntensity: 1.25, key: 3.2, rim: 0.25, hemi: 0.25,
    backdrop: { top: new THREE.Color(2.2, 2.2, 2.15), horizon: new THREE.Color(1.3, 1.3, 1.28) }, ground: 'paper',
  },
  room: {   // the previous RoomEnvironment rig, kept for comparison (QA only)
    map: null, envIntensity: 0.85, key: 2.3, rim: 1.2, hemi: 0.8, backdrop: null, ground: 'catcher',
  },
};

/**
 * Procedural studio for image-based lighting (rendered once through PMREMGenerator, like RoomEnvironment):
 * a large soft key box above-front-left (slightly warm), a cooler fill panel front-right, a cool rim strip behind, a big soft "sheen" panel
 * behind-left and high (it is what a glossy solder mask mirrors in the Hero view, like the softbox sheen in gallery-1.jpg; it casts no shadow),
 * and a graded room (floor, walls, ceiling). Units are arbitrary; everything sits inside the PMREM far plane (100).
 * The direction of the shadow-casting key agrees with gallery-1.jpg, where the headers' shadows fall to the lower right.
 */
export class StudioEnvironment extends THREE.Scene {
  constructor({ key = 5.5, fill = 3.6, rim = 4.5, sheen = 0, top = 0.35, bottom = 0.08, ceiling = top * 2 } = {}) {
    super();
    this.name = 'StudioEnvironment';
    const emit = (r, g, b, k) => new THREE.MeshBasicMaterial({ color: new THREE.Color(r * k, g * k, b * k), side: THREE.FrontSide });
    // room: vertex-graded box seen from inside
    const room = new THREE.BoxGeometry(70, 44, 70); room.deleteAttribute('uv');
    const pos = room.getAttribute('position'), col = new Float32Array(pos.count * 3), cT = new THREE.Color(0.80, 0.87, 0.95), cB = new THREE.Color(0.92, 0.95, 1.0);
    for (let i = 0; i < pos.count; i++) {
      const t = THREE.MathUtils.smoothstep((pos.getY(i) + 22) / 44, 0, 1), k = THREE.MathUtils.lerp(bottom, top, t);
      col[i * 3] = THREE.MathUtils.lerp(cB.r, cT.r, t) * k; col[i * 3 + 1] = THREE.MathUtils.lerp(cB.g, cT.g, t) * k; col[i * 3 + 2] = THREE.MathUtils.lerp(cB.b, cT.b, t) * k;
    }
    room.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const roomMesh = new THREE.Mesh(room, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide }));
    roomMesh.position.y = 12; this.add(roomMesh);
    const panel = (w, h, x, y, z, mat) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); m.position.set(x, y, z); m.lookAt(0, 0, 0); this.add(m); return m; };
    this.key = panel(40, 28, -17, 24, 16, emit(1.0, 0.955, 0.90, key));     // big soft box, above and in front, from the left: slightly warm
    this.fill = panel(34, 24, 26, 6, 18, emit(0.84, 0.91, 1.0, fill));      // cool fill, low and to the right (lights the vertical faces and the pins)
    this.rim = panel(44, 3.5, 6, 11, -30, emit(0.62, 0.84, 1.0, rim));      // thin cool strip behind the subject: edge light on the connectors and the board edge
    if (sheen > 0) this.sheen = panel(44, 26, -13, 18, -21, emit(0.94, 0.97, 1.0, sheen));   // in the mirror direction of the Hero camera (az 32, el 34) about the board normal
    this.ceil = panel(44, 44, 0, 33, -6, emit(0.80, 0.87, 0.96, ceiling)); this.ceil.rotation.set(Math.PI / 2, 0, 0);
  }
}

/** Graded backdrop: a big dome, one colour at and below the horizon (where the table fades into it) grading to another overhead. */
function makeBackdrop(radius) {
  const g = new THREE.SphereGeometry(radius, 48, 24);
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 3), 3));
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false }));   // tone mapped like everything else, so the plain and the composer path agree
  m.name = 'backdrop'; m.frustumCulled = false; m.castShadow = m.receiveShadow = false; m.userData.stage = true;
  return m;
}
function colourBackdrop(mesh, topC, horC) {
  const g = mesh.geometry, pos = g.getAttribute('position'), col = g.getAttribute('color'), radius = g.parameters.radius;
  const top = new THREE.Color(topC), hor = new THREE.Color(horC), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) { const t = THREE.MathUtils.smoothstep(pos.getY(i) / radius, 0.0, 0.55); c.lerpColors(hor, top, t); col.setXYZ(i, c.r, c.g, c.b); }
  col.needsUpdate = true;
}

const GROUND_SIZE = 1600;
function radialAlpha(N = 256, r0 = 200 / GROUND_SIZE, r1 = 520 / GROUND_SIZE) {
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const r = Math.hypot((x + 0.5) / N - 0.5, (y + 0.5) / N - 0.5), a = 1 - THREE.MathUtils.smoothstep(r, r0, r1), i = (y * N + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = Math.round(a * 255); data[i + 3] = 255;
  }
  const t = new THREE.DataTexture(data, N, N); t.magFilter = t.minFilter = THREE.LinearFilter; t.needsUpdate = true;
  return t;
}

export function buildEnvironment(renderer, kind = 'studio', map) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = kind === 'room' ? pmrem.fromScene(new RoomEnvironment(), 0.03) : pmrem.fromScene(new StudioEnvironment(map || ENVS[kind]?.map || ENVS.studio.map), 0.02);
  pmrem.dispose();
  return env;
}

/**
 * Lighting rig shared by the viewer and the QA renderer so QA images show what users see.
 *   env: 'studio' (default) | 'sweep' (white backdrop and table, like the photos) | 'room' (the previous RoomEnvironment rig, kept for comparison)
 *   shadowType: 'pcf' (default: 5-tap Vogel PCF with a radius) | 'vsm'
 *   look: overrides for the env preset (map radiances and light intensities, see ENVS) for calibration sweeps
 * Tone mapping and the colour space are set on the renderer; when the viewer renders through the EffectComposer (lib/post.js) the
 * OutputPass applies the same settings at the end of the chain, so the picture is identical either way.
 * stage.setEnv(name) switches between the environments at run time (the viewer's Backdrop chip, ?env=sweep).
 */
export function makeStage(renderer, { shadows = true, env = 'studio', shadowType = 'pcf', look = null, exposure = 1.0 } = {}) {
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;   // Khronos PBR Neutral: keeps solder-mask hue and saturation (ACES lifts red in saturated teal)
  renderer.toneMappingExposure = exposure;
  renderer.shadowMap.enabled = shadows;
  renderer.shadowMap.type = shadowType === 'vsm' ? THREE.VSMShadowMap : THREE.PCFShadowMap;   // PCFSoftShadowMap was removed in r18x and logged a warning on every load

  const scene = new THREE.Scene();
  const backdrop = makeBackdrop(1800); scene.add(backdrop);   // radius: inside the QA camera's far plane (3000) from any orbit distance (max 900)

  // the studio map carries the ambient and the soft specular; the hemisphere only lifts the deepest shadows a little
  const hemi = new THREE.HemisphereLight('#dff1ff', '#0b1118', 0.25); scene.add(hemi);
  const key = new THREE.DirectionalLight('#fff1dd', 1.7);       // the shadow-casting part of the key box; warm like the panel
  key.position.set(-90, 170, 70); key.castShadow = shadows;
  const keyDir = key.position.clone().normalize();              // FIXED direction of the key (fitShadow moves the light along it; never re-derived from a moved position)
  key.shadow.mapSize.set(4096, 4096);
  Object.assign(key.shadow.camera, { left: -140, right: 140, top: 140, bottom: -140, near: 10, far: 500 });
  if (shadowType === 'vsm') { key.shadow.bias = -0.0002; key.shadow.normalBias = 0.2; key.shadow.radius = 6; key.shadow.blurSamples = 12; }
  else { key.shadow.bias = -0.0003; key.shadow.normalBias = 0.3; key.shadow.radius = 32; }   // radius in shadow-map texels (5-tap Vogel disk)
  scene.add(key); scene.add(key.target);
  const rim = new THREE.DirectionalLight('#6fd6ff', 0.55);
  rim.position.set(120, 60, -130); scene.add(rim);

  // ---- grounds (all built once, one shown) ----
  const GROUND_Y = -1.75;
  // dark satin table (studio): a MeshPhysicalMaterial that reflects the studio map near the kit (the soft key box reads as a broad sheen) and receives
  // the key's shadow. It carries its OWN envMap reference so envMapIntensity is honoured (with scene.environment alone, r186 overwrites
  // material.envMapIntensity with scene.environmentIntensity). specularIntensity caps the grazing-angle Fresnel reflection (F90), which is what
  // turned the table into a light grey floor in the Side preset; roughness 0.8 blurs the reflection to the room's average. It is a disc that
  // fades out between 200 and 520 mm from the kit, so far away it is the backdrop that is seen.
  const satinMat = new THREE.MeshPhysicalMaterial({ color: '#1a1d21', roughness: 0.8, metalness: 0.0, specularIntensity: 0.25, envMapIntensity: 0.35, alphaMap: radialAlpha(), transparent: true, depthWrite: false });
  const satin = new THREE.Mesh(new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE), satinMat);
  // white sweep (paper): an unlit white plane whose colour is chosen to come out near paper white after tone mapping, with the key's shadow laid
  // over it by a ShadowMaterial (so the soft shadow stays visible however bright the sweep is) and the AO pass darkening the contact.
  const paper = new THREE.Group();
  const paperMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.3, 1.3, 1.28) });
  const paperPlane = new THREE.Mesh(new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE), paperMat);
  const paperShadow = new THREE.Mesh(new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE), new THREE.ShadowMaterial({ opacity: 0.42 }));
  paperShadow.position.z = 0.02; paperShadow.name = 'ground-shadow'; paper.add(paperPlane, paperShadow);
  // plain shadow catcher (room rig)
  const catcher = new THREE.Mesh(new THREE.PlaneGeometry(700, 700), new THREE.ShadowMaterial({ opacity: 0.3 }));
  const grounds = { satin, paper, catcher };
  for (const g of Object.values(grounds)) {
    g.rotation.x = -Math.PI / 2; g.position.y = GROUND_Y; g.visible = false; g.name = 'ground';
    g.traverse((o) => { o.receiveShadow = true; o.userData.stage = true; if (!o.name) o.name = 'ground'; });
    scene.add(g);
  }

  let envRT = null, current = null;
  const stage = { scene, key, rim, hemi, backdrop, grounds, keyDir, ground: null, env: null, envKind: null, preset: null, fitShadow, rebuildEnvironment, setEnv };

  /** Switch the environment (studio | sweep | room). `rebuildOnly` keeps the old render target (after a context loss its GL objects are already gone). */
  function setEnv(kind = 'studio', { rebuildOnly = false } = {}) {
    const p0 = ENVS[kind] || ENVS.studio; kind = ENVS[kind] ? kind : 'studio';
    const p = look ? { ...p0, ...look, map: p0.map ? { ...p0.map, ...(look.map || {}) } : null } : p0;
    const old = envRT; envRT = buildEnvironment(renderer, kind, p.map);
    if (old && !rebuildOnly) old.dispose();
    scene.environment = envRT.texture; scene.environmentIntensity = p.envIntensity;
    satinMat.envMap = envRT.texture; satinMat.needsUpdate = true;
    if (p.satin) { satinMat.color.set(p.satin.color); satinMat.envMapIntensity = p.satin.envMapIntensity; satinMat.specularIntensity = p.satin.specularIntensity; }
    key.intensity = p.key; rim.intensity = p.rim; hemi.intensity = p.hemi;
    if (p.backdrop) { backdrop.visible = true; colourBackdrop(backdrop, p.backdrop.top, p.backdrop.horizon); scene.background = new THREE.Color(p.backdrop.horizon); }
    else { backdrop.visible = false; scene.background = new THREE.Color(BG); }
    for (const [n, g] of Object.entries(grounds)) g.visible = n === p.ground;
    stage.ground = grounds[p.ground]; stage.env = envRT; stage.envKind = current = kind; stage.preset = p;
    return envRT;
  }

  /** Fit the key's orthographic shadow camera tightly around a world-space box (plus its shadow on the ground), so the 4k map's texels are spent on the kit. */
  const _c = new THREE.Vector3(), _p = new THREE.Vector3(), _m = new THREE.Matrix4();
  function fitShadow(box, margin = 6) {
    if (!box || box.isEmpty()) return;
    const b = box.clone(); b.min.y = Math.min(b.min.y, GROUND_Y); b.expandByScalar(margin);
    b.getCenter(_c); key.target.position.copy(_c); key.target.updateMatrixWorld();
    const dist = b.getSize(_p).length();
    key.position.copy(_c).addScaledVector(keyDir, dist * 1.5); key.updateMatrixWorld();   // along the fixed direction: 0 degrees of drift between fits
    // light view matrix (the light object itself is never rotated; its shadow camera looks from the light at the target)
    _m.lookAt(key.position, _c, new THREE.Vector3(0, 1, 0)).setPosition(key.position).invert();
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let i = 0; i < 8; i++) {
      _p.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).applyMatrix4(_m);
      x0 = Math.min(x0, _p.x); x1 = Math.max(x1, _p.x); y0 = Math.min(y0, _p.y); y1 = Math.max(y1, _p.y); z0 = Math.min(z0, _p.z); z1 = Math.max(z1, _p.z);
    }
    const cam = key.shadow.camera;
    cam.left = x0; cam.right = x1; cam.bottom = y0; cam.top = y1; cam.near = Math.max(0.5, -z1 - 2); cam.far = -z0 + 2;
    cam.updateProjectionMatrix();
  }
  /** Rebuild the environment map (after a WebGL context loss; the old target's GL objects died with the context). */
  function rebuildEnvironment() { return setEnv(current, { rebuildOnly: true }); }

  setEnv(env);
  return stage;
}
