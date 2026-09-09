// field-columns — the volume's colour, generated rather than sampled.
//
// This node exists so the sketch has no inputs to ship. `volume-render` marches
// a colour field and does not care where the field came from: it wants an
// `image` whose **width is the stops** up a column and whose **height is the
// slices** through the volume. A photograph gives you one; so does arithmetic,
// and arithmetic is what an example can distribute.
//
// It is also the more useful half to read. A reader who opens this sees the
// whole input to the renderer as forty lines of colour maths, which is a better
// starting point than a decoder for someone else's file format.
import type { NodeDefinition, NodeExecutionContext } from 'cascade/contracts';
import { cachePath } from 'cascade/io';
import { writeRaster } from '../../lib/pixels';

export const definition = {
  apiVersion: 1,
  label: 'Field Columns',
  icon: 'Palette',
  runsOn: 'portable',
  inputs: {
    /** Where the whole palette sits on the wheel. One input rather than a prop
     *  because this is the parameter worth animating — `$T * 0.05` walks the
     *  volume through the spectrum. */
    hue: { kind: 'data', type: 'float', default: 0.58, min: 0, max: 1 },
  },
  outputs: {
    image: { kind: 'data', type: 'image' },
    /** The renderer takes a mean hue for its own tinting, so it is reported
     *  here rather than typed twice into two nodes. */
    mean_hue: { kind: 'data', type: 'float' },
  },
  props: {
    /** [stops, slices]. One `vec2i` and not two ints, per the vector rule:
     *  it is a resolution, and two floats that are really one vector cost two
     *  Inspector rows and let a graph carry a width without its height. */
    size: { type: 'vec2i', default: [24, 9], min: 2, max: 256 },
    /** How far the hue travels between the bottom and the top of a column. In
     *  turns, so 0.25 is a quarter of the wheel. */
    hue_span: { type: 'float', default: 0.12, min: -1, max: 1, step: 0.01 },
    /** How much each slice is rotated against the one below it. This is what
     *  makes the volume read as depth rather than as an extrusion. */
    slice_shift: { type: 'float', default: 0.035, min: -0.5, max: 0.5, step: 0.005 },
    saturation: { type: 'float', default: 0.55, min: 0, max: 1, step: 0.01 },
    /** The value ramp from the base of a column to its top. */
    value: { type: 'vec2', default: [0.08, 0.95], min: 0, max: 1, step: 0.01 },
    /** Breaks the gradient up so the field has structure to march through. A
     *  perfectly smooth ramp renders as fog. */
    banding: { type: 'float', default: 0.35, min: 0, max: 1, step: 0.01 },
    seed: { type: 'int', default: 7, min: 0, max: 9999 },
  },
} as const satisfies NodeDefinition;

/** A hash, not a PRNG: the same seed and cell always give the same number, so
 *  a cook is reproducible and nothing carries state between rows. This is the
 *  same reason `cascade.core.Random` takes an explicit `seed` and `sample`. */
function hash(seed: number, x: number, y: number): number {
  const n = Math.sin(seed * 12.9898 + x * 78.233 + y * 37.719) * 43758.5453;
  return n - Math.floor(n);
}

/** HSV rather than a ramp of stops, because the parameter a person wants to
 *  reach for here is a hue and the whole point is to turn one. */
function hsv(h: number, s: number, v: number): [number, number, number] {
  const turn = ((h % 1) + 1) % 1;
  const sector = turn * 6;
  const c = v * s;
  const x = c * (1 - Math.abs((sector % 2) - 1));
  const m = v - c;
  const rgb: [number, number, number] =
    sector < 1 ? [c, x, 0] :
    sector < 2 ? [x, c, 0] :
    sector < 3 ? [0, c, x] :
    sector < 4 ? [0, x, c] :
    sector < 5 ? [x, 0, c] : [c, 0, x];
  return [rgb[0] + m, rgb[1] + m, rgb[2] + m];
}

export async function execute(context: NodeExecutionContext<typeof definition>) {
  const { size, hue_span, slice_shift, saturation, value, banding, seed } = context.props;
  const [stops, slices] = size;
  const [low, high] = value;

  // Allocated over an explicit ArrayBuffer because that is what `Raster`
  // declares — `ImageData` will not take a view over a SharedArrayBuffer.
  const data = new Uint8ClampedArray(new ArrayBuffer(stops * slices * 4));
  let hueSum = 0;

  for (let slice = 0; slice < slices; slice += 1) {
    // Each slice is the same column turned a little and jittered, which is what
    // a stack of photographs of one sky at different moments also gives you.
    const turn = slice * slice_shift + (hash(seed, slice, 0) - 0.5) * slice_shift;
    for (let stop = 0; stop < stops; stop += 1) {
      const t = stops === 1 ? 0 : stop / (stops - 1);
      // Quantised toward `banding` steps, so the march has edges to find.
      const steps = Math.max(2, Math.round(2 + (1 - banding) * 30));
      const stepped = Math.round(t * (steps - 1)) / (steps - 1);
      const ramp = t * (1 - banding) + stepped * banding;

      const h = context.inputs.hue + turn + ramp * hue_span;
      const v = low + (high - low) * ramp;
      const [r, g, b] = hsv(h, saturation, v);

      const at = (slice * stops + stop) * 4;
      data[at] = r * 255;
      data[at + 1] = g * 255;
      data[at + 2] = b * 255;
      data[at + 3] = 255;
      hueSum += ((h % 1) + 1) % 1;
    }
  }

  // `cachePath(context.nodeId, ...)` and not a literal: one module can run as
  // several nodes, and a fixed filename makes them overwrite each other.
  const image = await writeRaster(
    { width: stops, height: slices, data },
    cachePath(context.nodeId, '.png'),
  );

  context.outputs.image.set(image);
  context.outputs.mean_hue.set(hueSum / (stops * slices));
}
