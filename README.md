# cascade-sketches

Worked examples for [Cascade](https://github.com/marcuswendt/cascade) — small, complete sketches you can clone and cook.

Cascade's own repository documents the API. This one answers the question the documentation cannot: *what does a real graph look like?* Each folder here is a whole sketch — a `.cascade` document, its node modules, and the manifest that ties them together — chosen to be short enough to read in one sitting.

**Every sketch generates its own inputs.** None of them needs an account, a key, a dataset or a photograph you do not have. That is a deliberate constraint rather than a convenience: an example that cannot run is not an example, and one that ships someone else's pictures is not distributable. Where a sketch would naturally consume real material, it generates something in the same shape and says in its README where to point it at your own.

## The sketches

| | |
| --- | --- |
| [`volume-field`](volume-field/) | A colour field raymarched on the GPU. WebGPU, one portable node, procedural input. |

## Running one

```bash
cd volume-field
npm install
npm run studio        # the browser editor
npm run run           # a still, headless, no browser
npm run check:graph   # static check without cooking
```

`npm run studio` opens Cascade Studio against the folder. `npm run run` renders through the CLI — a GPU sketch needs the optional Dawn install (`npm i webgpu`), and says so plainly if it is missing rather than failing obscurely.

## Reading one

Start with the `.cascade` document: it is JSON, and the node list plus the connections tell you the shape of the thing in twenty lines. Then read the node modules in the order the data flows. Each one is a `definition-v1` module — a static `definition` literal describing its ports, and an `execute` that is a pure function of them.

The comments in these sketches explain *why* rather than what. That is the house style, and it is the half worth copying.
