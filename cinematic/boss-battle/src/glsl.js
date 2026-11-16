// Shared GLSL chunks: hashing, value noise, fbm and the dusk sky model that the sky dome, the sea
// reflection and the cloud puffs all agree on.
export const NOISE = /* glsl */ `
float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float h13(vec3 p3){ p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float vn2(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.-2.*f);
  return mix(mix(h12(i), h12(i+vec2(1,0)), u.x), mix(h12(i+vec2(0,1)), h12(i+vec2(1,1)), u.x), u.y); }
float vn3(vec3 p){ vec3 i = floor(p), f = fract(p); vec3 u = f*f*(3.-2.*f);
  float a = mix(mix(h13(i), h13(i+vec3(1,0,0)), u.x), mix(h13(i+vec3(0,1,0)), h13(i+vec3(1,1,0)), u.x), u.y);
  float b = mix(mix(h13(i+vec3(0,0,1)), h13(i+vec3(1,0,1)), u.x), mix(h13(i+vec3(0,1,1)), h13(i+vec3(1,1,1)), u.x), u.y);
  return mix(a, b, u.z); }
float fbm2(vec2 p){ float s = 0., a = .5; for(int i=0;i<5;i++){ s += a*vn2(p); p = p*2.03 + vec2(1.7, 9.2); a *= .5; } return s; }
float fbm3(vec3 p){ float s = 0., a = .5; for(int i=0;i<4;i++){ s += a*vn3(p); p = p*2.07 + vec3(1.7, 9.2, 3.1); a *= .5; } return s; }
`;

// uniforms: uSunDir (towards the sun), uStorm 0..1, uFlash, uTime
export const SKY = /* glsl */ `
vec3 skyBase(vec3 d){
  float y = d.y;
  float sd = max(dot(d, uSunDir), 0.);
  vec3 zen = vec3(0.045, 0.045, 0.16);
  vec3 mid = vec3(0.32, 0.17, 0.42);
  vec3 hor = vec3(1.35, 0.55, 0.30);
  vec3 c = mix(hor, mid, smoothstep(0.0, 0.22, y));
  c = mix(c, zen, smoothstep(0.18, 0.75, y));
  // the warm side of the sky around the sun
  c += vec3(1.6, 0.75, 0.30) * pow(sd, 6.) * (1. - smoothstep(0., .5, y));
  c += vec3(2.2, 1.1, 0.45) * pow(sd, 48.);
  // below the horizon: dark sea haze
  c = mix(c, vec3(0.25, 0.13, 0.20), smoothstep(0.0, -0.08, y));
  c *= mix(1., 0.42, uStorm);
  c += vec3(0.5, 0.55, 0.85) * uFlash * 0.25 * smoothstep(-0.05, 0.4, y);
  return c;
}
vec3 skyColor(vec3 d, bool withSun){
  vec3 c = skyBase(d);
  float sd = max(dot(d, uSunDir), 0.);
  if (withSun) c += vec3(30., 18., 9.) * smoothstep(0.99955, 0.99975, sd);
  // cloud deck: project onto a plane 1 unit up
  if (d.y > 0.0) {
    vec2 p = d.xz / (d.y + 0.07) * 1.6 + vec2(uTime * 0.012, uTime * 0.004);
    float cov = mix(0.50, 0.30, uStorm);
    float n = fbm2(p * 1.3);
    float dens = smoothstep(cov, cov + 0.28, n) * smoothstep(0.0, 0.12, d.y);
    float lit = fbm2(p * 1.3 + uSunDir.xz * 0.12);
    float rim = clamp((n - lit) * 4. + 0.5, 0., 1.);
    vec3 cc = mix(vec3(0.22, 0.12, 0.30), vec3(1.7, 0.75, 0.42), rim * (0.35 + 0.65 * pow(sd, 3.)));
    cc = mix(cc, vec3(0.07, 0.07, 0.12), uStorm * 0.75);
    cc += vec3(0.7, 0.75, 1.0) * uFlash * 0.9 * dens;
    c = mix(c, cc, dens * 0.92);
  }
  // stars near the zenith
  float st = step(0.9975, h12(floor(d.xz / (d.y + 0.3) * 260.))) * smoothstep(0.35, 0.8, d.y) * (1. - uStorm);
  c += vec3(0.8) * st;
  return c;
}
`;
