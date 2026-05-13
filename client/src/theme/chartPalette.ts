/** Curve pigments + zone lith colours shared across themes. */
export const CURVE_PALETTE_BASE = {
  oil: '#f5a623',
  gas: '#ff3d5a',
  reservoir: '#39ff8a',
  water: '#3b82f6',

  gr: 'rgba(57,255,138,0.9)',
  grFill: 'rgba(57,255,138,0.12)',
  rt: 'rgba(255,107,53,1.0)',
  rtFill: 'rgba(255,107,53,0.08)',
  nphi: '#0ea5e9',
  dphi: '#fbbf24',
  shc: 'rgba(57,255,138,0.9)',
  shcFill: 'rgba(57,255,138,0.18)',
  sw: 'rgba(255,80,80,0.9)',
  swFill: 'rgba(255,80,80,0.18)',
  bvw: 'rgba(59,130,246,0.95)',
  pef: 'rgba(192,132,252,0.9)',
  sp: 'rgba(255,170,80,0.95)',
  spFill: 'rgba(255,170,80,0.12)',

  zoneOilFill: 'rgba(245,166,35,0.08)',
  zoneGasFill: 'rgba(255,61,90,0.08)',
  zoneOilLine: 'rgba(245,166,35,0.88)',
  zoneGasLine: 'rgba(255,61,90,0.88)',

  lithSandstone: '#f5d97e',
  lithDolomite: '#93c5fd',
  lithLimestone: '#f59e9e',
} as const

const LIGHT_SEM = {
  accent: '#0284c7',
  accentDim: '#0369a1',
  bg: '#ffffff',
  bgPanel: '#fafafa',
  bgDeep: '#f4f4f5',
  border: '#e4e4e7',
  borderLight: '#d4d4d8',
  text: '#18181b',
  textDim: '#71717a',
  textBright: '#09090b',
  trackGrid: 'rgba(113, 113, 122, 0.18)',
  vsh: 'rgba(100,116,132,0.42)',
  phie: 'rgba(14,165,233,0.92)',
  phieFill: 'rgba(14,165,233,0.12)',
  lithUncertain: '#7a8490',
} as const

const DARK_SEM = {
  accent: '#38bdf8',
  accentDim: '#0ea5e9',
  bg: '#09090b',
  bgPanel: '#18181b',
  bgDeep: '#27272a',
  border: '#3f3f46',
  borderLight: '#52525b',
  text: '#e4e4e7',
  textDim: '#a1a1aa',
  textBright: '#fafafa',
  trackGrid: 'rgba(130, 140, 166, 0.28)',
  vsh: 'rgba(148,164,182,0.5)',
  phie: 'rgba(56,189,248,0.95)',
  phieFill: 'rgba(56,189,248,0.12)',
  lithUncertain: '#94a3b8',
} as const

export type ThemeMode = 'light' | 'dark'

export function buildChartPalette(theme: ThemeMode) {
  return {
    ...CURVE_PALETTE_BASE,
    ...(theme === 'dark' ? DARK_SEM : LIGHT_SEM),
  }
}

export type ChartPalette = ReturnType<typeof buildChartPalette>

export function lithColorsFromPalette(p: ChartPalette) {
  return [p.lithSandstone, p.lithDolomite, p.lithLimestone, p.lithUncertain]
}
