// volume-render — the crystal, raymarched on the GPU.
//
// One portable node borrowing the host's shared GPUDevice: GPU resources
// never cross a port, an image comes in and an image goes out. A single render pass
// over one full-screen triangle, marching in the fragment stage, is the whole
// renderer — which is also what the original is.
//
// Cascade cooks on every parameter change, so the thing that decides whether a
// drag feels live is what happens per cook. The host caches pipelines and
// allocations; each cook uploads its wired column, writes 144 uniform bytes,
// encodes one pass and explicitly reads RGBA pixels for PNG export. The same
// renderer runs on browser WebGPU and the CLI's optional Dawn host.
import type { NodeDefinition, NodeExecutionContext } from 'cascade/contracts';
import { cachePath } from 'cascade/io';
import { readTexture } from 'cascade/gpu';
import { readRaster, writeRaster } from '../../lib/pixels';
import { UNIFORM_BYTES, acquireCrystalGpu, uploadColumn } from '../../lib/gpu';

export const definition = {
  apiVersion: 1,
  label: 'Volume Render (WebGPU)',
  icon: 'Box',
  runsOn: 'portable',
  capabilities: ['gpu'],
  inputs: {
    column: { kind: 'data', type: 'image' },
    mean_hue: { kind: 'data', type: 'float', default: 0 },
  },
  outputs: {
    image: { kind: 'data', type: 'image' },
    /** milliseconds the GPU pass itself took, wall clock around submit */
    gpu_ms: { kind: 'data', type: 'float' },
  },
  props: {
    resolution: { type: 'vec2i', default: [1098, 1512], min: 64, max: 4096, step: 2 },
    container: { type: 'string', default: 'cube', control: 'select', options: ['disc', 'sphere', 'cube'] },
    ground: { type: 'string', default: 'dark', control: 'select', options: ['dark', 'light'] },
    // The step count is the trade to steer: frame time is very nearly linear in
    // it, and the original marches 64.
    steps: { type: 'int', default: 64, min: 8, max: 512, step: 8 },
    // [azimuth, elevation, radius] — one orbit, so one vector. No range: the
    // three components are three kinds of number with three different limits,
    // and a vector prop carries one range across all of its components.
    camera: { type: 'vec3', default: [0.55, 0.12, 1.95] },
    // Added to the camera's azimuth, in **turns** rather than radians so that
    // `$T * 0.1` reads as a tenth of a revolution per second.
    //
    // It exists as its own scalar rather than as animation on `camera` for two
    // reasons. An expression can only bind to a whole prop and evaluates to a
    // number, so a `vec3` cannot carry one on a single component. And keeping
    // them apart is the better design anyway: `camera` is the framing a person
    // chooses, `spin` is the motion the clock drives, and an expression beats a
    // stored value in the resolution order — so animating `camera` directly
    // would silently discard any framing set by hand.
    //
    // No range, for the same reason `camera` has none: a ramp is meant to run
    // past one revolution, and a clamp on the control would invite the
    // assumption that the resolved value is clamped too. It is not.
    // Turns, not radians, so `$T * 0.1` reads as a tenth of a revolution per
    // second. The range exists for the control's sake rather than the maths':
    // clamping happens in the Inspector's commit handler, never on a resolved
    // expression, so a ramp is free to run past two turns.
    spin: { type: 'float', default: 0, min: -2, max: 2, step: 0.005, description: 'Turns added to the camera azimuth. Drive it with an expression such as $T * 0.1.' },
    fit: {
      type: 'float',
      default: 1,
      min: 0.5,
      max: 2,
      step: 0.01,
      label: 'Aspect fit',
      description:
        'Backs the camera off so a portrait frame keeps the square\'s horizontal framing. 1/aspect for a portrait page, 1 for a square.',
    },
    time: { type: 'float', default: 0, min: 0, max: 600, step: 0.01 },
    // crystals' own six, at the original's defaults
    chroma: { type: 'float', default: 1.25, min: 0, max: 2, step: 0.01 },
    timeline: { type: 'float', default: 0.85, min: 0, max: 1.6, step: 0.01 },
    stream: { type: 'float', default: 0.012, min: 0, max: 0.2, step: 0.001 },
    edge: { type: 'float', default: 0.14, min: 0.01, max: 0.5, step: 0.01 },
    occlusion: { type: 'float', default: 0.7, min: 0.2, max: 1, step: 0.01 },
    floor: { type: 'float', default: 0.25, min: 0, max: 1, step: 0.01 },
    // the shared grade, at crystals' base
    exposure: { type: 'float', default: 1.5, min: 0.2, max: 9, step: 0.05 },
    density: { type: 'float', default: 2.6, min: 0.2, max: 4, step: 0.05 },
    hue_spread: { type: 'float', default: 1, min: 0.5, max: 4, step: 0.01 },
    saturation: { type: 'float', default: 1, min: 0.5, max: 3, step: 0.01 },
    lift: { type: 'float', default: 0, min: 0, max: 0.4, step: 0.01 },
    gamma: { type: 'float', default: 1, min: 0.4, max: 2, step: 0.01 },
    screen_grain: { type: 'float', default: 0.028, min: 0, max: 0.06, step: 0.001 },
    dither_phase: { type: 'float', default: 0, min: 0, max: 1, step: 0.01 },
  },
} as const satisfies NodeDefinition;

