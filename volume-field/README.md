# volume-field

A colour field, raymarched on the GPU. Two nodes and a wire.

![A soft twilight sphere, the volume rendered](docs/still.png)

## What it does

`field-columns` generates a small image: **stops across, slices down**. Each row is one slice through a volume, each column position is a step up that slice, and the pixel is the colour there. Twenty-eight by ten — 280 pixels in total, which is the whole input to the render.

`volume-render` marches rays through that field on the GPU and writes an image. It is one portable node borrowing the host's shared `GPUDevice`: GPU resources never cross a port, an image comes in and an image goes out. The same node runs in the browser and under the CLI's optional Dawn host.

That is the entire sketch. The interest is in how little there is.

## Why the input is generated

A volume like this is a natural thing to drive from photographs — one photograph per slice, its colours averaged into a column. That is what the original of this technique does.

An example cannot ship photographs. So `field-columns` produces a field in the same shape by arithmetic, and the trade is a good one for a reader: **the whole input is forty lines of colour maths you can see**, rather than a decoder for a file format you do not have.

**To use your own pictures instead**, replace `field-columns` with a node that reads images and writes the same `image` output — stops across, slices down, RGBA. Nothing downstream changes, because the renderer only ever sees a raster.

## The parameters worth turning

`hue_span` is how far the colour travels between the base of a slice and its top; `slice_shift` rotates each slice against the one below it, which is what makes the volume read as depth rather than as an extrusion. `banding` breaks the gradient into steps — at zero the field is smooth and renders as fog, because a raymarcher needs edges to find. `container` swaps the shape the field is confined to, and it changes the picture more than anything else here: a `cube` reads as a soft glowing block, a `sphere` shows the banding.

`hue` is an **input** rather than a prop, which is the one authoring decision in this sketch worth explaining. Inputs can be driven; props are set. An expression on `hue` — `$T * 0.05` — walks the whole volume through the spectrum over twenty seconds, and that is the parameter you would animate.

## Things this sketch demonstrates

- **`definition-v1` authoring** — a static `definition` literal, so the node's ports are known without running it, and `cascade check` can check the graph statically.
- **The `gpu` capability**, declared rather than assumed. On a host without WebGPU the node fails with a sentence naming what is missing, instead of a stray undefined.
- **`cachePath(context.nodeId, …)`** rather than a literal filename. One module can run as several nodes, and a fixed path makes them overwrite each other.
- **A hash instead of a PRNG.** `hash(seed, x, y)` gives the same number for the same cell every time, so a cook is reproducible and no state crosses between rows. Cascade's `cascade.core.Random` takes an explicit `seed` and `sample` for the same reason.
- **One `vec2i` for a resolution**, not two ints. Anything with an x and a y is one vector: two floats that are really one vector cost two Inspector rows and let a graph carry a width without its height.

## Running it

```bash
npm install
npm run studio   # the editor, in a browser
npm run run      # a still into renders/still, headless
npm run check    # typecheck the node modules
npm run check:graph
```

Headless rendering of a GPU node needs the optional Dawn install: `npm i webgpu`. Without it the CLI says so and renders nothing rather than pretending.
