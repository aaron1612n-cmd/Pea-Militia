import * as THREE from 'three';

// Final image pass for the high quality tier. The world is drawn into a half-float target, then
// one full-screen shader does, in order: camera motion blur (skipped for reduced motion), screen
// space ambient occlusion from the depth buffer, filmic tone mapping, colour grade, vignette and
// film grain. The first-person gun is drawn afterwards straight onto the screen so it stays crisp.
const VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const FRAG = `
#include <common>
#include <packing>
varying vec2 vUv;
uniform sampler2D tColor; uniform sampler2D tDepth;
uniform vec2 res; uniform float near; uniform float far; uniform float projY;
uniform float time; uniform float aoAmt; uniform float grainAmt; uniform float vigAmt;
uniform vec2 blurVec; uniform float night; uniform float wet; uniform float flash; uniform float hurt;
float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
float linZ(vec2 uv){ float d = texture2D(tDepth, uv).x; return -perspectiveDepthToViewZ(d, near, far); }
void main(){
  vec2 uv = vUv;
  vec3 c = texture2D(tColor, uv).rgb;
  if (dot(blurVec, blurVec) > 1e-9) {
    // eight taps along the screen-space sweep of the camera, centred on this pixel, each nudged by a
    // little noise so a fast turn smears smoothly instead of showing stepped copies of the picture
    float jit = ign(gl_FragCoord.xy) - 0.5;
    c = vec3(0.0);
    for (int i = 0; i < 8; i++) {
      float k = ((float(i) + 0.5 + jit * 0.8) / 8.0 - 0.5);
      c += texture2D(tColor, uv + blurVec * k).rgb;
    }
    c *= 0.125;
  }
  float d = texture2D(tDepth, uv).x;
  if (aoAmt > 0.0 && d < 0.99999) {
    float L = linZ(uv);
    float R = 0.9;                              // world radius of the occlusion test, metres
    float px = R * projY * res.y * 0.5 / max(L, 0.3);
    px = clamp(px, 3.0, res.y * 0.07);
    float rot = ign(gl_FragCoord.xy) * 6.2831853;
    float occ = 0.0;
    for (int i = 0; i < 10; i++) {
      float t = (float(i) + 0.5) / 10.0;
      float a = rot + float(i) * 2.399963;
      vec2 o = vec2(cos(a), sin(a)) * sqrt(t) * px / res;
      float Ls = linZ(uv + o);
      float dz = L - Ls;                        // positive: the neighbour is in front of us
      occ += smoothstep(0.04, 0.2, dz) * (1.0 - smoothstep(R * 0.6, R * 1.8, dz));
    }
    float ao = 1.0 - aoAmt * occ / 10.0 * (1.0 - smoothstep(35.0, 110.0, L));
    c *= ao;
  }
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  vec3 s = gl_FragColor.rgb;
  float lum = dot(s, vec3(0.299, 0.587, 0.114));
  // gentle S-curve, cool shadows and warm highlights, a touch less colour when it is wet and grim
  s = mix(s, s * s * (3.0 - 2.0 * s), 0.22);
  s += vec3(-0.008, 0.004, 0.014) * (1.0 - lum) + vec3(0.016, 0.008, -0.012) * lum * lum;
  s = mix(vec3(lum), s, 1.0 - 0.16 * wet - 0.12 * night);
  // lightning and the red edge of a hit
  s += flash * vec3(0.5, 0.55, 0.7);
  s = mix(s, vec3(0.45, 0.02, 0.02), hurt * 0.18);
  vec2 q = vUv - 0.5; q.x *= res.x / res.y;
  s *= 1.0 - vigAmt * smoothstep(0.38, 1.05, length(q));
  float g = (ign(gl_FragCoord.xy + fract(time * 7.13) * 91.0) - 0.5);
  s += g * grainAmt * (1.15 - lum);
  gl_FragColor = vec4(s, 1.0);
}`;

export class Post {
  constructor(renderer, { samples = 4, reduced = false } = {}) {
    this.r = renderer;
    this.reduced = reduced;
    this.samples = samples;
    this.rt = null;
    this.u = {
      tColor: { value: null }, tDepth: { value: null }, res: { value: new THREE.Vector2(1, 1) },
      near: { value: 0.05 }, far: { value: 700 }, projY: { value: 1 }, time: { value: 0 },
      aoAmt: { value: 0.85 }, grainAmt: { value: reduced ? 0.02 : 0.035 }, vigAmt: { value: 0.32 },
      blurVec: { value: new THREE.Vector2() }, night: { value: 0 }, wet: { value: 0 }, flash: { value: 0 }, hurt: { value: 0 },
    };
    this.mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.u, depthTest: false, depthWrite: false, toneMapped: true });
    // one big triangle covers the screen
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
    this.quad = new THREE.Mesh(g, this.mat);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.prevView = new THREE.Matrix4();
    this.prevProj = new THREE.Matrix4();
    this.have = false;
    this.blur = 0.6; // 0 turns camera blur off
    this.p = new THREE.Vector3();
  }

  setSize(w, h) {
    this.rt?.dispose();
    const depth = new THREE.DepthTexture(w, h, THREE.UnsignedIntType);
    this.rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: this.samples, depthTexture: depth, depthBuffer: true });
    this.rt.texture.minFilter = this.rt.texture.magFilter = THREE.LinearFilter;
    this.u.res.value.set(w, h);
  }

  // draw `scene` through the pass; `after` runs once the image is on screen (the gun)
  render(scene, camera, dt, extra = {}) {
    const r = this.r, u = this.u;
    camera.updateMatrixWorld();
    u.near.value = camera.near; u.far.value = camera.far;
    u.projY.value = camera.projectionMatrix.elements[5];
    u.time.value += dt;
    u.night.value = extra.night ?? 0; u.wet.value = extra.wet ?? 0; u.flash.value = extra.flash ?? 0; u.hurt.value = extra.hurt ?? 0;
    // how far the view swung since last frame, as a screen shift of a point ten metres ahead
    const bv = u.blurVec.value.set(0, 0);
    if (this.blur > 0 && !this.reduced && this.have && dt > 0 && !extra.noBlur) {
      this.p.set(0, 0, -10).applyMatrix4(camera.matrixWorld).applyMatrix4(this.prevView).applyMatrix4(this.prevProj);
      const k = this.blur * 0.5 * Math.min(1, 0.016 / dt);
      bv.set(THREE.MathUtils.clamp(this.p.x * k, -0.03, 0.03), THREE.MathUtils.clamp(this.p.y * k, -0.03, 0.03));
      if (bv.lengthSq() < 2e-7) bv.set(0, 0);
    }
    r.setRenderTarget(this.rt);
    r.render(scene, camera);
    r.setRenderTarget(null);
    u.tColor.value = this.rt.texture; u.tDepth.value = this.rt.depthTexture;
    r.render(this.scene, this.cam);
    camera.updateMatrixWorld();
    this.prevView.copy(camera.matrixWorldInverse); this.prevProj.copy(camera.projectionMatrix);
    this.have = true;
  }
}
