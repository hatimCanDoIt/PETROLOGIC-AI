/**
 * Pick the value at the sample whose depth is the first depth ≥ ft (same scheme
 * as TrackCanvas hover). Returns null when no finite value at that sample.
 */

export function nearestDepthSampleValue(
  depths: number[],
  values: (number | null)[],
  ft: number,
): number | null {
  const n = Math.min(depths.length, values.length)
  if (n === 0) return null
  let lo = 0
  let hi = n - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (depths[mid] < ft) lo = mid + 1
    else hi = mid
  }
  const idx = lo
  const v = values[idx]
  if (v == null || !Number.isFinite(v)) return null
  return v as number
}

export function formatSampleAtDepth(logScale: boolean | undefined, v: number): string {
  return v.toFixed(logScale ? 2 : 3)
}
