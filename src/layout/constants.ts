/**
 * The frozen geometry table.
 *
 * These constants are deliberately *cosmetic*: changing PHASE_PITCH from 72 to 100 makes the
 * map wider and changes nothing about its correctness, determinism or stability. No stability
 * guarantee in this layout depends on a tuned number — which is the main reason this approach
 * was chosen over a force-directed one, where the clamp constants ARE the stability story.
 */

import type { Layer, NodeKind } from '../schema/kinds.js'

/** Altitude of each layer plane. The gaps are large enough to stay unambiguous once each
 *  layer's terraces are stacked inside it — see the clearance test. */
export const LAYER_Y: Record<Layer, number> = {
  actor: 256,
  interface: 128,
  logic: 0,
  data: -128,
  external: -288,
}

/** Vertical distance between two kind terraces inside one layer. */
export const TERRACE_PITCH = 16

/**
 * Terraces within each layer, top to bottom.
 *
 * The count per layer is the density answer (R4): space is proportional to expected
 * population by construction. `logic` gets six terraces against `actor`'s two, which matches
 * the 3–4× density the logic layer always carries, and their order follows the usual call
 * direction — entry, then controller, then service, then decision — so a controller→service
 * call is a short vertical hop rather than a scribble across a crowded plane.
 *
 * `error` is the bottom terrace of EVERY layer, because the parser assigns an error node the
 * layer of the step it branches from. An error therefore hangs directly beneath its cause.
 */
export const TERRACES: Record<Layer, readonly (readonly NodeKind[])[]> = {
  actor: [['actor'], ['error']],
  interface: [['ui'], ['component'], ['input', 'output'], ['error']],
  logic: [
    ['api', 'event'],
    ['controller'],
    ['service', 'function', 'job'],
    ['decision'],
    ['unknown', 'unresolved'],
    ['error'],
  ],
  data: [['entity'], ['store', 'state'], ['error']],
  external: [['external'], ['error']],
}

/** Horizontal distance between two flow-phase columns. */
export const PHASE_PITCH = 72

/** Width and depth of one lattice cell. Nodes occupy x in [72k - 16, 72k + 16], which leaves
 *  the 40-unit gutter between columns provably empty for edges to run through. */
export const CELL = 32

/**
 * Distance between module districts along Z.
 *
 * Districts are packed densely and left-anchored from z = 0, never rescaled. The design this
 * is based on used a sparse hash address inside a power-of-two span so a new module would
 * land in a hole — but that span doubles when the module count crosses 4, 8, 16…, which
 * uniformly rescales every Z coordinate and moves 100% of nodes. Two of the three reviewers
 * independently flagged that as the single worst remaining defect, and the sample document
 * has exactly 4 modules, so adding one fires it immediately.
 *
 * Dense left-anchored packing trades that away: inserting a module shifts the districts after
 * it by one pitch, which is a rigid single-axis slide well inside the S5 budget, and it never
 * rescales anything. Ordering alphabetically rather than by hash also removes the design's
 * own first-listed risk — that you cannot guess where a district will be from its name.
 */
export const MODULE_PITCH = 96

/** Nodes belonging to no module share one district. */
export const COMMONS_KEY = '@commons'

/** Columns of clear space between the last real phase and the shelf of unattached nodes. */
export const SHELF_GAP = 2

/** Nodes per row on the unattached shelf before wrapping. */
export const SHELF_WIDTH = 6
