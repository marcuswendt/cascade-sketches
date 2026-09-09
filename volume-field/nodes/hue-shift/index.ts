// hue-shift — rotate an image's hue, optionally by row.
//
// The node that turns a stack of identical ramps into a volume with depth.
// `per_slice` is the parameter that matters: it rotates each row a little
// further than the one below, so the field varies along the axis the renderer
// marches through, and the result reads as depth rather than as an extrusion.
//
// Row-indexed rather than pixel-indexed on purpose. This node knows the image
// it is handed is a column field — width is stops, height is slices — which is
// the one assumption in the chain, and it is the assumption that lets a
// two-line change express the whole idea.
import type { NodeDefinition, NodeExecutionContext } from 'cascade/contracts';
import { cachePath } from 'cascade/io';
import { readRaster, writeRaster } from '../../lib/pixels';

export const definition = {
  apiVersion: 1,
  label: 'Hue Shift',
  icon: 'RotateCw',
  runsOn: 'portable',
  inputs: {
    image: { kind: 'data', type: 'image' },
    /** Turns, applied to the whole image. An input because this is the
     *  parameter worth animating: `$T * 0.05` walks the volume through the
     *  spectrum over twenty seconds. */
    amount: { kind: 'data', type: 'float', default: 0, min: -1, max: 1 },
  },
  outputs: { image: { kind: 'data', type: 'image' } },
  props: {
    /** Turns added per row, cumulatively. This is the depth control. */
    per_slice: { type: 'float', default: 0.045, min: -0.25, max: 0.25, step: 0.005 },
    /** Multiplies saturation on the way through, so one node can take a ramp
     *  from muted to vivid without a second pass over the pixels. */
    saturation: { type: 'float', default: 1.35, min: 0, max: 3, step: 0.05 },
  },
} as const satisfies NodeDefinition;

/** RGB to HSV and back, in the one place. Written out rather than imported so
 *  the node reads end to end — the conversion is the node. */
function toHsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) / 6;
    else if (max === g) h = (2 + (b - r) / d) / 6;
    else h = (4 + (r - g) / d) / 6;
  }
  return [((h % 1) + 1) % 1, max === 0 ? 0 : d / max, max];
}

function toRgb(h: number, s: number, v: number): [number, number, number] {
  const sector = (((h % 1) + 1) % 1) * 6;
  const c = v * Math.min(1, Math.max(0, s));
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
  const incoming = context.inputs.image;
  if (!incoming) throw new Error('hue-shift has nothing wired to its image input');
  const { per_slice, saturation } = context.props;
  const source = await readRaster(incoming);

  for (let row = 0; row < source.height; row += 1) {
    const shift = context.inputs.amount + row * per_slice;
    for (let column = 0; column < source.width; column += 1) {
      const at = (row * source.width + column) * 4;
      const [h, s, v] = toHsv(
        source.data[at]! / 255,
        source.data[at + 1]! / 255,
        source.data[at + 2]! / 255,
      );
      const [r, g, b] = toRgb(h + shift, s * saturation, v);
      source.data[at] = r * 255;
      source.data[at + 1] = g * 255;
      source.data[at + 2] = b * 255;
    }
  }

  context.outputs.image.set(await writeRaster(source, cachePath(context.nodeId, '.png')));
}
