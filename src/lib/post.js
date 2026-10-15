// Post-processing chain shared by the viewer and the QA renderer:
//   RenderPass -> GTAOPass (ambient occlusion) -> DepthBokehPass (optional depth of field) -> SMAAPass -> OutputPass
// Tone mapping and the sRGB conversion happen in the OutputPass (it reads renderer.toneMapping / outputColorSpace), so the
// scene is rendered linear into a half-float target and the picture matches a plain renderer.render() apart from the effects.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/** BokehPass that reads the depth texture the GTAO pass already rendered instead of drawing the whole scene a second time. */
class DepthBokehPass extends BokehPass {
  constructor(scene, camera, params, depthTexture) {
    super(scene, camera, params);
    this.materialBokeh.defines.DEPTH_PACKING = 0;   // a real depth texture: read .x, no RGBA unpacking
    this.materialBokeh.needsUpdate = true;
    this.uniforms.tDepth.value = depthTexture;
  }
  render(renderer, writeBuffer, readBuffer) {
    this.uniforms.tColor.value = readBuffer.texture;
    this.uniforms.nearClip.value = this.camera.near; this.uniforms.farClip.value = this.camera.far;
    const oldAutoClear = renderer.autoClear; renderer.autoClear = false;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    if (!this.renderToScreen) renderer.clear();
    this._fsQuad.render(renderer);
    renderer.autoClear = oldAutoClear;
  }
  setSize(width, height) { this.materialBokeh.uniforms.aspect.value = width / height; }   // no depth target of its own
}

// AO in scene units (millimetres): a 3.5 mm search radius gives contact darkening under connector bodies and the module without greying whole faces
export const AO_PARAMS = { radius: 3.5, distanceExponent: 1.0, thickness: 1.2, scale: 1.0, samples: 16, distanceFallOff: 1.0, screenSpaceRadius: false };
export const PD_PARAMS = { lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 4, radiusExponent: 1, rings: 2, samples: 16 };
// depth of field (hero only): focus is set per frame to the distance of the kit; aperture is in 1/mm, maxblur in UV units
export const DOF_PARAMS = { focus: 400, aperture: 0.000012, maxblur: 0.002 };   // about 1 px of blur per 50 mm from the focus plane at 1600 px, never more than 3 px

/**
 * makePost(renderer, scene, camera, { ao, dof, aa, width, height }) -> { composer, render, setSize, set, focusAt, state, passCount }
 * `set({ ao, dof })` toggles passes without rebuilding; `state` tells what is on. All full-screen passes are counted in `passCount`.
 */
export function makePost(renderer, scene, camera, { ao = true, dof = false, aa = true, width, height } = {}) {
  const size = renderer.getSize(new THREE.Vector2()); width = width || size.x; height = height || size.y;
  const pr = renderer.getPixelRatio(), W = Math.round(width * pr), H = Math.round(height * pr);
  const composer = new EffectComposer(renderer); composer.setPixelRatio(pr); composer.setSize(width, height);
  const renderPass = new RenderPass(scene, camera);
  const gtao = new GTAOPass(scene, camera, W, H, undefined, AO_PARAMS, PD_PARAMS);
  gtao.output = GTAOPass.OUTPUT.Default; gtao.blendIntensity = 1.0;
  const bokeh = new DepthBokehPass(scene, camera, DOF_PARAMS, gtao.depthTexture);
  const smaa = new SMAAPass(W, H);
  const output = new OutputPass();
  composer.addPass(renderPass); composer.addPass(gtao); composer.addPass(bokeh); composer.addPass(smaa); composer.addPass(output);
  const state = { ao, dof, aa };
  function apply() {
    gtao.enabled = state.ao;
    bokeh.enabled = state.dof && state.ao;   // the DOF reads the AO pass's depth texture, so it needs that pass
    smaa.enabled = state.aa;
  }
  apply();
  const _c = new THREE.Vector3(), _m = new THREE.Matrix4();
  return {
    composer, passes: { renderPass, gtao, bokeh, smaa, output }, state,
    render() {
      // the GTAO pass renders the scene a second time (normals + depth); render the shadow map only once per frame
      const sm = renderer.shadowMap, auto = sm.autoUpdate; sm.autoUpdate = false; sm.needsUpdate = true;
      composer.render();
      sm.autoUpdate = auto;
    },
    setSize(w, h) { composer.setSize(w, h); },
    set(o) { Object.assign(state, o); apply(); },
    /** focus the DOF at a world point (distance along the camera axis) */
    focusAt(point) { camera.updateMatrixWorld(); _m.copy(camera.matrixWorld).invert(); _c.copy(point).applyMatrix4(_m); bokeh.uniforms.focus.value = -_c.z; },
    get passCount() { return [gtao, bokeh, smaa, output].filter((p) => p.enabled).length; },
  };
}
