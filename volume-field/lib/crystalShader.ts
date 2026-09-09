// The crystal march as WGSL, for the WebGPU node.
//
// This is the same algorithm as lib/crystal.ts and the same algorithm as the
// testbed's `techniques/crystals.js` — one fragment shader, 64 steps by
// default, no compute pass. The GLSL it is ported from is quoted in the
// comments where the two differ in spelling only.
//
// Kept single-source on purpose: the bench harness that measures frame time
// extracts this same string, so a number in the report is a number about this
// shader and not about a copy of it.

export const CRYSTAL_WGSL = /* wgsl */ `
struct Uniforms {
  // xyz camera position, w = time
  cam_pos : vec4<f32>,
  cam_right : vec4<f32>,
  cam_up : vec4<f32>,
  cam_fwd : vec4<f32>,
  // x,y resolution · z steps · w shape (0 disc, 1 sphere, 2 cube)
  frame : vec4<f32>,
  // chroma, timeline, stream, edge
  cy_a : vec4<f32>,
  // occlusion, floor, exposure, density
  cy_b : vec4<f32>,
  // hue spread, saturation, lift, gamma
  grade_a : vec4<f32>,
  // mean hue, mode (0 dark, 1 light), screen grain, dither phase
  misc : vec4<f32>,
};

@group(0) @binding(0) var<uniform> U : Uniforms;
@group(0) @binding(1) var col_tex : texture_2d<f32>;
@group(0) @binding(2) var col_smp : sampler;

@vertex
fn vs(@builtin(vertex_index) i : u32) -> @builtin(position) vec4<f32> {
  // one full-screen triangle, so there is no vertex buffer to bind
  var p = array<vec2<f32>, 3>(vec2(-1.0, -3.0), vec2(-1.0, 1.0), vec2(3.0, 1.0));
  return vec4<f32>(p[i], 0.0, 1.0);
}

fn lum(c : vec3<f32>) -> f32 { return dot(c, vec3<f32>(0.299, 0.587, 0.114)); }

// prelude.js hash()
fn hash(p0 : vec2<f32>) -> f32 {
  var p = fract(p0 * vec2<f32>(123.34, 456.21));
  p = p + vec2<f32>(dot(p, p + 45.32));
  return fract(p.x * p.y);
}

fn rgb2hsv(c : vec3<f32>) -> vec3<f32> {
  let K = vec4<f32>(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  let p = mix(vec4<f32>(c.bg, K.wz), vec4<f32>(c.gb, K.xy), vec4<f32>(step(c.b, c.g)));
  let q = mix(vec4<f32>(p.xyw, c.r), vec4<f32>(c.r, p.yzx), vec4<f32>(step(p.x, c.r)));
  let d = q.x - min(q.w, q.y);
  return vec3<f32>(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
}

fn hsv2rgb(c : vec3<f32>) -> vec3<f32> {
  let K = vec4<f32>(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  let p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, vec3<f32>(0.0), vec3<f32>(1.0)), vec3<f32>(c.y));
}

// the live grade over measured colour (hue spread 1.0 = the photograph's truth)
fn grade(c : vec3<f32>) -> vec3<f32> {
  var h = rgb2hsv(clamp(c, vec3<f32>(0.0), vec3<f32>(1.0)));
  let mean_hue = U.misc.x;
  var dh = h.x - mean_hue;
  dh = dh - floor(dh + 0.5);
  h.x = fract(mean_hue + dh * U.grade_a.x);
  h.y = clamp(h.y * U.grade_a.y, 0.0, 1.0);
  h.z = clamp(U.grade_a.z + pow(h.z, U.grade_a.w) * (1.0 - U.grade_a.z), 0.0, 1.0);
  return hsv2rgb(h);
}

// the colour column. y01: 0 top -> 1 bottom. slice: 0..1 through its slices.
fn column_at(y01 : f32, slice : f32) -> vec3<f32> {
  let c = textureSampleLevel(col_tex, col_smp, vec2<f32>(slice, clamp(y01, 0.0, 1.0)), 0.0);
  return grade(c.rgb);
}

const CY_HB = vec3<f32>(0.40, 0.46, 0.40);
const CY_DISC = vec2<f32>(0.496, 0.160);
const CY_SPH = 0.46;

fn box_hit(ro : vec3<f32>, rd : vec3<f32>, he : vec3<f32>) -> vec2<f32> {
  let inv = 1.0 / rd;
  let t0 = (-he - ro) * inv;
  let t1 = (he - ro) * inv;
  let tn = min(t0, t1);
  let tf = max(t0, t1);
  return vec2<f32>(max(max(tn.x, tn.y), tn.z), min(min(tf.x, tf.y), tf.z));
}

fn sph_hit(ro : vec3<f32>, rd : vec3<f32>, r : f32) -> vec2<f32> {
  let b = dot(ro, rd);
  let c = dot(ro, ro) - r * r;
  let h = b * b - c;
  if (h < 0.0) { return vec2<f32>(1.0, -1.0); }
  let s = sqrt(h);
  return vec2<f32>(-b - s, -b + s);
}

fn disc_hit(ro : vec3<f32>, rd : vec3<f32>) -> vec2<f32> {
  let a = dot(rd.xy, rd.xy);
  var cyl : vec2<f32>;
  if (a < 1e-6) {
    if (dot(ro.xy, ro.xy) <= CY_DISC.x * CY_DISC.x) {
      cyl = vec2<f32>(-1e3, 1e3);
    } else {
      return vec2<f32>(1.0, -1.0);
    }
  } else {
    let b = dot(ro.xy, rd.xy);
    let c = dot(ro.xy, ro.xy) - CY_DISC.x * CY_DISC.x;
    let h = b * b - a * c;
    if (h < 0.0) { return vec2<f32>(1.0, -1.0); }
    let s = sqrt(h);
    cyl = vec2<f32>((-b - s) / a, (-b + s) / a);
  }
  var slab : vec2<f32>;
  if (abs(rd.z) < 1e-6) {
    if (abs(ro.z) <= CY_DISC.y) {
      slab = vec2<f32>(-1e3, 1e3);
    } else {
      return vec2<f32>(1.0, -1.0);
    }
  } else {
    let ta = (-CY_DISC.y - ro.z) / rd.z;
    let tb = (CY_DISC.y - ro.z) / rd.z;
    slab = vec2<f32>(min(ta, tb), max(ta, tb));
  }
  return vec2<f32>(max(cyl.x, slab.x), min(cyl.y, slab.y));
}

// the block's own coordinates: .x = height 0 floor -> 1 ceiling, .y = depth
// 0 front -> 1 back, .z = how far inside the boundary, feathered to 0..1.
fn cy_local(p : vec3<f32>) -> vec3<f32> {
  let sm = max(U.cy_a.w, 0.001);
  let shape = U.frame.w;
  if (shape < 0.5) {
    let r = 1.0 - length(p.xy) / CY_DISC.x;
    let z = 1.0 - abs(p.z) / CY_DISC.y;
    return vec3<f32>(p.y / CY_DISC.x * 0.5 + 0.5,
                     p.z / CY_DISC.y * 0.5 + 0.5,
                     smoothstep(0.0, sm, r) * smoothstep(0.0, sm * 1.29, z));
  }
  if (shape < 1.5) {
    let r = 1.0 - length(p) / CY_SPH;
    return vec3<f32>(p.y / CY_SPH * 0.5 + 0.5,
                     p.z / CY_SPH * 0.5 + 0.5,
                     smoothstep(0.0, sm, r));
  }
  let dd = 1.0 - abs(p) / CY_HB;
  return vec3<f32>(p.y / CY_HB.y * 0.5 + 0.5,
                   p.z / CY_HB.z * 0.5 + 0.5,
                   smoothstep(0.0, sm, dd.x) * smoothstep(0.0, sm, dd.y) * smoothstep(0.0, sm * 1.29, dd.z));
}

@fragment
fn fs(@builtin(position) frag : vec4<f32>) -> @location(0) vec4<f32> {
  let res = U.frame.xy;
  // gl_FragCoord counts up from the bottom of the frame; @builtin(position)
  // counts down from the top, so y is flipped here and nowhere else.
  let fc = vec2<f32>(frag.x, res.y - frag.y);
  var ndc = (fc / res) * 2.0 - 1.0;
  ndc.x = ndc.x * (res.x / res.y);
  let ro = U.cam_pos.xyz;
  let rd = normalize(U.cam_fwd.xyz + 0.36 * (ndc.x * U.cam_right.xyz + ndc.y * U.cam_up.xyz));

  let time = U.cam_pos.w;
  let light = step(0.5, U.misc.y);
  // On the LIGHT ground the medium composites as a real OVER — transmittance
  // fully consumed, unit gain — because an emitter on top of the paper is the
  // one thing a light-mode piece must not be.
  let occ = mix(U.cy_b.x, 1.0, light);
  let gain = mix(U.cy_b.z, 1.0, light);
  let ground = mix(vec3<f32>(0.0), vec3<f32>(0.902, 0.906, 0.917), light);

  var acc = vec3<f32>(0.0);
  var T = 1.0;
  let shape = U.frame.w;
  var hit : vec2<f32>;
  if (shape < 0.5) { hit = disc_hit(ro, rd); }
  else if (shape < 1.5) { hit = sph_hit(ro, rd, CY_SPH); }
  else { hit = box_hit(ro, rd, CY_HB); }

  let steps = i32(U.frame.z);
  if (hit.y > max(hit.x, 0.0)) {
    let a0 = max(hit.x, 0.0);
    let dt = (hit.y - a0) / f32(steps);
    // dither only — the step start is jittered so the planes never band.
    // Nothing in this technique's visual substance is procedural.
    let j = hash(fc + vec2<f32>(fract(time * 7.13), fract(time * 3.71)) * 97.0 + U.misc.w);
    var t = a0 + dt * j;
    for (var i = 0; i < steps; i = i + 1) {
      let p = ro + rd * t;
      let L = cy_local(p);
      // the field's own axis held as the body's depth; live time streams it
      // slowly through, so the crystal is never quite the same block twice.
      let tf = fract(L.y * U.cy_a.y + time * U.cy_a.z);
      // L.x counts up from the floor; the column's y01 counts down from the top.
      let c = column_at(1.0 - clamp(L.x, 0.0, 1.0), tf);
      // colour and density are the same measurement: the bright strata are the
      // dense ones. Nothing is chosen here that the column did not already say.
      let den = U.cy_b.w * (U.cy_b.y + 0.95 * lum(c)) * L.z;
      if (den > 0.004) {
        let aS = 1.0 - exp(-den * dt * 3.6);
        acc = acc + T * c * aS;
        T = T * (1.0 - aS * occ);
        if (T < 0.006) { break; }
      }
      t = t + dt;
    }
  }

  var c = acc * gain;
  let l0 = lum(c);
  c = max(mix(vec3<f32>(l0), c, vec3<f32>(U.cy_a.x)), vec3<f32>(0.0));
  // What the march did not absorb is the ground still showing through.
  c = c + T * ground;

  // MAIN's tonemap
  if (light < 0.5) {
    c = c / (1.0 + c);
    c = pow(c * 1.18, vec3<f32>(0.4545));
  } else {
    c = c / (1.0 + c * 0.55);
    c = clamp(c * 1.55, vec3<f32>(0.0), vec3<f32>(1.0));
  }
  let g = U.misc.z;
  if (g > 0.0) {
    let lg = lum(c);
    c = c + (hash(fc + fract(time) * 113.0) - 0.5) * g * (0.2 + lg);
  }
  return vec4<f32>(c, 1.0);
}
`;