/** The uniform block, laid out to match the WGSL struct: 9 vec4s, 144 bytes. */
function packUniforms(
  camera: { pos: number[]; right: number[]; up: number[]; fwd: number[]; time: number },
  frame: number[],
  cyA: number[],
  cyB: number[],
  gradeA: number[],
  misc: number[],
) {
  const view = new Float32Array(UNIFORM_BYTES / 4);
  view.set([...camera.pos, camera.time], 0);
  view.set([...camera.right, 0], 4);
  view.set([...camera.up, 0], 8);
  view.set([...camera.fwd, 0], 12);
  view.set(frame, 16);
  view.set(cyA, 20);
  view.set(cyB, 24);
  view.set(gradeA, 28);
  view.set(misc, 32);
  return view;
}

export async function execute(context: NodeExecutionContext<typeof definition>) {
  const column = context.inputs.column;
  if (!column) return;
  const props = context.props;
  const width = Math.max(64, props.resolution[0]);
  const height = Math.max(64, props.resolution[1]);

  const state = await acquireCrystalGpu(context.capabilities.gpu, width, height);
  uploadColumn(state, await readRaster(column));
  if (!state.bindGroup) throw new Error('the column texture never bound');

  // the camera, exactly as the testbed's index.html builds it
  const [baseAz, el, radius] = props.camera;
  const az = baseAz + props.spin * Math.PI * 2;
  const rad = radius * (props.fit || 1);
  const eye = [rad * Math.cos(el) * Math.sin(az), rad * Math.sin(el), rad * Math.cos(el) * Math.cos(az)];
  const fLen = Math.hypot(eye[0], eye[1], eye[2]) || 1;
  const fwd = [-eye[0] / fLen, -eye[1] / fLen, -eye[2] / fLen];
  const rightRaw = [-fwd[2], 0, fwd[0]];
  const rLen = Math.hypot(rightRaw[0], rightRaw[1], rightRaw[2]) || 1;
  const right = [rightRaw[0] / rLen, rightRaw[1] / rLen, rightRaw[2] / rLen];
  const up = [
    right[1] * fwd[2] - right[2] * fwd[1],
    right[2] * fwd[0] - right[0] * fwd[2],
    right[0] * fwd[1] - right[1] * fwd[0],
  ];

  const shape = props.container === 'disc' ? 0 : props.container === 'sphere' ? 1 : 2;
  const block = packUniforms(
    { pos: eye, right, up, fwd, time: props.time },
    [width, height, props.steps, shape],
    [props.chroma, props.timeline, props.stream, props.edge],
    [props.occlusion, props.floor, props.exposure, props.density],
    [props.hue_spread, props.saturation, props.lift, props.gamma],
    [context.inputs.mean_hue, props.ground === 'light' ? 1 : 0, props.screen_grain, props.dither_phase],
  );
  state.device.queue.writeBuffer(state.uniforms, 0, block);

  const started = performance.now();
  const encoder = state.device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: state.target.createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      },
    ],
  });
  pass.setPipeline(state.pipeline);
  pass.setBindGroup(0, state.bindGroup);
  pass.draw(3);
  pass.end();
  state.device.queue.submit([encoder.finish()]);
  await state.device.queue.onSubmittedWorkDone();
  const gpuMs = performance.now() - started;

  // The readback is the expensive half of a cook — encoding a PNG at page size
  // costs about four times the march itself — and it is not optional: an image
  // port carries a path, so the pixels have to become a file.
  const pixels = await readTexture(state.device, state.target, { signal: context.signal });
  context.outputs.image.set(await writeRaster({ ...pixels, data: new Uint8ClampedArray(pixels.data.buffer) }, cachePath(context.nodeId, '.png')));
  context.outputs.gpu_ms.set(gpuMs);
}
