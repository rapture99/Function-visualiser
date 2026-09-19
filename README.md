# Func Visualiza

A Markdown-driven functionality explorer. You write structured Markdown describing how
something works — a whole application, one feature, or a single function — and it becomes an
interactive graph you can search, filter and play back step by step.

```
docs/<your-document>.md
        ↓  scan   →  line-numbered blocks
        ↓  extract →  raw IR (what was literally written)
        ↓  resolve →  references, edges, derived fields
   public/graphs/*.json
        ↓
   3D map · 2D flow view · detail panel
```

The Markdown is the source of truth. `graph.json` is the only thing any renderer sees.

## Status

**All six phases are working, plus a stack-agnostic scanner and a publishable package.** 205 tests passing.

| Phase | | |
| ----- | - | - |
| 1 | Markdown schema, parser, CLI, diagnostics | done |
| — | 2D viewer: lane overview, workflow flow view, search, filters, detail panel | done |
| 2 | Deterministic layered 3D layout + stability harness | done |
| 3 | 3D explorer (R3F, worker-driven, instanced) | done |
| 4 | Collapse/expand, keyboard tree view | done |
| 5 | Workflow playback | done |
| 6 | Live Markdown sync (watch + reindex + push) | done |

## Use it as a VS Code extension

```bash
npm run build                 # project root: builds dist/node + dist/web
cd extension && npm install && npm run build
npx @vscode/vsce package --no-dependencies --allow-missing-repository
code --install-extension flow-visualizer-vscode-0.1.0.vsix
```

Then **Flow Visualizer: Open** from the command palette. `Scan this workspace` drafts
documents from the code; editing anything under `docs/` reindexes and updates the map live.

The reason to use it over the browser build: every node carries the `file:line` it came from,
and in the editor those become links — click the evidence and the file opens at that line.

## Use it on any project on this machine

This is a private package — `private: true`, never published. It is installed locally by
linking the checkout, which puts a `flow-visualizer` command on your PATH:

```bash
cd "<this folder>"
npm link                 # once; builds, then links globally
```

After that, from any directory:

```bash
flow-visualizer scan ../my-app --split    # draft documents from a codebase
flow-visualizer parse                     # index docs/ into graphs
flow-visualizer serve --open              # browse them
```

Because the link is a symlink to this checkout, editing the source and running
`npm run build` updates the global command immediately — no reinstall. `npm unlink -g
flow-visualizer` removes it.

`serve` runs the same document API the dev server exposes, so an installed copy can scan,
reindex and remove documents exactly like a checkout can — it is not a read-only preview.

The package also exports its pieces, so you can build on the parts rather than the whole:

```ts
import { parse }          from 'flow-visualizer'          // Markdown -> graph, no Node deps
import { parseGraph }     from 'flow-visualizer/schema'    // the graph.json contract
import { computeLayout }  from 'flow-visualizer/layout'    // deterministic 3D positions
import { runScan }        from 'flow-visualizer/scanner'   // codebase -> draft documents
import { documentsApi }   from 'flow-visualizer/vite'      // the dev-server plugin
```

`flow-visualizer` and `/schema` and `/layout` are browser-safe — they import nothing from
Node — which is what lets the viewer parse a dropped file in the page.

## Developing it

```bash
npm install
npm run parse          # index docs/ -> public/graphs/*.json + public/documents.json
npm run dev            # http://localhost:5173 (next free port if taken)
npm run build          # dist/node (compiled) + dist/web (viewer bundle)
```

### Managing documents from the app

While `npm run dev` is running there is a **Documents** panel in the header. It scans a
project by path, reindexes `docs/`, and removes documents — no terminal round-trip. It is a
Vite plugin, so it exists only in dev: a built site is static files with no backend, and the
panel says so rather than offering controls that would fail.

Removing **moves the Markdown to `docs/.trash/`** instead of deleting it. Discovery skips
dot-directories, so the document leaves the index immediately while staying recoverable —
deleting a hand-written document on a misclick is not a recoverable mistake.

Splitting defaults to *Auto*, which splits above 150 nodes. That is not cosmetic: a single
catalogue that size never gets pruned or given workflows, because nobody can hold it long
enough to finish it.

### Feeding it your own documents

Nothing is hardcoded. `npm run parse` takes any mix of files and folders, anywhere on disk:

```bash
npm run parse -- ../my-app/docs                 # a folder elsewhere
npm run parse -- docs ../my-app/docs ./notes.md # several sources at once
npm run parse -- ../my-app --strict             # scan a whole repo, fail on warnings
```

It walks folders recursively and picks up only files that actually declare a `### Node:` or
`## Workflow:` outside a code fence — so a README or a design note in the same folder is
skipped rather than parsed into an empty graph. A file you name explicitly is always taken.
The viewer reads `public/documents.json`, so whatever the build finds is what appears in the
document picker.

