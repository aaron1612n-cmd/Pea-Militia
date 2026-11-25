import * as THREE from 'three';

// The battlefield is 300 m square; the ground itself lives in terrain.js.
export const MAP = { size: 300 };
export const HALF = MAP.size / 2;

export function createSky() {
  const geo = new THREE.SphereGeometry(600, 32, 16);
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color('#9aa3a9') },
      mid: { value: new THREE.Color('#c9ccca') },
      low: { value: new THREE.Color('#b3b5b1') },
      sunDir: { value: new THREE.Vector3(42, 40, 26).normalize() },
      time: { value: 0 },
      night: { value: 0 },
      dim: { value: 1 },
    },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 low; uniform vec3 sunDir; uniform float time; uniform float night; uniform float dim; varying vec3 vP;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
float fbm(vec2 p){ float a=0.5, s=0.0; for(int i=0;i<5;i++){ s+=a*vn(p); p=p*2.03+7.1; a*=0.5; } return s; }
void main(){ float h=vP.y; vec3 c = h>0.0 ? mix(mid, top, smoothstep(0.0,0.6,h)) : mix(mid, low, smoothstep(0.0,0.2,-h));
  if (h > 0.02) {
    vec2 uv = vP.xz / (h + 0.25) * 1.6 + vec2(time * 0.004, time * 0.0015);
    float cl = smoothstep(0.42, 0.78, fbm(uv));
    float shade = fbm(uv + vec2(0.07, 0.05));
    float sdl = max(dot(normalize(vP), sunDir), 0.0);
    vec3 cc = mix(vec3(0.82,0.80,0.76), vec3(0.50,0.50,0.52), smoothstep(0.35, 0.8, cl * (0.6 + 0.8 * shade)));
    cc *= mix(vec3(1.0), mid * 1.3 / max(max(mid.r, max(mid.g, mid.b)), 0.2), 0.7); // lit by the colour of the hour
    cc += vec3(1.0, 0.78, 0.5) * pow(sdl, 5.0) * 0.3 * (1.0 - night) * (1.0 - shade * 0.6); // bright rim toward the sun
    c = mix(c, cc * mix(1.0, 0.45, night), cl * smoothstep(0.02, 0.2, h) * 0.85);
    // stars on a clear night, thinned by cloud and haze near the horizon
    vec2 sp = vec2(atan(vP.z, vP.x) * 70.0, h * 140.0);
    vec2 sc = floor(sp), sf = fract(sp) - 0.5;
    float sr = hash(sc);
    float star = step(0.975, sr) * smoothstep(0.35, 0.0, length(sf)) * (0.4 + 0.6 * hash(sc + 7.0));
    c += vec3(0.85, 0.9, 1.0) * star * night * (1.0 - cl) * smoothstep(0.05, 0.35, h) * dim;
  }
  float sd = max(dot(normalize(vP), sunDir), 0.0);
  vec3 glow = mix(vec3(1.0,0.82,0.55), vec3(0.6,0.7,1.0), night);
  c += glow * (pow(sd, 6.0) * mix(0.22, 0.05, night) + pow(sd, 90.0) * mix(0.5, 0.0, night)) * dim;
  c += vec3(0.92, 0.95, 1.0) * smoothstep(0.9993, 0.9998, sd) * night * dim; // the moon
  c = mix(c, mid, smoothstep(0.12, 0.0, abs(h)) * 0.6); // haze at the horizon
  gl_FragColor=vec4(c,1.0);
#include <colorspace_fragment>
}`,
  });
  const sky = new THREE.Mesh(geo, m);
  sky.name = 'sky';
  sky.frustumCulled = false;
  return sky;
}

// Control point marker: a flat ring on the ground and a slim mast that takes the holder's colour.
export function pointMarker(r) {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.25, r, 64), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.55, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  ring.renderOrder = 1;
  const steel = new THREE.MeshStandardMaterial({ color: '#2a2f34', roughness: 0.5, metalness: 0.6 });
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 5.2, 8), steel);
  mast.position.y = 2.6;
  mast.castShadow = true;
  // stepped concrete plinth with a ring of bolts, a brass finial on top
  const concrete = new THREE.MeshStandardMaterial({ color: '#8f8b82', roughness: 0.95, flatShading: true });
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.95, 0.3, 10), concrete);
  plinth.position.y = 0.15; plinth.receiveShadow = plinth.castShadow = true;
  const step = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 0.22, 10), concrete);
  step.position.y = 0.4; step.castShadow = true;
  const finial = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), new THREE.MeshStandardMaterial({ color: '#b08d3c', metalness: 0.8, roughness: 0.35 }));
  finial.position.y = 5.28;
  // a short post every few metres around the ring so the boundary reads from far off
  const stakeGeo = new THREE.CylinderGeometry(0.05, 0.07, 0.8, 5);
  const stakes = new THREE.InstancedMesh(stakeGeo, steel, 16);
  const mm = new THREE.Matrix4();
  for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; mm.makeTranslation(Math.cos(a) * (r + 0.1), 0.35, Math.sin(a) * (r + 0.1)); stakes.setMatrixAt(i, mm); }
  stakes.frustumCulled = false;
  // a cloth banner on the mast; its free edge ripples in the wind
  const flagGeo = new THREE.PlaneGeometry(1.3, 0.8, 10, 3);
  flagGeo.translate(0.65, 0, 0);
  flagGeo.rotateY(-Math.PI / 2);
  const flag = new THREE.Mesh(flagGeo, new THREE.MeshStandardMaterial({ color: '#d8d8d4', roughness: 0.85, side: THREE.DoubleSide }));
  flag.position.y = 4.65;
  flag.castShadow = true;
  const base = flagGeo.attributes.position.array.slice();
  const wave = (t) => {
    const p = flagGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const d = Math.abs(base[i * 3 + 2]) / 1.3; // distance from the mast
      p.setX(i, base[i * 3] + Math.sin(t * 3 + d * 7) * 0.12 * d);
      p.setY(i, base[i * 3 + 1] + Math.sin(t * 2.2 + d * 5) * 0.03 * d);
    }
    p.needsUpdate = true;
  };
  g.add(ring, mast, plinth, step, finial, stakes, flag);
  g.userData = { ring, flag, wave };
  return g;
}

// A wooden ammunition crate with iron straps and a stencilled lid, set beside a control point.
let crateGeo = null;
export function ammoCrate() {
  if (!crateGeo) {
    crateGeo = {
      body: new THREE.BoxGeometry(0.9, 0.5, 0.55),
      strap: new THREE.BoxGeometry(0.06, 0.52, 0.57),
      lid: new THREE.BoxGeometry(0.5, 0.01, 0.3),
      wood: new THREE.MeshStandardMaterial({ color: '#5d6340', roughness: 0.9, flatShading: true }),
      iron: new THREE.MeshStandardMaterial({ color: '#2a2f34', roughness: 0.5, metalness: 0.6 }),
      mark: new THREE.MeshStandardMaterial({ color: '#d9c98a', roughness: 0.8 }),
    };
  }
  const g = new THREE.Group();
  const b = new THREE.Mesh(crateGeo.body, crateGeo.wood); b.position.y = 0.25; b.castShadow = b.receiveShadow = true; g.add(b);
  for (const x of [-0.3, 0.3]) { const st = new THREE.Mesh(crateGeo.strap, crateGeo.iron); st.position.set(x, 0.25, 0); g.add(st); }
  const l = new THREE.Mesh(crateGeo.lid, crateGeo.mark); l.position.y = 0.506; g.add(l);
  const top = new THREE.Mesh(crateGeo.body, crateGeo.wood); top.scale.set(0.7, 0.55, 0.7); top.position.set(0.05, 0.64, 0.02); top.rotation.y = 0.3; top.castShadow = true; g.add(top);
  return g;
}
