// word-points — a word, as points particles can be pulled toward.
//
// This is where the sketch's specificity lives, and the split is the
// interesting part of the example. `cascade.pop.Simulate` takes an `attract`
// input of plain geometry and knows nothing about type; this node knows about
// type and nothing about particles. So the rasterising, the font and the
// threshold are all here, and core stays pure arithmetic that cooks the same in
// a browser and under the CLI.
//
// The original of this piece renders its word to an offscreen canvas, blurs it,
// reads the pixels back and takes central differences to get a gradient field.
// This does the first half of that and stops: the pixels above a threshold
// become points, and the pull is the solver's business.
import type { NodeDefinition, NodeExecutionContext } from 'cascade/contracts';
import { GeometryBuilder } from 'cascade/runtime';

export const definition = {
  apiVersion: 1,
  label: 'Word Points',
  icon: 'Type',
  // `portable`, not `browser`: both hosts supply `OffscreenCanvas` — the
  // browser natively, the headless host through @napi-rs/canvas — so the same
  // node rasterises the word in Studio and under `cascade run`. Marked
  // `browser` first, and the preflight said the CLI could not run the graph,
  // which was true of the declaration rather than of the node.
  runsOn: 'portable',
  inputs: {
    /** An input rather than a prop so it can be driven — from a series, an
     *  expression, or a node that decides what the frame should say. */
    text: { kind: 'data', type: 'string', default: 'Cascade' },
  },
  outputs: {
    geometry: { kind: 'data', type: 'geometry' },
  },
  props: {
    /** The world rectangle the word is laid into. Particles are born and
     *  pulled in the same space, so this is what lines the two up. */
    size: { type: 'vec2', default: [900, 300] },
    /** Sampling grid across the word. Coarser is faster and reads as a
     *  looser word; the attraction is local, so this is the real quality
     *  control rather than the font size. */
    resolution: { type: 'vec2i', default: [180, 60], min: 4, max: 1024 },
    /** Luminance above which a cell becomes a target point. */
    threshold: { type: 'float', default: 0.4, min: 0.01, max: 1, step: 0.01 },
    weight: {
      type: 'string',
      default: '700',
      control: 'select',
      options: [
        { value: '300', label: 'Light' },
        { value: '500', label: 'Medium' },
        { value: '700', label: 'Bold' },
        { value: '900', label: 'Black' },
      ],
    },
    tracking: { type: 'float', default: 0.02, min: -0.2, max: 1, step: 0.005 },
  },
} as const satisfies NodeDefinition;

/** A stack rather than one family, and a function rather than a const: a node
 *  module may not declare module-level values, and the headless host has
 *  whatever the machine has. */
function fontStack(): string {
  return '"Helvetica Neue", Helvetica, Arial, sans-serif';
}

export async function execute(context: NodeExecutionContext<typeof definition>) {
  const { size, resolution, threshold, weight, tracking } = context.props;
  const [columns, rows] = resolution;
  const [worldWidth, worldHeight] = size;

  // Rendered at the sampling resolution rather than at some larger size and
  // downsampled. The grid IS the sampling, so a second scale would only add a
  // filter between the letterform and the points.
  const canvas = new OffscreenCanvas(columns, rows);
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new Error('no 2D context on this host');

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, columns, rows);
  /**
   * Fitted to the grid, by measuring rather than by guessing.
   *
   * A fixed fraction of the row count was the first version and it clipped:
   * "Cascade" bold at 72% of a 74-row canvas is wider than 220 columns, so the
   * final `e` was drawn off the edge and simply never became points. Nothing
   * errored — the word just came out one letter short, which is the kind of
   * fault that reads as a design decision.
   *
   * So measure at a trial size and scale to fit, capped by the height. A
   * longer word gets smaller instead of losing its end.
   */
  ctx.letterSpacing = `${tracking}em`;
  const trial = Math.round(rows * 0.72);
  ctx.font = `${weight} ${trial}px ${fontStack()}`;
  const measured = ctx.measureText(context.inputs.text).width;
  const usable = columns * 0.94;
  const fitted = measured > usable
    ? Math.max(4, Math.floor(trial * (usable / measured)))
    : trial;
  ctx.font = `${weight} ${fitted}px ${fontStack()}`;
  // Set again: assigning `font` resets letterSpacing in both hosts.
  ctx.letterSpacing = `${tracking}em`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff';
  ctx.fillText(context.inputs.text, columns / 2, rows / 2);

  const pixels = ctx.getImageData(0, 0, columns, rows).data;
  const builder = new GeometryBuilder({ positionSize: 2 });

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const at = (row * columns + column) * 4;
      // Luminance rather than one channel: the text is drawn white on black,
      // but a future source might not be.
      const luminance =
        (0.2126 * pixels[at]! + 0.7152 * pixels[at + 1]! + 0.0722 * pixels[at + 2]!) / 255;
      if (luminance < threshold) continue;
      // Geometry is +Y up and the raster's rows run top-down, so the row is
      // flipped here. This is the one flip, the same one `SvgExport` documents,
      // and getting it wrong mirrors the word without erroring.
      builder.addPoint(
        (column / (columns - 1) - 0.5) * worldWidth,
        (0.5 - row / (rows - 1)) * worldHeight,
      );
    }
  }

  context.outputs.geometry.set(builder.build());
}
