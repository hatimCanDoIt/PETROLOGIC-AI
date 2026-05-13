// Centralised colour + design constants for the log viewer & report UI.

export const COLORS = {
  bg: '#03080f',
  bgPanel: '#081422',
  bgDeep: '#050d17',
  border: '#162840',
  borderLight: '#1e3a5f',

  accent: '#00d4ff',
  accentDim: '#0099bb',

  oil: '#f5a623',
  gas: '#ff3d5a',
  reservoir: '#39ff8a',
  water: '#3b82f6',

  text: '#b8d4e8',
  textDim: '#4a6680',
  textBright: '#e8f4ff',

  // Track curves
  gr: 'rgba(57,255,138,0.9)',
  grFill: 'rgba(57,255,138,0.12)',
  vsh: 'rgba(74,102,128,0.4)',
  rt: 'rgba(255,107,53,1.0)',
  rtFill: 'rgba(255,107,53,0.08)',
  nphi: '#00d4ff',
  dphi: '#ffd166',
  shc: 'rgba(57,255,138,0.9)',
  shcFill: 'rgba(57,255,138,0.18)',
  sw: 'rgba(255,80,80,0.9)',
  swFill: 'rgba(255,80,80,0.18)',
  bvw: 'rgba(59,130,246,0.95)',
  pef: 'rgba(192,132,252,0.9)',

  // Zone backgrounds
  zoneOilFill: 'rgba(245,166,35,0.07)',
  zoneGasFill: 'rgba(255,61,90,0.07)',
  zoneOilLine: 'rgba(245,166,35,0.85)',
  zoneGasLine: 'rgba(255,61,90,0.85)',

  // Lith colours
  lithSandstone: '#f5d97e',
  lithDolomite: '#a8d4f5',
  lithLimestone: '#f59e9e',
  lithUncertain: '#4a6680',
}

export const LITH_LABELS: Record<number, string> = {
  0: 'sandstone',
  1: 'dolomite',
  2: 'limestone',
  3: 'uncertain',
}

export const LITH_COLORS = [
  COLORS.lithSandstone,
  COLORS.lithDolomite,
  COLORS.lithLimestone,
  COLORS.lithUncertain,
]

export const PX_PER_FT = 4 // baseline pixels per foot at zoomFactor=1