**Or skip the build entirely**: drag a `.md` file — or a whole folder — onto the page. The
parser has no Node dependencies, so it runs in the browser and the document appears
immediately. Nothing is uploaded anywhere.

### Starting from a codebase instead of a blank page

```bash
npm run scan -- ../my-app                      # draft a document from source
npm run scan -- ../my-frontend ../my-api       # separate repos, scanned as one system
```

The scanner reads a project and emits a **draft** document: a node catalogue with a
`file:line` for every entry, plus dependency edges recovered from real HTTP calls. It is
stack-agnostic by construction — every framework it understands is a row in
[`src/scanner/rules.ts`](src/scanner/rules.ts), so supporting another means adding entries,
not writing an extractor. Express, Koa, Fastify, NestJS, FastAPI, Flask, Django, Spring,
ASP.NET, Go routers and Rails are in the table today; Mongoose, Sequelize, Prisma, TypeORM,
SQLAlchemy, Django models and raw SQL DDL cover the data side. Where nothing matches, it
falls back to directory conventions (`pages/`, `services/`, `controllers/`, `jobs/`) that
hold across almost every codebase.

Passing several roots matters more than it sounds: a frontend and its API are usually
separate repos, and scanned alone neither is complete — the frontend has calls with nothing
to match, the backend has routes nobody appears to call.

### Splitting a large project by feature

```bash
npm run scan -- ../my-app --split            # one document per feature
npm run scan -- ../my-app --split --min-nodes 5
```

A 200-node catalogue is not reviewable, so nobody prunes it or writes its workflows and it
stays a draft forever. `--split` writes a directory of feature-sized documents instead, and
`npm run parse` picks all of them up as separate entries in the document picker.

Features are inferred from the codebase's own shape: a container directory (`pages/`,
`components/`, `routes/`, `services/`, `models/`…) followed by the feature name. That makes
`routes/auth.routes.js`, `pages/Auth/Login.tsx` and `services/authService.ts` all land on
**Auth** — the whole vertical slice, across the stack, in one document. Vendored UI kits
(`components/ui/`) pool into a single bucket rather than becoming one feature per button.

Dependencies that cross a seam are preserved: the referenced node is re-declared in the
document that needs it, tagged `Feature:` with where it really lives. Each document stays
independently valid, and the seams between features become visible instead of being buried.

**It never generates workflows.** A workflow is a claim about intent, and a scanner can see
that a file declares `POST /api/leaves` but not that this is step four of applying for leave.
Templates are emitted as HTML comments for you to fill in, and everything the scan could not
determine — calls with computed URLs, unmatched routes — goes into `## Open questions`
rather than being guessed at. The `orphan-node` warnings from `npm run parse` are your to-do
list.

```bash
npm test               # 205 tests
npm run typecheck
npm run build          # production bundle into dist/
npm run share          # parse + build + serve the static build on 4173 (good for tunnelling)
npm run parse:file     # single file -> single JSON, for scripting
```

The viewer reads the generated JSON from `public/`, so **run `parse` before `dev`** the first
time. After that the dev server watches `docs/` and reindexes on every save, pushing the new
index down the HMR socket — your selection, filters, collapse state, playback position and
camera all survive, because only the data is replaced.

### What the viewer does

Two views of the same `graph.json`, toggled in the header. **2D** is the better way to read a
single workflow — a sequence is a sequence, and 3D only adds occlusion. **3D** is the better
way to see the whole system: layers as planes, modules as districts, flow as depth.

The 3D scene runs the layout in a worker, draws nodes as instanced meshes (shape carries kind,
colour carries layer — two channels, because colour alone fails for colour-blind viewers), and
loads Three.js lazily so the 2D view never pays the megabyte. Edges appear on demand: the
active workflow's steps, or the selected node's own connections. Jumps between columns or
districts are lifted onto an overpass above the actor plane, where nothing can occlude them
and where the shape itself says "this is a jump, not a step".


- **Overview** — nodes in horizontal lanes, one per layer, with modules as labelled blocks.
  Draws the connections when there are few enough to stay readable, and falls back to
  showing only the selected node's edges above that, so a dense document never becomes a
  hairball and a sparse one is never mysteriously empty.
- **Workflow view** — pick a workflow and it lays out as a top-to-bottom flow (dagre), with
  numbered step badges, routed edges, and error paths branching off in red.
- **Detail panel** — identity, `file:line` provenance, all metadata, which workflows traverse
  the node, which roles reach it, and clickable incoming/outgoing connections.
- **Filters** — by layer, and by role. Role filtering uses `rolesReached` (roles that
  actually arrive via some workflow), not the roles a node declares.
- **Structure tree** — the graph as real DOM. A WebGL canvas is opaque to assistive
  technology and no amount of ARIA on the canvas fixes that, so this is the accessible peer
  of the map rather than a fallback: every node is focusable, arrow keys walk it, Home/End
  jump to the ends, and selection is shared with both views. It is also the fastest way in
  when you already know what you are looking for.
