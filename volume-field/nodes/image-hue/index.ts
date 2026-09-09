// image-hue — an image in, a number out.
//
// Here to show the shape rather than because the maths is interesting: not
// every node transforms a picture, and a graph reads better when the value a
// downstream node needs is visibly derived from the thing it describes rather
// than typed into two places.
//
// `volume-render` wants the field's mean hue for its own tinting. Before this
// node existed that number was a second parameter someone had to keep in step
// with the colours by hand, which is exactly the sort of quiet duplication a
// node graph is supposed to remove.
import type { NodeDefinition, NodeExecutionContext } from 'cascade/contracts';
import { readRaster } from '../../lib/pixels';

export const definition = {
  apiVersion: 1,
  label: 'Image Hue',
  icon: 'Pipette',
  runsOn: 'portable',
  inputs: { image: { kind: 'data', type: 'image' } },
  outputs: { hue: { kind: 'data', type: 'float' } },
  props: {},
} as const satisfies NodeDefinition;

export async function execute(context: NodeExecutionContext<typeof definition>) {
  const incoming = context.inputs.image;
  if (!incoming) throw new Error('image-hue has nothing wired to its image input');
  const source = await readRaster(incoming);

  // Averaged as a vector on the colour wheel, not as a scalar. Hue wraps, so
  // the arithmetic mean of 0.99 and 0.01 is 0.5 — the opposite side of the
  // wheel from both. This is the one thing in the node worth reading.
  let x = 0;
  let y = 0;
  for (let at = 0; at < source.data.length; at += 4) {
    const r = source.data[at]! / 255;
    const g = source.data[at + 1]! / 255;
    const b = source.data[at + 2]! / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    if (d === 0) continue;
    let h = 0;
    if (max === r) h = ((g - b) / d) / 6;
    else if (max === g) h = (2 + (b - r) / d) / 6;
    else h = (4 + (r - g) / d) / 6;
    // Weighted by saturation: a grey pixel has no hue to contribute and should
    // not drag the mean toward red.
    const weight = d;
    x += Math.cos(h * Math.PI * 2) * weight;
    y += Math.sin(h * Math.PI * 2) * weight;
  }

  const mean = x === 0 && y === 0 ? 0 : Math.atan2(y, x) / (Math.PI * 2);
  context.outputs.hue.set(((mean % 1) + 1) % 1);
}
