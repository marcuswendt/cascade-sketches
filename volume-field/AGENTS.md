# volume-field — notes for an agent

A worked example, so the bar is different from a working sketch: **clarity beats capability.** A change that makes this do more and read worse is a bad change.

- **It must run with nothing installed but its own dependencies.** No account, no key, no dataset, no photograph. If a change needs external material, the change is wrong for this repo.
- **Node modules are `definition-v1`**: a static `export const definition` literal plus an `execute` that is a pure function of its inputs and props. Do not reach for the dynamic authoring style; it cannot be checked statically, which is the whole reason it is going.
- **Follow the parent repo's conventions.** `~/Documents/Dev/cascade/AGENTS.md` is authoritative: Houdini's parameter names where Houdini has an equivalent, geometry +Y up, one `vec2` for anything with an x and a y, radians for bare trigonometry.
- **Comments explain why, not what.** The reason a decision was made is the part a reader cannot recover from the code, and it is the reason this repo exists.
- Run `npm run check` and `npm run check:graph` before claiming a change works. `check:graph` is the one that catches a broken wire.
