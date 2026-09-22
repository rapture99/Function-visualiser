/**
 * Integer primitives for the layout.
 *
 * Every pseudo-random choice in the layout is a hash of the node's own id — content
 * addressing rather than sampling — so there is no seed to remember and no PRNG state to
 * thread. FNV-1a plus murmur3's finalizer, both using Math.imul and shifts, which are exact
 * 32-bit integer operations and therefore bit-identical on every JavaScript engine.
 *
 * NOTHING in src/layout may use Math.pow, Math.log, Math.log2, Math.sin, Math.cos or
 * Math.hypot: those are only approximated by the spec, so two engines can disagree in the
 * last bit and the layout would stop being reproducible. Capacities double with integer
 * loops; the packer is a Hilbert lattice rather than a golden-angle spiral for this reason.
 * `layout-purity.test.ts` enforces this by scanning the source.
 */

/** FNV-1a over UTF-16 code units, finished with murmur3 fmix32. */
export function hash32(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  h ^= h >>> 16
  h = Math.imul(h, 2246822507) >>> 0
  h ^= h >>> 13
  h = Math.imul(h, 3266489909) >>> 0
  h ^= h >>> 16
  return h >>> 0
}

/** hash32 mapped into [0, 1). Used only where a fraction is genuinely wanted. */
export function unitHash(text: string): number {
  return hash32(text) / 4294967296
}

/** Position of the highest set bit. An integer loop, never Math.log2. */
export function bitLength(value: number): number {
  let n = value >>> 0
  let bits = 0
  while (n > 0) {
    bits++
    n >>>= 1
  }
  return bits
}

/**
 * Byte-wise comparison on UTF-16 code units. Never localeCompare, whose result depends on
 * the host's collation tables and would make the layout machine-dependent.
 */
export function cmpId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Quantise to 1/16. A dyadic quantum is exactly representable in IEEE-754, so two engines
 * that disagree by an ULP mid-computation still emit identical bytes.
 */
export function q(value: number): number {
  return Math.round(value * 16) / 16
}

/** Stable FNV over a float buffer, for golden tests and Phase 6 change detection. */
export function hashPositions(positions: Float32Array): string {
  const bytes = new Uint8Array(positions.buffer, positions.byteOffset, positions.byteLength)
  let h = 2166136261
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]!
    h = Math.imul(h, 16777619) >>> 0
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}