- **Collapse/expand** — fold a module from the tree and it becomes one stand-in in 2D and one
  marker in 3D. Collapse is pure visibility: the layout never sees it, so no other node moves
  and expanding restores the map exactly. That is a property of the address lattice — no
  node's position depends on another module's member count — not something the viewer arranges.
- **Workflow playback** — play, pause, step, scrub and 0.5–4× speed over any workflow. The
  path lights up cumulatively rather than blinking one node at a time, the 3D camera eases
  its target along the flow while keeping whatever angle you chose, and the step list is
  clickable, so scrubbing and reading are the same action. The timeline is compiled once up
  front, and continuous progress is written straight to the DOM through a ref — putting
  elapsed time in React state is the obvious way to write it and it re-renders the whole
  graph sixty times a second.
- Edge styling carries meaning: dashed = read, thick = write, dotted = plain sequence,
  red dashed = error path.

The CLI is headless — no browser, no renderer imports — so it can gate a build:

```bash
npx tsx src/parser/build.ts docs --strict     # every document under docs/
npx tsx src/parser/cli.ts <one.md> -o out.json --strict
```

Exit code is 1 when the document has errors, or (with `--strict`) any warnings.

## Documents

- [docs/CONVENTION.md](docs/CONVENTION.md) — the Markdown format
- [docs/functionality.md](docs/functionality.md) — worked example at **system** scope
- [docs/examples/feature-scope.md](docs/examples/feature-scope.md) — one component
- [docs/examples/function-scope.md](docs/examples/function-scope.md) — one function

## The layout engine

`computeLayout(graph)` is a pure function of the graph alone — no previous run, no persisted
anchor, no simulation, no iteration, no PRNG. The same Markdown yields the same map on any
machine, for any teammate, and because there is no warm/cold duality every line of code runs
on every layout, so the tests exercise exactly what the product does.

A node's address comes from five stable keys:

```
Y   layer (authoritative, from the parser) subdivided into kind terraces
X   the step index of its home workflow — flow time, one column per step
Z   its module district
+   a micro-offset inside the (layer, terrace, column, district) cell, hashed from its id
```

That makes the map a **3D sequence diagram**: every workflow reads as a monotone left-to-right
path, and because nodes occupy only `x ∈ [72k ± 16]`, the gutter between columns is provably
empty for edges to run through. The dense `logic` layer gets six terraces to `actor`'s two, so
space is proportional to population by construction. Errors are the bottom terrace of every
layer, inheriting their cause's column — an error edge is a vertical drop, never a diagonal.

Measured stability, printed by the suite on every run:

| Edit | Nodes moved | Furthest | Budget |
| ---- | ----------- | -------- | ------ |
| S1 append a node | 1 / 19 | 0.51% of the scene | imperceptible |
| S2 insert mid-workflow | 12 / 19 | 6.46% | same-neighbourhood |
| S3 rename a node | **0** | — | none |
| S4 add an edge | **0** | — | (beats budget) |
| S5 add a module | 15 / 19 | 8.61% | same-neighbourhood |
| S6 delete a node | **0** | — | (beats budget) |
| S7 reorder two steps | 2 / 19 | 6.46% | same-neighbourhood |
| S8 reformat the file | **0, byte-identical** | — | none |

Layout cost: 0.9 ms at 30 nodes, 14 ms at 590, 51 ms at 2340 — and it runs in a worker.

Two rules make this reproducible rather than merely deterministic-in-practice. Every
pseudo-random choice is `hash32` of the node's own id, so there is no seed to remember. And
`src/layout` may not use `Math.pow/log/sin/cos/hypot/random`: only `+ - * /` and `sqrt` are
correctly rounded by the spec, so anything else can differ in the last bit between engines.
A test scans the source to enforce it.

## Two design rules

**Nodes are declared once; workflows only reference them.** A step naming an undeclared id
produces a visible `unresolved` ghost plus a `file:line` error — never a silently invented
node. Ambiguity is reported the same way: a step touching a data node without saying read or
write is warned about, not guessed at. A broken document is allowed to look broken; it is
never allowed to look complete.

**`graph.json` is byte-stable.** No timestamps, no absolute paths. Identical input produces
identical output, so live reload can diff two graphs and move only what actually moved —
which is what preserves your place on the map while you edit.

## Layout

```
src/schema/     graph.ts (the contract) · kinds.ts (vocabulary, kind → layer)
src/parser/     scan → extract → resolve · diagnostics · cli
src/layout/     3D address lattice: phase (X) · districts (Z) · hilbert · worker
src/viewer/     React app: graph/ (load, select, layout2d) · components/
src/testing/    synth.ts (scale fixtures) · scenarios.ts (S1–S8) · stability.ts (the ruler)
docs/           the documents themselves, CONVENTION.md, AUTHORING-PROMPT.md
public/         generated graph*.json
```
#   F u n c t i o n - v i s u a l i s e r  
 