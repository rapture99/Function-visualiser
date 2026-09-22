import type { Layer } from '../schema/kinds.js'

export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface Bounds {
  min: Vec3
  max: Vec3
}

/** One module rendered as a district: a slab at fixed Z spanning every layer it touches. */
export interface ModuleFrame {
  key: string
  name: string
  z: number
  halfDepth: number
  bounds: Bounds
  /** Where the single glyph goes when the module is collapsed. */
  anchor: Vec3
  memberIds: string[]
}

/** One flow-phase column, for the X ruler that makes the axis legible as flow order. */
export interface ColumnRuler {
  phase: number
  x: number
  label: string
  nodeCount: number
}

export interface LayerPlane {
  layer: Layer
  y: number
  /** Top and bottom of the terrace stack actually occupied in this layer. */
  top: number
  bottom: number
  nodeCount: number
}

export interface LayoutResult {
  /** Node ids, sorted, parallel to `positions` and `slots`. */
  nodeIds: string[]
  /** 3 floats per node: x, y, z. */
  positions: Float32Array
  /** 4 ints per node: phase, layerIndex, band, hilbertIndex. Exposed for golden tests. */
  slots: Int32Array
  bounds: Bounds
  layers: LayerPlane[]
  modules: ModuleFrame[]
  columns: ColumnRuler[]
  /** FNV over the position bytes. Lets Phase 6 skip re-uploading when nothing moved. */
  layoutHash: string
}

/** Convenience view for the stability harness and the renderer. */
export function positionsById(result: LayoutResult): Record<string, Vec3> {
  const out: Record<string, Vec3> = {}
  for (let i = 0; i < result.nodeIds.length; i++) {
    out[result.nodeIds[i]!] = {
      x: result.positions[i * 3]!,
      y: result.positions[i * 3 + 1]!,
      z: result.positions[i * 3 + 2]!,
    }
  }
  return out
}
