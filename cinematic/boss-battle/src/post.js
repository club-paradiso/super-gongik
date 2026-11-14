// Post: HDR scene (MSAA, half float) -> bloom (5-level) -> sun shafts (radial march over the bright
// pass) -> grade (exposure, ACES fit, lift/gamma/gain, saturation) -> lens (chromatic fringe, shock
// ring, vignette, deterministic grain) -> titles -> sRGB.
import * as THREE from 'three';

const VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`;

export function buildPost(renderer, W, H, samples = 4) {
  const P = {};
  const hf = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
  const rtScene = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples, depthBuffer: true });
  const levels = [];
  let w = W >> 1, h = H >> 1;
  for (let i = 0; i < 5; i++) {
    levels.push([new THREE.WebGLRenderTarget(w, h, hf), new THREE.WebGLRenderTarget(w, h, hf)]);
    w = Math.max(1, w >> 1);
    h = Math.max(1, h >> 1);
  }
  const rtRays = [new THREE.WebGLRenderTarget(W >> 2, H >> 2, hf), new THREE.WebGLRenderTarget(W >> 2, H >> 2, hf)];
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  quad.frustumCulled = false;
  const sc = new THREE.Scene();
  sc.add(quad);
  const run = (mat, target) => {
    quad.material = mat;
    renderer.setRenderTarget(target);
    renderer.render(sc, cam);
  };
  const mk = (fs, uniforms) => new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: fs, uniforms, depthTest: false, depthWrite: false });

  const bright = mk(
    `uniform sampler2D tSrc; uniform float uTh; varying vec2 vUv;
     void main(){ vec2 px = 1. / vec2(textureSize(tSrc, 0));
       vec3 c = (texture2D(tSrc, vUv + px * vec2(-.5,-.5)).rgb + texture2D(tSrc, vUv + px * vec2(.5,-.5)).rgb + texture2D(tSrc, vUv + px * vec2(-.5,.5)).rgb + texture2D(tSrc, vUv + px * vec2(.5,.5)).rgb) * .25;
       c = min(c, vec3(60.));
       float l = dot(c, vec3(.2126,.7152,.0722)); float k = smoothstep(uTh, uTh * 2.5, l);
       gl_FragColor = vec4(c * k, 1.); }`,
    { tSrc: { value: null }, uTh: { value: 1.2 } },
  );
  const down = mk(
    `uniform sampler2D tSrc; varying vec2 vUv; void main(){ vec2 px = 1. / vec2(textureSize(tSrc, 0));
      vec3 c = texture2D(tSrc, vUv + px * vec2(-1,-1)).rgb + texture2D(tSrc, vUv + px * vec2(1,-1)).rgb + texture2D(tSrc, vUv + px * vec2(-1,1)).rgb + texture2D(tSrc, vUv + px * vec2(1,1)).rgb;
      gl_FragColor = vec4(c * .25, 1.); }`,
    { tSrc: { value: null } },
  );
  const blur = mk(
    `uniform sampler2D tSrc; uniform vec2 uDir; varying vec2 vUv; void main(){ vec2 px = uDir / vec2(textureSize(tSrc, 0));
      vec3 c = texture2D(tSrc, vUv).rgb * 0.227;
      c += (texture2D(tSrc, vUv + px * 1.385).rgb + texture2D(tSrc, vUv - px * 1.385).rgb) * 0.316;
      c += (texture2D(tSrc, vUv + px * 3.231).rgb + texture2D(tSrc, vUv - px * 3.231).rgb) * 0.070;
      gl_FragColor = vec4(c, 1.); }`,
    { tSrc: { value: null }, uDir: { value: new THREE.Vector2(1, 0) } },
  );
  const rays = mk(
    `uniform sampler2D tSrc; uniform vec2 uSun; uniform float uOn; varying vec2 vUv;
     void main(){ vec2 d = (vUv - uSun) / 48. * 0.9; vec2 p = vUv; vec3 acc = vec3(0.); float w = 1.;
       for (int i = 0; i < 48; i++){ p -= d; vec3 s = texture2D(tSrc, clamp(p, 0., 1.)).rgb; acc += s * w; w *= 0.955; }
       gl_FragColor = vec4(acc / 48. * uOn, 1.); }`,
    { tSrc: { value: null }, uSun: { value: new THREE.Vector2() }, uOn: { value: 0 } },
  );
  const comp = mk(
    /* glsl */ `
    uniform sampler2D tScene, tB0, tB1, tB2, tB3, tB4, tRays, tTitle;
    uniform float uExposure, uBloom, uRays, uFringe, uWhite, uFade, uGrain, uFrame, uSat, uTitle, uVig;
    uniform vec3 uLift, uGamma, uGain, uRaysCol;
    uniform vec4 uRing; uniform vec2 uAspect;
    varying vec2 vUv;
    vec3 aces(vec3 x){ const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14; return clamp((x*(a*x+b))/(x*(c*x+d)+e), 0., 1.); }
    float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    vec3 srgb(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1./2.4)) - 0.055, step(0.0031308, c)); }
    void main(){
      vec2 uv = vUv;
      // shock ring: refractive bend around an expanding circle
      if (uRing.w > 0.001) {
        vec2 d = (uv - uRing.xy) * uAspect; float r = length(d);
        float band = exp(-pow((r - uRing.z) * 18., 2.));
        uv -= normalize(d + 1e-5) / uAspect * band * uRing.w * 0.03;
      }
      vec2 cc = uv - 0.5;
      vec3 col;
      if (uFringe > 0.001) {
        vec2 off = cc * uFringe * 0.012;
        col = vec3(texture2D(tScene, uv + off).r, texture2D(tScene, uv).g, texture2D(tScene, uv - off).b);
      } else col = texture2D(tScene, uv).rgb;
      vec3 bl = texture2D(tB0, uv).rgb * 0.5 + texture2D(tB1, uv).rgb * 0.6 + texture2D(tB2, uv).rgb * 0.7 + texture2D(tB3, uv).rgb * 0.8 + texture2D(tB4, uv).rgb * 0.9;
      col += bl * uBloom;
      col += texture2D(tRays, uv).rgb * uRays * uRaysCol;
      col *= uExposure;
      col = aces(col);
      // grade (in display-ish space)
      col = pow(max(col * uGain + uLift * (1. - col), 0.), 1. / uGamma);
      float l = dot(col, vec3(.2126,.7152,.0722));
      col = mix(vec3(l), col, uSat);
      // vignette
      float v = smoothstep(1.15, 0.35, length(cc * vec2(1.15, 1.0)));
      col *= mix(1., v, uVig);
      col = mix(col, vec3(1.), clamp(uWhite, 0., 1.));
      col *= uFade;
      // titles
      vec4 tt = texture2D(tTitle, vUv);
      col = mix(col, tt.rgb, tt.a * uTitle);
      col = clamp(col, 0., 1.);
      col = srgb(col);
      // grain (seeded by the frame number: deterministic)
      float g = h12(gl_FragCoord.xy + uFrame * 17.31) - 0.5;
      col += g * uGrain;
      gl_FragColor = vec4(col, 1.);
    }`,
    {
      tScene: { value: rtScene.texture },
      tB0: { value: levels[0][0].texture },
      tB1: { value: levels[1][0].texture },
      tB2: { value: levels[2][0].texture },
      tB3: { value: levels[3][0].texture },
      tB4: { value: levels[4][0].texture },
      tRays: { value: rtRays[0].texture },
      tTitle: { value: null },
      uExposure: { value: 1 },
      uBloom: { value: 0.08 },
      uRays: { value: 0.6 },
      uRaysCol: { value: new THREE.Vector3(1.0, 0.65, 0.4) },
      uFringe: { value: 0 },
      uWhite: { value: 0 },
      uFade: { value: 1 },
      uGrain: { value: 0.035 },
      uFrame: { value: 0 },
      uSat: { value: 1 },
      uTitle: { value: 0 },
      uVig: { value: 0.55 },
      uLift: { value: new THREE.Vector3(0.0, 0.0, 0.02) },
      uGamma: { value: new THREE.Vector3(1, 1, 1) },
      uGain: { value: new THREE.Vector3(1, 1, 1) },
      uRing: { value: new THREE.Vector4(0, 0, 0, 0) },
      uAspect: { value: new THREE.Vector2(W / H, 1) },
    },
  );
  P.comp = comp.uniforms;

  P.render = (scene, camera, sunUv, sunOn) => {
    renderer.setRenderTarget(rtScene);
    renderer.render(scene, camera);
    // bloom
    bright.uniforms.tSrc.value = rtScene.texture;
    run(bright, levels[0][0]);
    for (let i = 0; i < levels.length; i++) {
      if (i > 0) {
        down.uniforms.tSrc.value = levels[i - 1][0].texture;
        run(down, levels[i][0]);
      }
      blur.uniforms.tSrc.value = levels[i][0].texture;
      blur.uniforms.uDir.value.set(1, 0);
      run(blur, levels[i][1]);
      blur.uniforms.tSrc.value = levels[i][1].texture;
      blur.uniforms.uDir.value.set(0, 1);
      run(blur, levels[i][0]);
    }
    // sun shafts from the half-res bright pass
    if (sunOn > 0.001) {
      down.uniforms.tSrc.value = levels[0][0].texture;
      run(down, rtRays[1]);
      rays.uniforms.tSrc.value = rtRays[1].texture;
      rays.uniforms.uSun.value.copy(sunUv);
      rays.uniforms.uOn.value = sunOn;
      run(rays, rtRays[0]);
    } else {
      renderer.setRenderTarget(rtRays[0]);
      renderer.clear();
    }
    run(comp, null);
  };
  return P;
}
