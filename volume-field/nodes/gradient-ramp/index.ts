// gradient-ramp — two colours and a curve, as an image.
//
// The first node in the chain, and the one that decides what the volume is made
// of. It writes a raster whose **width is the stops** up a column and whose
// **height is the slices** through the volume: every row is the same ramp, and
// the nodes downstream are what make the rows differ.
//
// Two colours rather than a stop list. A ramp editor is the obvious next step
// and it is deliberately not here: the point of this node in an example is that
// you can read the whole of it, and `mix(a, b, pow(t, curve))` is the whole of
// it.
import type { NodeDefinition, NodeExecutionContext } from 'cascade/contracts';
import { cachePath } from 'cascade/io';
import { blankRaster, writeRaster } from '../../lib/pixels';

export const definition = {
  apiVersion: 1,
  label: 'Gradient Ramp',
  icon: 'ArrowUpDown',
  runsOn: 'portable',
  inputs: {},
  outputs: { image: { kind: 'data', type: 'image' } },
  props: {
    /** [stops, slices]. One `vec2i`, because a resolution is one thing. */
    size: { type: 'vec2i', default: [28, 10], min: 2, max: 256 },
    colour_a: { type: 'color', default: [0.02, 0.06, 0.12, 1] },
    colour_b: { type: 'color', default: [0.95, 0.72, 0.35, 1] },
    /**
     * Bends the mix. Above 1 the ramp spends more of its length near
     * `colour_a`, which is what makes a volume read as luminous rather than
     * evenly lit — a linear ramp through a raymarcher comes out as a uniform
     * glow, because every ray crosses the whole range.
     */
    curve: { type: 'float', default: 2.4, min: 0.2, max: 6, step: 0.1 },
    /** Quantise the ramp into this many bands. A raymarcher needs edges to
     *  find; a perfectly smooth field renders as fog. Zero leaves it smooth. */
    bands: { type: 'int', default: 7, min: 0, max: 64 },
  },
} as const satisfies NodeDefinition;

export async function execute(context: NodeExecutionContext<typeof definition>) {
  const { size, colour_a, colour_b, curve, bands } = context.props;
  const [stops, slices] = size;
  const a = colour_a as readonly number[];
  const b = colour_b as readonly number[];
  const raster = blankRaster(stops, slices);

  for (let stop = 0; stop < stops; stop += 1) {
    const linear = stops === 1 ? 0 : stop / (stops - 1);
    const stepped = bands > 1 ? Math.round(linear * (bands - 1)) / (bands - 1) : linear;
    const t = Math.pow(stepped, curve);
    for (let slice = 0; slice < slices; slice += 1) {
      const at = (slice * stops + stop) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        raster.data[at + channel] = (a[channel]! + (b[channel]! - a[channel]!) * t) * 255;
      }
    }
  }

  context.outputs.image.set(await writeRaster(raster, cachePath(context.nodeId, '.png')));
}
