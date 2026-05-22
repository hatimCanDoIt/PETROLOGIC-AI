/** User overrides for well-log curve line styles (persisted in localStorage). */

import type { LogCurveColorKey } from '@/utils/logCurveColors'

export type LogCurveLineStyle = 'solid' | 'dashed' | 'dotted'

export type LogCurveStyles = Partial<Record<LogCurveColorKey, LogCurveLineStyle>>

const STORAGE_KEY = 'petrologic:logCurveStyles'

export const LOG_CURVE_STYLE_DEFAULTS: Record<LogCurveColorKey, LogCurveLineStyle> = {
  gr: 'solid',
  vsh: 'solid',
  sp: 'solid',
  rt: 'solid',
  nphi: 'solid',
  dphi: 'dashed',
  phie: 'solid',
  shc: 'solid',
  sw: 'solid',
  bvw: 'dashed',
  pef: 'solid',
}

export function loadLogCurveStyles(): LogCurveStyles {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as LogCurveStyles
    if (!parsed || typeof parsed !== 'object') return {}
    return parsed
  } catch {
    return {}
  }
}

export function saveLogCurveStyles(styles: LogCurveStyles): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(styles))
  } catch {
    /* quota / private mode */
  }
}

export function resolveLogCurveStyle(
  key: LogCurveColorKey,
  overrides: LogCurveStyles,
): LogCurveLineStyle {
  return overrides[key] ?? LOG_CURVE_STYLE_DEFAULTS[key]
}

export function canvasLineDash(style: LogCurveLineStyle): number[] {
  switch (style) {
    case 'dashed':
      return [6, 4]
    case 'dotted':
      return [2, 3]
    default:
      return []
  }
}
