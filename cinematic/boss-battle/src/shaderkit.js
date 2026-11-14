// Small helpers for extending three.js built-in materials (keeps PBR lighting, shadows and fog)
// with procedural surface detail written in GLSL.
import * as THREE from 'three';
import { NOISE } from './glsl.js';

export const BUMP = /* glsl */ `
vec3 bumpN(vec3 n, vec3 pos, float h, float scale){
  vec3 dpx = dFdx(pos), dpy = dFdy(pos);
  float dhx = dFdx(h), dhy = dFdy(h);
  vec3 r1 = cross(dpy, n), r2 = cross(n, dpx);
  float det = dot(dpx, r1);
  vec3 g = sign(det) * (dhx * r1 + dhy * r2) * scale;
  return normalize(abs(det) * n - g);
}`;

// opts: { uniforms, varyings (decl string), vertex (code run after begin_vertex, has `transformed`),
//         fragHead (functions), color (code: modify diffuseColor / may set float hgt), rough (roughnessFactor),
//         normal (after normal_fragment_maps; default uses hgt + bumpScale), emissive (totalEmissiveRadiance) }
let extId = 0;
export function extend(mat, o) {
  mat.userData.u = o.uniforms || {};
  // three.js caches programs by onBeforeCompile source text, which is identical for every extension:
  // give each one its own key or materials silently share the wrong shader.
  const key = 'ext' + extId++ + ':' + JSON.stringify([o.vertex, o.color, o.rough, o.emissive, o.bump, o.varyings, o.fragHead]).length;
  mat.customProgramCacheKey = () => key;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, mat.userData.u);
    const udecl = Object.entries(mat.userData.u)
      .map(([k, v]) => `uniform ${glslType(v.value)} ${k};`)
      .join('\n');
    const vary = `varying vec3 vW; varying vec3 vL; varying vec3 vNW;\n${o.varyings || ''}`;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${udecl}\n${vary}\n${NOISE}\n${o.vertHead || ''}`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\n vL = position;\n${o.vertex || ''}`,
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        { vec4 wp = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            wp = instanceMatrix * wp;
          #endif
          vW = (modelMatrix * wp).xyz;
          vec3 nn = objectNormal;
          #ifdef USE_INSTANCING
            nn = mat3(instanceMatrix) * nn;
          #endif
          vNW = normalize(mat3(modelMatrix) * nn); }`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${udecl}\n${vary}\n${NOISE}\n${BUMP}\n${o.fragHead || ''}\nfloat hgt = 0.0;`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${o.color || ''}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${o.rough || ''}`)
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>\n${o.normal || (o.bump ? `normal = bumpN(normal, -vViewPosition, hgt, ${o.bump.toFixed(4)});` : '')}`,
      )
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${o.emissive || ''}`);
    mat.userData.shader = sh;
  };
  return mat;
}
function glslType(v) {
  if (typeof v === 'number') return 'float';
  if (v && v.isVector2) return 'vec2';
  if (v && v.isVector3) return 'vec3';
  if (v && v.isVector4) return 'vec4';
  if (v && v.isColor) return 'vec3';
  if (v && v.isTexture) return 'sampler2D';
  if (Array.isArray(v)) return `vec4[${v.length}]`;
  return 'float';
}
