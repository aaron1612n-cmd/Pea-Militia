import * as THREE from 'three';

// The battlefield is 180 m square; the ground itself lives in terrain.js.
export const MAP = { size: 180 };
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
    },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 mid; uniform vec3 low; varying vec3 vP; void main(){ float h=vP.y; vec3 c = h>0.0 ? mix(mid, top, smoothstep(0.0,0.6,h)) : mix(mid, low, smoothstep(0.0,0.2,-h)); gl_FragColor=vec4(c,1.0);\n#include <colorspace_fragment>\n}',
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
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 5, 8), new THREE.MeshStandardMaterial({ color: '#2a2f34', roughness: 0.5, metalness: 0.6 }));
  mast.position.y = 2.5;
  mast.castShadow = true;
  const flagGeo = new THREE.BoxGeometry(0.05, 0.7, 1.2);
  flagGeo.translate(0, 0, 0.62);
  const flag = new THREE.Mesh(flagGeo, new THREE.MeshStandardMaterial({ color: '#d8d8d4', roughness: 0.8 }));
  flag.position.y = 4.55;
  flag.castShadow = true;
  g.add(ring, mast, flag);
  g.userData = { ring, flag };
  return g;
}
