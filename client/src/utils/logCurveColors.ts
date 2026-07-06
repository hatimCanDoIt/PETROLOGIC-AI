/** User overrides for well-log curve colors (persisted in localStorage). */

import type { ChartPalette } from '@/theme/chartPalette'

export const LOG_CURVE_COLOR_KEYS = [
  'gr',
  'vsh',
  'sp',
  'rt',
  'nphi',
  'dphi',
  'phit',
  'phie',
  'shc',
  'sw',
  'bvw',
  'pef',
] as const

export type LogCurveColorKey = (typeof LOG_CURVE_COLOR_KEYS)[number]

export type LogCurveColors = Partial<Record<LogCurveColorKey, string>>

const STORAGE_KEY = 'petrologic:logCurveColors'
const LEGACY_POROSITY_KEY = 'petrologic:porosityCurveColors'

/** Hex defaults for `<input type="color">` when the palette value is rgba. */
export const LOG_CURVE_HEX_DEFAULTS: Record<LogCurveColorKey, string> = {
  gr: '#39ff8a',
  vsh: '#647484',
  sp: '#ffaa50',
  rt: '#ff6b35',
  nphi: '#16a34a',
  dphi: '#ea580c',
  phit: '#06b6d4',
  phie: '#9333ea',
  shc: '#39ff8a',
  sw: '#ff5050',
  bvw: '#3b82f6',
  pef: '#c084fc',
}

const PALETTE_FIELD: Record<LogCurveColorKey, keyof ChartPalette> = {
  gr: 'gr',
  vsh: 'vsh',
  sp: 'sp',
  rt: 'rt',
  nphi: 'nphi',
  dphi: 'dphi',
  phit: 'phit',
  phie: 'phie',
  shc: 'shc',
  sw: 'sw',
  bvw: 'bvw',
  pef: 'pef',
}

export function loadLogCurveColors(): LogCurveColors {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    let parsed: LogCurveColors = {}
    if (raw) {
      const v = JSON.parse(raw) as LogCurveColors
      if (v && typeof v === 'object') parsed = v
    }
    const legacyRaw = localStorage.getItem(LEGACY_POROSITY_KEY)
    if (legacyRaw) {
      const leg = JSON.parse(legacyRaw) as Record<string, string>
      if (leg?.nphi) parsed.nphi = parsed.nphi ?? leg.nphi
      if (leg?.dphi) parsed.dphi = parsed.dphi ?? leg.dphi
      if (leg?.phie) parsed.phie = parsed.phie ?? leg.phie
    }
    return parsed
  } catch {
    return {}
  }
}

export function saveLogCurveColors(colors: LogCurveColors): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(colors))
  } catch {
    /* quota / private mode */
  }
}

export function resolveLogCurveColor(
  key: LogCurveColorKey,
  overrides: LogCurveColors,
  palette: ChartPalette,
): string {
  const custom = overrides[key]
  if (custom) return custom
  return String(palette[PALETTE_FIELD[key]])
}

/** `#rrggbb` for native color inputs. */
export function toColorInputValue(color: string, key: LogCurveColorKey): string {
  if (/^#[0-9a-fA-F]{6}$/.test(color)) return color
  if (/^#[0-9a-fA-F]{8}$/.test(color)) return color.slice(0, 7)
  const m = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/)
  if (m) {
    const hex = (n: number) =>
      Math.min(255, Math.max(0, n))
        .toString(16)
        .padStart(2, '0')
    return `#${hex(Number(m[1]))}${hex(Number(m[2]))}${hex(Number(m[3]))}`
  }
  return LOG_CURVE_HEX_DEFAULTS[key]
}

/** Light fill under a line curve from its stroke hex. */
export function fillFromLineColor(hex: string, alpha = 0.14): string {
  const base = toColorInputValue(hex, 'gr')
  if (!/^#[0-9a-fA-F]{6}$/.test(base)) return hex
  const a = Math.round(alpha * 255)
    .toString(16)
    .padStart(2, '0')
  return `${base}${a}`
}
