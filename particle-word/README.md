# particle-word

A word made of particle trails. Houdini's POP model, in six nodes.

![Cascade, drawn as particle trails](docs/still.png)

## What it does

```
word-points ─┬→ pop.Simulate ──→ geo.SvgExport ──→ core.Output
             └────┘  (attract)
```

**`word-points`** renders the word to an offscreen canvas at the sampling resolution, thresholds the pixels, and emits one point per bright cell. That is where all the sketch's specificity lives: the font, the threshold, the grid.

**`cascade.pop.Simulate`** births particles on those points, pushes them with a noise field, pulls them back toward the same points, and keeps them apart. It outputs both the particles and their **trails**, one open polyline per particle.

**`cascade.geo.SvgExport`** writes the trails as an SVG. The whole picture is 2,160 short strokes.

## The interesting part: where the split falls

`Simulate` knows nothing about type. `word-points` knows nothing about particles. The wire between them carries plain `geometry`, and that is what makes each half reusable — point a photograph's bright pixels at the same input and the same simulation draws the photograph.

That split was a correction. The first version gave `Simulate` an `image` input, because the piece this is modelled on renders its word to a canvas, blurs it, and reads a gradient field back. It was wrong for a *core* node: decoding an image needs a capability, the media capability returns a host-specific lease rather than a portable raster, and a POP node doing IO stops being the pure arithmetic that lets it cook identically in a browser and under the CLI. So the rasterising moved upstream, into a project node, where a sketch's knowledge belongs.

## Things this sketch demonstrates

- **Re-simulation as the reference implementation.** `Simulate` takes a `frame` and replays every step from zero. It holds no state and reads no clock, so cooking the same frame twice is byte-identical — which is the property that makes a cache sound later, because the cache can then hold only what re-simulation would have produced anyway. Scrubbing is O(frame), and that is the honest cost.
- **Trails as geometry, not as a faded canvas.** The original of this technique draws to a persistent canvas and fades it 5.5% a frame. Trails as polylines are resolution-independent, print, and keep one feedback loop instead of two.
- **A hash instead of a PRNG.** Every random draw is a pure function of `(seed, id)`, so re-simulating gives the same particles rather than a similar-looking set.
- **`id` rather than an index.** A particle array reorders on every kill, so a trail joins its points by `id`. Joining by array position would draw a stroke from one particle to an unrelated one — a plausible tangle rather than an error.
- **A spatial index inside the force that needs it.** Attraction without one is `particles × targets`: about seven million distance checks a frame here, and the first render did not finish inside two minutes. With a grid, 1.7 seconds.

## Running it

```bash
npm install
npm run studio        # the editor, in a browser
npm run run           # writes the SVG into .cascade-cache
npm run check:graph
```

`cascade run --frames` reports that the graph has no image output — it writes an SVG rather than a raster, which the SVG node has already done by the time you see that message. Look in `.cascade-cache/`.

## Turning it

`text` on `word-points` is an input, so it can be driven; change it and the whole picture re-forms around the new word. On `Simulate`, `attract_amplitude` against `noise_amplitude` is the balance that decides whether the word is legible or a storm — at `noise 26` and `attract 2600` it reads clearly; drop the attraction by half and it dissolves. `trail_length` is how much of each particle's history is drawn.
