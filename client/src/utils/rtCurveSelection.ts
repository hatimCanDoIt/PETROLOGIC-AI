const STORAGE_PREFIX = 'petrologic:rtCurves:v2:'

/** Deep resistivity — virgin formation Rt for Archie. */
const DEEP_PATTERNS = [
  /^AT90$/i,
  /^AF90$/i,
  /^AO90$/i,
  /^AHT90$/i,
  /^AT60$/i,
  /^ILD$/i,
  /^LLD$/i,
  /^RILD$/i,
  /^RT$/i,
  /^M2R9$/i,
  /^AORT$/i,
]

/** Shallow / medium — flushed zone Rxo. */
const SHALLOW_PATTERNS = [
  /^AT10$/i,
  /^AT20$/i,
  /^AT30$/i,
  /^AF10$/i,
  /^AF20$/i,
  /^AF30$/i,
  /^AO10$/i,
  /^AO20$/i,
  /^AO30$/i,
  /^RXO/i,
  /^AORX$/i,
  /^ILS$/i,
  /^RILS$/i,
  /^M2R1$/i,
  /^SFL$/i,
]

/** Micro — mud cake / filtrate QC. */
const MICRO_PATTERNS = [/^RXO8$/i, /^HMIN$/i, /^HMNO$/i, /^MSFL$/i, /^BMIN$/i, /^BMNO$/i]

const ALL_RT_PATTERNS = [...DEEP_PATTERNS, ...SHALLOW_PATTERNS, ...MICRO_PATTERNS]

export function isResistivityMnemonic(mnemonic: string): boolean {
  return ALL_RT_PATTERNS.some((p) => p.test(mnemonic))
}

/** Collect resistivity mnemonics from validation, overview, raw arrays, well curve list. */
export function discoverResistivityMnemonics(
  ...sources: (readonly string[] | undefined)[]
): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const add = (m: string) => {
    const key = m?.trim()
    if (!key || key === 'depth' || seen.has(key)) return
    if (!isResistivityMnemonic(key)) return
    seen.add(key)
    out.push(key)
  }
  for (const list of sources) {
    for (const m of list ?? []) add(m)
  }
  const rank = (m: string): number => {
    if (DEEP_PATTERNS.some((p) => p.test(m))) return 0
    if (SHALLOW_PATTERNS.some((p) => p.test(m))) return 1
    if (MICRO_PATTERNS.some((p) => p.test(m))) return 2
    return 3
  }
  return out.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
}

function firstMatch(available: string[], patterns: RegExp[]): string | undefined {
  for (const p of patterns) {
    const hit = available.find((m) => p.test(m))
    if (hit) return hit
  }
  return undefined
}

/** Default RT overlays: deep (primary) + one shallow + one micro when present. */
export function defaultRtCurveSelection(
  available: string[],
  primaryMnemonic: string,
): string[] {
  const uniq = [...new Set(available.filter(Boolean))]
  const out: string[] = []
  const add = (m: string | undefined) => {
    if (m && uniq.includes(m) && !out.includes(m)) out.push(m)
  }
  add(primaryMnemonic)
  add(firstMatch(uniq, SHALLOW_PATTERNS))
  add(firstMatch(uniq, MICRO_PATTERNS))
  if (out.length === 0 && uniq.length) return [uniq[0]]
  return out
}

/** Always include deep + shallow + micro defaults; merge any user-saved extras. */
export function mergeRtCurveSelection(
  available: string[],
  primaryMnemonic: string,
  saved: string[] | null,
): string[] {
  const defaults = defaultRtCurveSelection(available, primaryMnemonic)
  if (!saved?.length) return defaults
  const savedValid = saved.filter((m) => available.includes(m))
  const merged = [...new Set([...defaults, ...savedValid])]
  return merged.length > 0 ? merged : defaults
}

export function loadRtCurveSelection(storageKey: string | undefined): string[] | null {
  if (!storageKey) return null
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${storageKey}`)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    return parsed.filter((m): m is string => typeof m === 'string' && m.length > 0)
  } catch {
    return null
  }
}

export function saveRtCurveSelection(storageKey: string | undefined, mnemonics: string[]): void {
  if (!storageKey) return
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${storageKey}`, JSON.stringify(mnemonics))
  } catch {
    /* quota / private mode */
  }
}

/** Distinct colors for extra RT curves on the same track (primary uses theme RT color). */
export const RT_COMPARE_COLORS = [
  '#38bdf8',
  '#e879f9',
  '#a3e635',
  '#fbbf24',
  '#fb7185',
  '#94a3b8',
  '#2dd4bf',
  '#f97316',
] as const

/** Human-readable resistivity role for track legend / tooltips. */
export function rtCurveRole(mnemonic: string): 'deep' | 'shallow' | 'micro' | 'other' {
  if (DEEP_PATTERNS.some((p) => p.test(mnemonic))) return 'deep'
  if (SHALLOW_PATTERNS.some((p) => p.test(mnemonic))) return 'shallow'
  if (MICRO_PATTERNS.some((p) => p.test(mnemonic))) return 'micro'
  return 'other'
}
