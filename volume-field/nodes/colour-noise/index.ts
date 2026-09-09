// colour-noise — break a gradient up so it has something to look at.
//
// A ramp is too clean. The renderer marches through it and finds nothing, so
// the volume comes out as a smooth blob. This roughens the field, and the
// interesting parameter is `per_slice`: jitter that differs row to row makes the
// slices stop being copies of each other, which is most of what stops the
// volume reading as an extrusion.
//
// A hash rather than a PRNG. `hash(seed, x, y)` gives the same number for the
// same cell every time, so a cook is reproducible and no state crosses between
// pixels — the same reason `cascade.core.Random` takes an explicit `seed` and
// `sample` instead of holding a stream.
import type { NodeDefinition, NodeExecutionContext } from 'cascade/contracts';
import { cachePath } from 'cascade/io';
import { readRaster, writeRaster } from '../../lib/pixels';

export const definition = {
  apiVersion: 1,
  label: 'Colour Noise',
  icon: 'Waves',
  runsOn: 'portable',
  inputs: { image: { kind: 'data', type: 'image' } },
  outputs: { image: { kind: 'data', type: 'image' } },
  props: {
    /** Per-pixel value jitter, 0..1 of full range. */
    amount: { type: 'float', default: 0.16, min: 0, max: 1, step: 0.01 },
    /** Per-row brightness offset. Rows are slices, so this is depth variation
     *  rather than grain. */
    per_slice: { type: 'float', default: 0.22, min: 0, max: 1, step: 0.01 },
    /** Cell size in pixels: above 1 the noise is blocky rather than fine,
     *  which the renderer resolves into visible structure instead of grain. */
    scale: { type: 'int', default: 2, min: 1, max: 16 },
    seed: { type: 'int', default: 7, min: 0, max: 9999 },
  },
} as const satisfies NodeDefinition;

function hash(seed: number, x: number, y: number): number {
  const n = Math.sin(seed * 12.9898 + x * 78.233 + y * 37.719) * 43758.5453;
  return n - Math.floor(n);
}

export async function execute(context: NodeExecutionContext<typeof definition>) {
  const incoming = context.inputs.image;
  if (!incoming) throw new Error('colour-noise has nothing wired to its image input');
  const { amount, per_slice, scale, seed } = context.props;
  const source = await readRaster(incoming);

  for (let row = 0; row < source.height; row += 1) {
    // One offset for the whole row, so a slice is uniformly lighter or darker
    // than its neighbours rather than noisier than them.
    const rowOffset = (hash(seed, 0, row) - 0.5) * per_slice;
    for (let column = 0; column < source.width; column += 1) {
      const cell = (hash(seed, Math.floor(column / scale), Math.floor(row / scale)) - 0.5) * amount;
      const gain = 1 + rowOffset + cell;
      const at = (row * source.width + column) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        source.data[at + channel] = source.data[at + channel]! * gain;
      }
    }
  }

  context.outputs.image.set(await writeRaster(source, cachePath(context.nodeId, '.png')));
}
