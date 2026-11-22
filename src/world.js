import * as THREE from 'three';

// The battlefield: one large bevelled slab of poured concrete with a faint survey grid.
export const MAP = { size: 180, thick: 1.2, bevel: 0.3 };
export const HALF = MAP.size / 2;

function groundTexture() {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#8e908b';
  g.fillRect(0, 0, S, S);
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // aggregate speckle and a few darker patches so the concrete isn't flat plastic
  for (let i = 0; i < 40; i++) {
    const x = rnd() * S, y = rnd() * S, r = 20 + rnd() * 70;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(90,92,88,${0.05 + rnd() * 0.06})`);
    gr.addColorStop(1, 'rgba(90,92,88,0)');
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < 5000; i++) {
    const l = 0.82 + rnd() * 0.3;
    g.fillStyle = `rgba(${Math.round(118 * l)},${Math.round(120 * l)},${Math.round(115 * l)},${0.08 + rnd() * 0.14})`;
    g.fillRect(rnd() * S, rnd() * S, 1 + rnd() * 2.5, 1 + rnd() * 2.5);
  }
  // expansion joints every 4 m (texture = 16 m)
  const tile = S / 4;
  g.strokeStyle = 'rgba(70,72,68,0.5)';
  g.lineWidth = 2;
  for (let i = 0; i <= 4; i++) {
    g.beginPath(); g.moveTo(i * tile, 0); g.lineTo(i * tile, S); g.stroke();
    g.beginPath(); g.moveTo(0, i * tile); g.lineTo(S, i * tile); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

export function createGround() {
  const { size, thick, bevel } = MAP;
  const h = size / 2 - bevel, r = 2;
  const shape = new THREE.Shape();
  shape.moveTo(-h + r, -h);
  shape.lineTo(h - r, -h); shape.quadraticCurveTo(h, -h, h, -h + r);
  shape.lineTo(h, h - r); shape.quadraticCurveTo(h, h, h - r, h);
  shape.lineTo(-h + r, h); shape.quadraticCurveTo(-h, h, -h, h - r);
  shape.lineTo(-h, -h + r); shape.quadraticCurveTo(-h, -h, -h + r, -h);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: thick - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 6 });
  geo.rotateX(-Math.PI / 2);
  geo.computeBoundingBox();
  geo.translate(0, -geo.boundingBox.max.y, 0); // top face at y = 0
  const tex = groundTexture();
  tex.repeat.set(1 / 16, 1 / 16);
  const top = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.94 });
  const side = new THREE.MeshStandardMaterial({ color: '#6f716c', roughness: 0.95 });
  const mesh = new THREE.Mesh(geo, [top, side]);
  mesh.name = 'ground';
  mesh.receiveShadow = true;
  return mesh;
}

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
