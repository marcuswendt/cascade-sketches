// word-field — a word, blurred, as a flow field.
//
// Marcus's description of the effect this rebuilds: *"a delicate balance
// between a force pulling the particles towards the centre spine of the type
// and tangentially around their outlines."* This node makes the field those two
// forces read, and the blur is the whole trick.
//
// **Why blur.** A hard letterform's gradient points at the nearest edge, so
// pulling up it pins particles to outlines. Blur it first and each stroke
// becomes a ridge whose peak runs down its middle — so the gradient points at
// the *spine*, and its perpendicular runs *along* the outline. The blur is not
// softening; it is what turns an outline into a skeleton. The original blurs its
// text for exactly this reason.
//
// Output is points carrying `N`, which is a vector field in Cascade's existing
// vocabulary — so the rasterising stays here, where a sketch's knowledge of type
// belongs, and the physics stays in `cascade.pop.*` as pure arithmetic.
import type { NodeDefinition, NodeExecutionContext } from 'cascade/contracts';
import { GeometryBuilder } from 'cascade/runtime';

export const definition = {
  apiVersion: 1,
  label: 'Word Field',
  icon: 'Wind',
  runsOn: 'portable',
  inputs: {
    text: { kind: 'data', type: 'string', default: 'Cascade' },
  },
  outputs: {
    /** Points carrying `N`, the gradient of the blurred word. */
    geometry: { kind: 'data', type: 'geometry' },
  },
  props: {
    /** The world rectangle the word is laid into. */
    size: { type: 'vec2', default: [820, 260] },
    /** Sampling grid. This is the field's resolution, so it decides how
     *  smoothly the force varies rather than how sharp the word looks. */
    resolution: { type: 'vec2i', default: [200, 64], min: 8, max: 1024 },
    /**
     * Blur radius in cells. Small values leave outlines; larger ones move the
     * ridge to the middle of a stroke, which is what makes a spine. Below
     * about 2 there is no spine to find.
     */
    blur: { type: 'int', default: 5, min: 0, max: 40 },
    /** Cells whose gradient is weaker than this are dropped, so the field is
     *  points near the word rather than a full grid of mostly-nothing. Lower it
     *  to reach further out from the type, which is what a bundle needs. */
    threshold: { type: 'float', default: 0.008, min: 0, max: 1, step: 0.001 },
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

function fontStack(): string {
  return '"Helvetica Neue", Helvetica, Arial, sans-serif';
}

/** A separable box blur, run twice — two box passes approximate a Gaussian
 *  closely enough for a force field and cost a fraction of one. */
function blurred(source: Float32Array, width: number, height: number, radius: number): Float32Array {
  if (radius <= 0) return source;
  let data = source;
  for (let pass = 0; pass < 2; pass += 1) {
    data = boxPass(data, width, height, radius, true);
    data = boxPass(data, width, height, radius, false);
  }
  return data;
}

function boxPass(
  source: Float32Array,
  width: number,
  height: number,
  radius: number,
  horizontal: boolean,
): Float32Array {
  const out = new Float32Array(source.length);
  const span = radius * 2 + 1;
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      let total = 0;
      for (let offset = -radius; offset <= radius; offset += 1) {
        // Clamped at the edges rather than wrapped: wrapping would pull the
        // word's first stroke toward its last.
        const c = horizontal
          ? Math.min(width - 1, Math.max(0, column + offset))
          : column;
        const r = horizontal
          ? row
          : Math.min(height - 1, Math.max(0, row + offset));
        total += source[r * width + c]!;
      }
      out[row * width + column] = total / span;
    }
  }
  return out;
}

export async function execute(context: NodeExecutionContext<typeof definition>) {
  const { size, resolution, blur, threshold, weight, tracking } = context.props;
  const [columns, rows] = resolution;
  const [worldWidth, worldHeight] = size;

  const canvas = new OffscreenCanvas(columns, rows);
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new Error('no 2D context on this host');

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, columns, rows);
  // Fitted by measurement, not by a fraction of the canvas: a fixed fraction
  // drew "Cascade" wider than the grid and the final letter simply never
  // became field, with nothing reporting it.
  ctx.letterSpacing = `${tracking}em`;
  const trial = Math.round(rows * 0.72);
  ctx.font = `${weight} ${trial}px ${fontStack()}`;
  const measured = ctx.measureText(context.inputs.text).width;
  const usable = columns * 0.9;
  const fitted = measured > usable ? Math.max(4, Math.floor(trial * (usable / measured))) : trial;
  ctx.font = `${weight} ${fitted}px ${fontStack()}`;
  ctx.letterSpacing = `${tracking}em`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff';
  ctx.fillText(context.inputs.text, columns / 2, rows / 2);

  const pixels = ctx.getImageData(0, 0, columns, rows).data;
  const luminance = new Float32Array(columns * rows);
  for (let index = 0; index < luminance.length; index += 1) {
    const at = index * 4;
    luminance[index] =
      (0.2126 * pixels[at]! + 0.7152 * pixels[at + 1]! + 0.0722 * pixels[at + 2]!) / 255;
  }

  const field = blurred(luminance, columns, rows, blur);
  const builder = new GeometryBuilder({ positionSize: 2 });
  const normals: number[] = [];
  // The field's value as well as its direction, so a force can hold a level
  // rather than only climb. A bundle is a contour, and a contour is a level.
  const levels: number[] = [];

  const sample = (column: number, row: number): number =>
    field[
      Math.min(rows - 1, Math.max(0, row)) * columns +
      Math.min(columns - 1, Math.max(0, column))
    ]!;

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      // Central differences, as the original does. Uphill is toward the ridge,
      // so no negation — and the y difference is inverted because the raster's
      // rows run top-down while geometry is +Y up. This is the one flip.
      const dx = sample(column + 1, row) - sample(column - 1, row);
      const dy = sample(column, row - 1) - sample(column, row + 1);
      const magnitude = Math.hypot(dx, dy);
      if (magnitude < threshold) continue;

      builder.addPoint(
        (column / (columns - 1) - 0.5) * worldWidth,
        (0.5 - row / (rows - 1)) * worldHeight,
      );
      // Normalised: the force's own amplitude decides strength, so a field
      // carrying magnitude as well would give two places to tune one thing.
      normals.push(dx / magnitude, dy / magnitude);
      levels.push(sample(column, row));
    }
  }

  if (normals.length > 0) {
    builder.setNumericAttribute('point', 'N', Float32Array.from(normals), 2, 'f32');
    builder.setNumericAttribute('point', 'level', Float32Array.from(levels), 1, 'f32');
  }
  context.outputs.geometry.set(builder.build());
}
