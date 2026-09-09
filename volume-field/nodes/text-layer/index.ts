// text-layer — a word composited over an image.
//
// The second half of what makes this a sketch rather than a render: a volume on
// its own is a picture of a volume, and a word on top of it is a piece of
// design. It is also the smallest useful example of compositing in Cascade —
// an `image` in, an `image` out, and the drawing done on a canvas both hosts
// provide.
//
// Kept deliberately dumb about layout. It centres, or it sits at a fraction of
// the frame, and it does not know about columns, baselines or wrapping. A node
// that tried to be a typesetter would be the wrong example.
import type { NodeDefinition, NodeExecutionContext } from 'cascade/contracts';
import { cachePath } from 'cascade/io';
import { readRaster, writeRaster } from '../../lib/pixels';

export const definition = {
  apiVersion: 1,
  label: 'Text Layer',
  icon: 'Type',
  runsOn: 'portable',
  inputs: {
    image: { kind: 'data', type: 'image' },
    /** An input rather than a prop so it can be driven — from a series, from an
     *  expression, or from another node that decides what the frame should say. */
    text: { kind: 'data', type: 'string', default: 'Cascade' },
  },
  outputs: {
    image: { kind: 'data', type: 'image' },
  },
  props: {
    /** As a fraction of the frame's smaller side, so the same value holds
     *  whatever the render resolution is. A size in pixels would silently
     *  change meaning the moment the resolution did. */
    size: { type: 'float', default: 0.11, min: 0.01, max: 1, step: 0.005 },
    /** Where the text sits, 0..1 across the frame. Centre is the default
     *  because a word over a volume is a title, not a caption. */
    anchor: { type: 'vec2', default: [0.5, 0.5], min: 0, max: 1, step: 0.01 },
    colour: { type: 'color', default: [1, 1, 1, 1] },
    /** Tracking, in ems. Canvas has `letterSpacing` in both hosts, and a
     *  display word usually wants a little. */
    tracking: { type: 'float', default: 0.04, min: -0.2, max: 1, step: 0.005 },
    weight: {
      type: 'string',
      default: '500',
      control: 'select',
      options: [
        { value: '300', label: 'Light' },
        { value: '400', label: 'Regular' },
        { value: '500', label: 'Medium' },
        { value: '700', label: 'Bold' },
      ],
    },
    /**
     * `over` draws the word on top; `screen` lets the volume show through it.
     *
     * Two and not the whole canvas list, because these are the two that suit a
     * luminous field — the rest are available by editing one line, and a select
     * with sixteen entries teaches nothing.
     */
    blend: {
      type: 'string',
      default: 'over',
      control: 'select',
      options: [
        { value: 'over', label: 'Over' },
        { value: 'screen', label: 'Screen' },
      ],
    },
    opacity: { type: 'float', default: 1, min: 0, max: 1, step: 0.01 },
  },
} as const satisfies NodeDefinition;

/**
 * A stack rather than one family: the headless host has whatever the machine
 * has, so naming a font that may be absent has to degrade rather than fail.
 *
 * A function and not a `const`, because `cascade check` refuses module-level
 * values in a node module — *"use a pure function or pass state through ports,
 * props, and declared capabilities"*. The rule reads pedantic against a string
 * literal and is right in general: a module-level binding is where per-cook
 * state hides, and the check cannot tell a constant from a cache.
 */
function fontStack(): string {
  return '"Helvetica Neue", Helvetica, Arial, sans-serif';
}

function css(colour: readonly number[]): string {
  const [r, g, b, a = 1] = colour;
  return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a})`;
}

export async function execute(context: NodeExecutionContext<typeof definition>) {
  const { size, anchor, colour, tracking, weight, blend, opacity } = context.props;
  // An `image` input with no default is legitimately absent until something is
  // wired to it, and the type says so. Saying which port is empty beats the
  // "cannot read properties of undefined" a bare read would give.
  const incoming = context.inputs.image;
  if (!incoming) throw new Error('text-layer has nothing wired to its image input');
  const source = await readRaster(incoming);

  const canvas = new OffscreenCanvas(source.width, source.height);
  const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new Error('no 2D context on this host');

  ctx.putImageData(new ImageData(source.data, source.width, source.height), 0, 0);

  const pixels = Math.max(4, Math.round(Math.min(source.width, source.height) * size));
  ctx.font = `${weight} ${pixels}px ${fontStack()}`;
  // Set after `font`, because assigning `font` resets it in both hosts.
  ctx.letterSpacing = `${tracking}em`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.globalAlpha = opacity;
  ctx.globalCompositeOperation = blend === 'screen' ? 'screen' : 'source-over';
  ctx.fillStyle = css(colour as readonly number[]);
  ctx.fillText(context.inputs.text, anchor[0] * source.width, anchor[1] * source.height);

  const composited = ctx.getImageData(0, 0, source.width, source.height);
  const image = await writeRaster(
    { width: source.width, height: source.height, data: composited.data as Uint8ClampedArray<ArrayBuffer> },
    cachePath(context.nodeId, '.png'),
  );
  context.outputs.image.set(image);
}
