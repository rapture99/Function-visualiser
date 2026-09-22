/**
 * Hilbert curve index over a G×G lattice, G a power of two.
 *
 * Used to place several nodes inside one lattice cell. A Hilbert index is chosen over a row
 * ordering or a spiral for one specific property: **quadrant containment under refinement**.
 * When a cell gets crowded and G doubles, `floor(u * 2G)` is always a child of
 * `floor(u * G)`, so a node refines *within* the quadrant it already occupied instead of
 * teleporting across the cell. That is what keeps a crowded cell's growth invisible to the
 * nodes already in it, and it is why S1 costs at most a few units of movement.
 *
 * All integer bit operations — no transcendentals, exact on every engine.
 */

function rotate(n: number, x: number, y: number, rx: number, ry: number): [number, number] {
  if (ry === 0) {
    if (rx === 1) {
      return [n - 1 - y, n - 1 - x]
    }
    return [y, x]
  }
  return [x, y]
}

/** Lattice coordinate -> distance along the curve. */
export function hilbertXYToD(n: number, x: number, y: number): number {
  let rx = 0
  let ry = 0
  let d = 0
  let cx = x
  let cy = y
  for (let s = n >> 1; s > 0; s >>= 1) {
    rx = (cx & s) > 0 ? 1 : 0
    ry = (cy & s) > 0 ? 1 : 0
    d += s * s * ((3 * rx) ^ ry)
    const rotated = rotate(s, cx, cy, rx, ry)
    cx = rotated[0]
    cy = rotated[1]
  }
  return d
}

/** Distance along the curve -> lattice coordinate. */
export function hilbertDToXY(n: number, d: number): [number, number] {
  let t = d
  let x = 0
  let y = 0
  for (let s = 1; s < n; s <<= 1) {
    const rx = 1 & (t >> 1)
    const ry = 1 & (t ^ rx)
    const rotated = rotate(s, x, y, rx, ry)
    x = rotated[0] + s * rx
    y = rotated[1] + s * ry
    t >>= 2
  }
  return [x, y]
}
