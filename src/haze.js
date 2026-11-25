import * as THREE from 'three';

// Fog that knows about height: the standard linear fog, plus a layer of ground haze that sits in
// low ground and thickens with distance, so valleys fill with dust and smoke while hilltops and
// the sky stay clear. Patched into three's fog chunks once, so every material picks it up.
const C = THREE.ShaderChunk;
if (!C.fog_vertex.includes('vHazeY')) {
  C.fog_pars_vertex = `${C.fog_pars_vertex}\n#ifdef USE_FOG\nvarying float vHazeY;\n#endif`;
  C.fog_vertex = `${C.fog_vertex}\n#ifdef USE_FOG\nvHazeY = (modelMatrix * vec4(transformed, 1.0)).y;\n#endif`;
  C.fog_pars_fragment = `${C.fog_pars_fragment}\n#ifdef USE_FOG\nvarying float vHazeY;\n#endif`;
  C.fog_fragment = `#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  // ground haze: a soft layer up to about 7 m that builds from 20 m out
  float hazeLow = 1.0 - smoothstep(0.0, 7.0, vHazeY);
  float hazeAmt = hazeLow * smoothstep(20.0, 110.0, vFogDepth) * 0.38;
  fogFactor = clamp(fogFactor + hazeAmt * (1.0 - fogFactor), 0.0, 1.0);
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`;
}
