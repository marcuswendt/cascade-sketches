# volume-field

A colour field, raymarched on the GPU. Two nodes and a wire.

![A soft twilight sphere, the volume rendered](docs/still.png)

## What it does

Six nodes in a chain, with one branch:

```
gradient-ramp → colour-noise → hue-shift ─┬→ volume-render → text-layer
                                          └→ image-hue ────┘
```

**`gradient-ramp`** writes a small raster: **stops across, slices down**. Each row is one slice through a volume, each column position is a step up that slice, and the pixel is the colour there. Twenty-eight by ten — 280 pixels, which is the whole input to the render.

**`colour-noise`** roughens it. A clean ramp renders as a smooth blob, because a raymarcher marches through it and finds nothing; the interesting parameter is `per_slice`, which offsets whole rows so the slices stop being copies of each other.

**`hue-shift`** rotates the hue, and rotates each row a little further than the one below. That is what makes the volume read as depth rather than as an extrusion, and it is two lines of the node.

**`image-hue`** takes the image and returns a number — the field's mean hue, which the renderer wants for its own tinting. It is here to show that shape: not every node transforms a picture, and a value the renderer needs should visibly derive from the thing it describes rather than be typed into two places.

**`volume-render`** marches rays through the field on the GPU. One portable node borrowing the host's shared `GPUDevice`: GPU resources never cross a port, an image comes in and an image goes out. The same node runs in the browser and under the CLI's optional Dawn host.

**`text-layer`** composites a word on top. A volume on its own is a picture of a volume; a word over it is a piece of design.

### Why it is six nodes and not one

The first version of this sketch had a single node that produced the field — ramp, noise, hue and banding in one `execute`. It rendered the same picture and taught almost nothing, because the graph was two boxes and a wire and all the interest was inside a file.

Split up, the graph *is* the explanation: you can see the field being built, unplug a stage to see what it contributed, and put a different one in the middle. That is worth more in an example than the fewer lines the monolith had. It is also the honest shape — these really are four separate operations, and one of them reduces an image to a number rather than returning a picture.

## Why the input is generated

A volume like this is a natural thing to drive from photographs — one photograph per slice, its colours averaged into a column. That is what the original of this technique does.

An example cannot ship photographs. So the chain builds a field in the same shape by arithmetic, and the trade is a good one for a reader: **the whole input is colour maths you can read**, rather than a decoder for a file format you do not have.

**To use your own pictures instead**, replace `gradient-ramp` with a node that reads images and writes the same `image` output — stops across, slices down, RGBA. Nothing downstream changes, because everything after it only ever sees a raster.

## The parameters worth turning

`hue_span` is how far the colour travels between the base of a slice and its top; `slice_shift` rotates each slice against the one below it, which is what makes the volume read as depth rather than as an extrusion. `banding` breaks the gradient into steps — at zero the field is smooth and renders as fog, because a raymarcher needs edges to find. `container` swaps the shape the field is confined to, and it changes the picture more than anything else here: a `cube` reads as a soft glowing block, a `sphere` shows the banding.

`hue-shift`'s `amount` is an **input** rather than a prop, which is the one authoring decision in this sketch worth explaining. Inputs can be driven; props are set. An expression on `amount` — `$T * 0.05` — walks the whole volume through the spectrum over twenty seconds, and that is the parameter you would animate.

On the renderer, `exposure`, `density` and `floor` matter more than they sound. Left at their defaults the volume comes out milky whatever the field does, because every ray crosses the whole range and averages toward the middle. Low exposure with high density is what makes it read as luminous.

## Things this sketch demonstrates

- **`definition-v1` authoring** — a static `definition` literal, so the node's ports are known without running it, and `cascade check` can check the graph statically.
- **The `gpu` capability**, declared rather than assumed. On a host without WebGPU the node fails with a sentence naming what is missing, instead of a stray undefined.
- **An image port carries a path, not pixels.** Every node here decodes a file and encodes one, which is why the chain is legible at all: each stage is inspectable as an image.
- **`cachePath(context.nodeId, …)`** rather than a literal filename. One module can run as several nodes, and a fixed path makes them overwrite each other.
- **No module-level values.** `cascade check` refuses them in a node module, so even a font stack is a function. The rule reads pedantic against a string literal and is right in general: a module-level binding is where per-cook state hides, and the check cannot tell a constant from a cache.
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
