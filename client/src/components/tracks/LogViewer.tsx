import {
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  forwardRef,
  Fragment,
} from 'react'
import clsx from 'clsx'

import { PX_PER_FT } from '@/utils/colors'
import { lithColorsFromPalette } from '@/theme/chartPalette'
import { useChartPalette } from '@/theme/ThemeProvider'
import type { DepthInterval, HcZoneOut, ResultJson } from '@/types'

import DepthRuler from './DepthRuler'
import TrackCanvas, {
  HEADER_HEIGHT as TRACK_HEADER_PX,
  type CurveConfig,
} from './TrackCanvas'
import { useScrollSync } from './useScrollSync'
import { formatSampleAtDepth, nearestDepthSampleValue } from '@/utils/curveDepthNearest'
import {
  fillFromLineColor,
  loadLogCurveColors,
  resolveLogCurveColor,
  saveLogCurveColors,
  type LogCurveColorKey,
} from '@/utils/logCurveColors'
import {
  loadLogCurveStyles,
  resolveLogCurveStyle,
  saveLogCurveStyles,
  type LogCurveLineStyle,
} from '@/utils/logCurveStyles'
import {
  discoverResistivityMnemonics,
  loadRtCurveSelection,
  mergeRtCurveSelection,
  RT_COMPARE_COLORS,
  rtCurveRole,
  saveRtCurveSelection,
} from '@/utils/rtCurveSelection'

interface LogViewerProps {
  result: ResultJson
  zones: HcZoneOut[]
  /** Full LAS curve list — used to locate shallow/micro RT when not in overview. */
  curvesAvailable?: string[]
  /** When set, ruler + track widths persist in localStorage for this key (e.g. well id). */
  layoutStorageKey?: string
  activeZoneId?: string | null
  onZoneSelect?: (zoneId: string) => void
  /** Drag on the log to pick a depth window for Explain with AI. */
  depthInterval?: DepthInterval | null
  onDepthIntervalChange?: (interval: DepthInterval | null) => void
}

interface ReferenceLineConfig {
  value: number
  color: string
  label?: string
  dashed?: boolean
  lineStyle?: LogCurveLineStyle
  curveLabel?: string
}

interface TrackConfig {
  id: string
  /** Short subtitle for sidebar (distinct from composite header label). */
  sidebarHint?: string
  label: string
  unit?: string
  scaleLabel?: [string, string]
  scaleTicks?: number[]
  logScaleHeader?: boolean
  curves: CurveConfig[]
  referenceLines?: ReferenceLineConfig[]
  leftColorBar?: { depths: number[]; values: number[]; colors: string[] }
}

export interface LogViewerHandle {
  scrollToDepth: (ft: number) => void
  setZoom: (z: number) => void
  zoomIn: () => void
  zoomOut: () => void
}

function clampDepth(ft: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, ft))
}

function escapeHtmlText(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function hideReadingTooltip() {
  document.getElementById('tooltip')?.classList.remove('visible')
}

/** Keep the reading tooltip inside the viewport; flip above/left of cursor when needed. */
function positionReadingTooltip(
  tip: HTMLElement,
  clientX: number,
  clientY: number,
  offset = 14,
  margin = 10,
) {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const w = tip.offsetWidth
  const h = tip.offsetHeight

  let left = clientX + offset
  if (left + w + margin > vw) {
    left = clientX - w - offset
  }
  left = Math.max(margin, Math.min(left, vw - w - margin))

  let top = clientY + offset
  if (top + h + margin > vh) {
    top = clientY - h - offset
  }
  top = Math.max(margin, Math.min(top, vh - h - margin))

  tip.style.left = `${left}px`
  tip.style.top = `${top}px`
}

function readingTooltipHtml(
  ft: number,
  trackList: TrackConfig[],
  headlineColor: string,
): string {
  const chunks: string[] = [
    `<div style="font-weight:600;color:${headlineColor};margin-bottom:0.35em">${ft.toFixed(
      1,
    )} <span style="font-weight:normal;opacity:0.7">ft</span></div>`,
  ]

  let anyNamed = false
  for (const tk of trackList) {
    for (const c of tk.curves) {
      if (!c.label.trim()) continue
      anyNamed = true
      const v = nearestDepthSampleValue(c.depths as number[], c.values, ft)
      const lbl = escapeHtmlText(c.label)
      if (v == null) {
        chunks.push(
          `<div><span style="color:${c.color}">${lbl}:</span> <span style="opacity:0.5">—</span></div>`,
        )
      } else {
        chunks.push(
          `<div><span style="color:${c.color}">${lbl}:</span> ${formatSampleAtDepth(c.logScale, v)}</div>`,
        )
      }
    }
  }

  if (!anyNamed || trackList.length === 0) {
    chunks.push(
      `<div style="opacity:0.62;font-size:0.94em;margin-top:0.2em">Enable tracks above to compare curves.</div>`,
    )
  }

  return chunks.join('')
}

function cleanArray(arr?: (number | null)[]): number[] {
  if (!arr) return []
  return arr.map((v) => (v == null || !Number.isFinite(v) ? NaN : v))
}

/** Arithmetic mean with optional backend stat fallback. */
function meanArithmetic(
  values: (number | null)[],
  statsMean?: number,
): number | null {
  if (statsMean != null && Number.isFinite(statsMean)) return statsMean
  const finite = values.filter(
    (v): v is number => v != null && Number.isFinite(v),
  )
  if (finite.length === 0) return null
  return finite.reduce((sum, v) => sum + v, 0) / finite.length
}

/** Geometric mean RT (Ω·m) — matches ``petrophysics.mean_RT`` (mean of log₁₀ values). */
function meanRtOhmm(values: (number | null)[], statsMean?: number): number | null {
  if (statsMean != null && Number.isFinite(statsMean) && statsMean > 0) {
    return statsMean
  }
  const finite = values.filter(
    (v): v is number => v != null && Number.isFinite(v) && v > 0,
  )
  if (finite.length === 0) return null
  const logMean =
    finite.reduce((sum, v) => sum + Math.log10(v), 0) / finite.length
  return 10 ** logMean
}

function formatLogRtLabel(v: number): string {
  if (v >= 100) return String(Math.round(v))
  if (v >= 10) return String(Math.round(v))
  if (v >= 1) return Number.isInteger(v) ? String(v) : v.toFixed(1)
  if (v >= 0.1) return v.toFixed(1)
  if (v >= 0.01) return v.toFixed(2)
  return v.toExponential(0)
}

/** Shared log-scale bounds for all resistivity curves on the RT track. */
function autoLogRtScale(curveValueSets: (number | null)[][]): {
  xMin: number
  xMax: number
  scaleLabel: [string, string]
  scaleTicks: number[]
} {
  const finite: number[] = []
  for (const values of curveValueSets) {
    for (const v of values) {
      if (v != null && Number.isFinite(v) && v > 0) finite.push(v)
    }
  }

  const fallback = {
    xMin: 0.1,
    xMax: 1000,
    scaleLabel: ['0.1', '1000'] as [string, string],
    scaleTicks: [0.1, 1, 10, 100, 1000],
  }
  if (finite.length === 0) return fallback

  const dataMin = Math.min(...finite)
  const dataMax = Math.max(...finite)
  const logDataMin = Math.log10(dataMin)
  const logDataMax = Math.log10(dataMax)

  let logMin = Math.floor(logDataMin - 0.08)
  let logMax = Math.ceil(logDataMax + 0.08)
  if (logMax - logMin < 0.5) {
    const mid = (logDataMin + logDataMax) / 2
    logMin = mid - 0.25
    logMax = mid + 0.25
  }

  const tickLogMin = Math.floor(logMin)
  const tickLogMax = Math.ceil(logMax)
  const scaleTicks: number[] = []
  for (let e = tickLogMin; e <= tickLogMax; e++) {
    scaleTicks.push(10 ** e)
  }

  const xMin = scaleTicks[0] ?? 10 ** logMin
  const xMax = scaleTicks[scaleTicks.length - 1] ?? 10 ** logMax

  return {
    xMin,
    xMax,
    scaleLabel: [formatLogRtLabel(xMin), formatLogRtLabel(xMax)],
    scaleTicks,
  }
}

const TRACK_WIDTH_MIN = 100
const TRACK_WIDTH_MAX = 520
const RULER_WIDTH_MIN = 52
const RULER_WIDTH_MAX = 160
/** Must match the resize handle `width` below — used to compute total log strip width. */
const RESIZE_STRIP_PX = 11

const LOG_LAYOUT_LS_PREFIX = 'petrologic:logLayout:'
function logLayoutStorageKey(storageKey: string) {
  return `${LOG_LAYOUT_LS_PREFIX}${storageKey}`
}

function defaultTrackWidth(trackId: string): number {
  return trackId === 'pef' ? 180 : 170
}

function clampSize(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n))
}

/**
 * When the log viewport width changes (e.g. Report RHS resize), spread the delta
 * across visible tracks evenly so tracks stay flush with the analysis panel instead
 * of overflowing horizontally.
 */
function redistributeVisibleTrackWidths(
  ids: string[],
  prev: Record<string, number>,
  targetSum: number,
): Record<string, number> | null {
  const n = ids.length
  if (n === 0) return null

  const cur = ids.map((id) => prev[id] ?? defaultTrackWidth(id))
  const sumCur = cur.reduce((a, b) => a + b, 0)
  if (sumCur === targetSum) return null

  const minTotal = n * TRACK_WIDTH_MIN
  if (targetSum < minTotal) {
    const out = { ...prev }
    for (const id of ids) out[id] = TRACK_WIDTH_MIN
    return out
  }

  const delta = targetSum - sumCur
  const baseAdd = Math.trunc(delta / n)
  let rem = delta - baseAdd * n
  const w = cur.map((c) => clampSize(c + baseAdd, TRACK_WIDTH_MIN, TRACK_WIDTH_MAX))

  let safety = 0
  while (rem !== 0 && safety++ < 10_000) {
    if (rem > 0) {
      const idx = w.findIndex((x) => x < TRACK_WIDTH_MAX)
      if (idx < 0) break
      w[idx]++
      rem--
    } else {
      let idx = -1
      for (let i = w.length - 1; i >= 0; i--) {
        if (w[i] > TRACK_WIDTH_MIN) {
          idx = i
          break
        }
      }
      if (idx < 0) break
      w[idx]--
      rem++
    }
  }

  const out = { ...prev }
  let changed = false
  ids.forEach((id, i) => {
    if (out[id] !== w[i]) changed = true
    out[id] = w[i]
  })
  return changed ? out : null
}

/**
 * Excel-style column splitter: sits on the sticky track header row so it stays under
 * your cursor while scrolling depth; drag horizontally to widen/narrow the column to the left.
 */
function ResizeStrip({
  ariaLabel,
  width,
  min,
  max,
  onCommitWidth,
}: {
  ariaLabel: string
  width: number
  min: number
  max: number
  onCommitWidth: (n: number) => void
}) {
  const rafRef = useRef(0)

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    e.preventDefault()
    const startX = e.clientX
    const startW = width
    const latestXRef = { current: e.clientX }

    const flush = () => {
      rafRef.current = 0
      onCommitWidth(clampSize(startW + (latestXRef.current - startX), min, max))
    }

    const move = (ev: PointerEvent) => {
      latestXRef.current = ev.clientX
      if (rafRef.current) return
      rafRef.current = requestAnimationFrame(flush)
    }
    const up = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
      onCommitWidth(clampSize(startW + (latestXRef.current - startX), min, max))
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      document.body.style.removeProperty('user-select')
    }
    window.addEventListener('pointermove', move, { passive: true })
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    document.body.style.userSelect = 'none'
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      title="Drag ↔ to resize column (like Excel)"
      onPointerDown={onPointerDown}
      className="group relative sticky top-0 z-[35] shrink-0 cursor-col-resize select-none touch-none outline-none transition-colors surface-header-bar hover:bg-accent/[0.12] active:bg-accent/[0.22] focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
      style={{
        touchAction: 'none',
        width: RESIZE_STRIP_PX,
        height: TRACK_HEADER_PX,
        alignSelf: 'flex-start',
      }}
      tabIndex={0}
      onKeyDown={(ev) => {
        const step = ev.shiftKey ? 12 : 4
        if (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') {
          ev.preventDefault()
          const dir = ev.key === 'ArrowRight' ? 1 : -1
          onCommitWidth(clampSize(width + dir * step, min, max))
        }
      }}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-1.5 left-1/2 z-0 w-0.5 -translate-x-1/2 rounded-full bg-border group-hover:bg-accent"
      />
    </div>
  )
}

const LogViewer = forwardRef<LogViewerHandle, LogViewerProps>(function LogViewer(
  {
    result,
    zones,
    curvesAvailable,
    layoutStorageKey,
    activeZoneId,
    onZoneSelect,
    depthInterval = null,
    onDepthIntervalChange,
  },
  ref,
) {
  const overview = result.overview
  const depths = cleanArray(overview.depth as unknown as number[])
  const validDepths = depths.filter((d) => Number.isFinite(d))
  const depthMin = validDepths.length ? Math.min(...validDepths) : 0
  const depthMax = validDepths.length ? Math.max(...validDepths) : 1

  const layoutHostRef = useRef<HTMLDivElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [viewportHeight, setViewportHeight] = useState(600)
  const [crosshairContentY, setCrosshairContentY] = useState<number | null>(null)
  const [depthRulerWidth, setDepthRulerWidth] = useState(80)
  const [trackWidths, setTrackWidths] = useState<Record<string, number>>({})
  const [curveColors, setCurveColors] = useState(loadLogCurveColors)
  const [curveStyles, setCurveStyles] = useState(loadLogCurveStyles)

  const primaryRtMnemonic = useMemo(() => {
    const fromMap = result.curve_map?.RT
    if (fromMap) return fromMap
    const fromVal = result.validation?.rt_mnemonic
    if (typeof fromVal === 'string' && fromVal) return fromVal
    return 'RT'
  }, [result.curve_map, result.validation])

  const availableRtMnemonics = useMemo(() => {
    const fromVal = result.validation?.rt_mnemonics
    const list = Array.isArray(fromVal) ? (fromVal as string[]) : []
    const fromOv = Object.keys(result.overview.rt_curves ?? {})
    const fromRaw = Object.keys(result.raw_arrays ?? {}).filter((k) => k !== 'depth')
    return discoverResistivityMnemonics(
      [primaryRtMnemonic],
      list,
      fromOv,
      fromRaw,
      curvesAvailable,
    )
  }, [
    result.validation,
    result.overview.rt_curves,
    result.raw_arrays,
    curvesAvailable,
    primaryRtMnemonic,
  ])

  const [selectedRtMnemonics, setSelectedRtMnemonics] = useState<string[]>([
    primaryRtMnemonic,
  ])

  useEffect(() => {
    const saved = loadRtCurveSelection(layoutStorageKey)
    setSelectedRtMnemonics(
      mergeRtCurveSelection(availableRtMnemonics, primaryRtMnemonic, saved),
    )
  }, [layoutStorageKey, primaryRtMnemonic, availableRtMnemonics.join('|')])

  useEffect(() => {
    saveRtCurveSelection(layoutStorageKey, selectedRtMnemonics)
  }, [layoutStorageKey, selectedRtMnemonics])

  const resolvedTrackWidth = (id: string) => trackWidths[id] ?? defaultTrackWidth(id)

  const handleCurveColorChange = (key: LogCurveColorKey, color: string) => {
    setCurveColors((prev) => {
      const next = { ...prev, [key]: color }
      saveLogCurveColors(next)
      return next
    })
  }

  const handleCurveStyleChange = (key: LogCurveColorKey, style: LogCurveLineStyle) => {
    setCurveStyles((prev) => {
      const next = { ...prev, [key]: style }
      saveLogCurveStyles(next)
      return next
    })
  }

  useEffect(() => {
    if (!layoutStorageKey) {
      setDepthRulerWidth(80)
      setTrackWidths({})
      return
    }
    try {
      const raw = localStorage.getItem(logLayoutStorageKey(layoutStorageKey))
      if (!raw) return
      const p = JSON.parse(raw) as { ruler?: unknown; tracks?: unknown }
      if (typeof p.ruler === 'number') {
        setDepthRulerWidth(clampSize(Math.round(p.ruler), RULER_WIDTH_MIN, RULER_WIDTH_MAX))
      }
      if (p.tracks && typeof p.tracks === 'object' && !Array.isArray(p.tracks)) {
        const next: Record<string, number> = {}
        for (const [k, v] of Object.entries(p.tracks)) {
          if (typeof k === 'string' && typeof v === 'number' && Number.isFinite(v)) {
            next[k] = clampSize(Math.round(v), TRACK_WIDTH_MIN, TRACK_WIDTH_MAX)
          }
        }
        setTrackWidths(next)
      }
    } catch {
      /* ignore corrupt storage */
    }
  }, [layoutStorageKey])

  useEffect(() => {
    if (!layoutStorageKey) return
    const t = window.setTimeout(() => {
      try {
        localStorage.setItem(
          logLayoutStorageKey(layoutStorageKey),
          JSON.stringify({
            ruler: depthRulerWidth,
            tracks: trackWidths,
          }),
        )
      } catch {
        /* ignore quota / private mode */
      }
    }, 380)
    return () => window.clearTimeout(t)
  }, [layoutStorageKey, depthRulerWidth, trackWidths])

  const sync = useScrollSync(depthMin, depthMax, viewportHeight)
  const palette = useChartPalette()

  // Keep `viewportHeight` in sync with the scroller's clientHeight. Both the
  // virtualized canvases and the scroll/zoom math depend on an accurate value.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const update = () => setViewportHeight(el.clientHeight)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useImperativeHandle(
    ref,
    () => ({
      scrollToDepth: (ft: number) => {
        const el = containerRef.current
        if (!el) return
        const pxPerFt = PX_PER_FT * sync.zoomFactor
        const contentY = TRACK_HEADER_PX + (ft - depthMin) * pxPerFt
        const targetScroll = contentY - el.clientHeight / 2
        el.scrollTo({ top: Math.max(0, targetScroll), behavior: 'smooth' })
      },
      setZoom: sync.setZoom,
      zoomIn: () => sync.setZoom(sync.zoomFactor * 1.25),
      zoomOut: () => sync.setZoom(sync.zoomFactor / 1.25),
    }),
    [depthMin, sync.setZoom, sync.zoomFactor],
  )

  // Auto-scroll to the first HC zone on first load
  const didAutoScrollRef = useRef(false)
  useEffect(() => {
    if (didAutoScrollRef.current) return
    if (zones.length > 0) {
      didAutoScrollRef.current = true
      requestAnimationFrame(() => {
        const z = zones[0]
        const el = containerRef.current
        if (!el) return
        const mid = (z.top_ft + z.bot_ft) / 2
        const pxPerFt = PX_PER_FT * sync.zoomFactor
        const contentY = TRACK_HEADER_PX + (mid - depthMin) * pxPerFt
        el.scrollTo({ top: Math.max(0, contentY - el.clientHeight / 2), behavior: 'smooth' })
      })
    }
  }, [zones, depthMin, sync.zoomFactor])

  useEffect(() => () => hideReadingTooltip(), [])

  // ---- track configs ------------------------------------------------------
  const tracks = useMemo(() => {
    const c = (key: LogCurveColorKey) => resolveLogCurveColor(key, curveColors, palette)
    const ls = (key: LogCurveColorKey) => resolveLogCurveStyle(key, curveStyles)

    const grColor = c('gr')
    const vshColor = c('vsh')
    const spColor = c('sp')
    const rtColor = c('rt')
    const nphiColor = c('nphi')
    const dphiColor = c('dphi')
    const phieColor = c('phie')
    const shcColor = c('shc')
    const swColor = c('sw')
    const bvwColor = c('bvw')
    const pefColor = c('pef')

    const grValues = overview.GR as (number | null)[]
    const vshValues = overview.Vsh as (number | null)[]
    const nphiValues = overview.NPHI as (number | null)[]
    const dphiValues = overview.DPHI as (number | null)[]
    const phieValues = overview.phi_eff as (number | null)[]
    const rtValues = overview.RT as (number | null)[]
    const rtExtra = overview.rt_curves ?? {}
    const rawArrays = result.raw_arrays

    const rtValuesForMnemonic = (mnem: string): (number | null)[] | null => {
      if (mnem === primaryRtMnemonic) return rtValues
      const fromOv = rtExtra[mnem]
      if (fromOv?.length) return fromOv
      const rawDepth = rawArrays?.depth
      const rawVals = rawArrays?.[mnem]
      if (rawDepth?.length && rawVals?.length) {
        return (overview.depth as (number | null)[]).map((d) =>
          d == null ? null : nearestDepthSampleValue(rawDepth as number[], rawVals, d),
        )
      }
      return null
    }

    const shcValues = overview.Shc as (number | null)[]
    const swValues = overview.Sw as (number | null)[]
    const bvwValues = overview.BVW as (number | null)[]
    const pefValues = overview.PEF as (number | null)[]
    const spValues = (overview.SP as (number | null)[] | undefined) ?? null
    const lithValues = overview.lith_flag as number[]

    const meanRt = meanRtOhmm(rtValues, result.stats?.mean_RT)
    const meanGr = meanArithmetic(grValues, result.stats?.mean_GR)
    const meanPhie = meanArithmetic(phieValues, result.stats?.mean_phi_eff)

    const rtScaleSets: (number | null)[][] = []
    for (const mnem of selectedRtMnemonics) {
      const values = rtValuesForMnemonic(mnem)
      if (values) rtScaleSets.push(values)
    }
    const rtScale = autoLogRtScale(rtScaleSets)

    // Sand = low SP (left); shale = high SP (right). Use min/max so labels
    // always match track position even if stored stats were inverted.
    const spShaleRaw = result.stats?.sp_shale_baseline
    const spSandRaw = result.stats?.sp_sand_line
    const spSandLine =
      spShaleRaw != null && spSandRaw != null
        ? Math.min(spShaleRaw, spSandRaw)
        : spSandRaw ?? spShaleRaw
    const spBaseline =
      spShaleRaw != null && spSandRaw != null
        ? Math.max(spShaleRaw, spSandRaw)
        : spShaleRaw ?? spSandRaw
    const hasSp = !!spValues && spValues.some((v) => v != null && Number.isFinite(v))

    // Auto-scale SP track to the actual data so the curve always fills the
    // track, regardless of polarity / absolute level.
    let spMin = -160
    let spMax = 40
    if (hasSp && spValues) {
      const finiteSp = spValues.filter(
        (v) => v != null && Number.isFinite(v),
      ) as number[]
      if (finiteSp.length > 0) {
        const lo = Math.min(...finiteSp)
        const hi = Math.max(...finiteSp)
        const pad = Math.max(5, (hi - lo) * 0.05)
        spMin = Math.floor(lo - pad)
        spMax = Math.ceil(hi + pad)
        if (spMax - spMin < 1) spMax = spMin + 1
      }
    }

    const spTrack: TrackConfig | null = hasSp
      ? {
          id: 'sp',
          sidebarHint: 'SP curve',
          label: 'SP',
          unit: 'mV',
          scaleLabel: [String(spMin), String(spMax)] as [string, string],
          curves: [
            {
              depths: depths as number[],
              values: spValues as (number | null)[],
              color: spColor,
              colorKey: 'sp',
              lineStyle: ls('sp'),
              lineWidth: 1.2,
              xMin: spMin,
              xMax: spMax,
              label: 'SP',
            },
          ] as CurveConfig[],
          referenceLines: [
            spSandLine != null && {
              value: spSandLine,
              color: spColor,
              dashed: true,
              label: 'sand',
            },
            spBaseline != null && {
              value: spBaseline,
              color: 'rgba(74,102,128,0.6)',
              dashed: true,
              label: 'shale',
            },
          ].filter(Boolean) as ReferenceLineConfig[],
        }
      : null

    const base: TrackConfig[] = [
      // Track 1 — GR / Vsh
      {
        id: 'gr-vsh',
        sidebarHint: 'GR, shale volume',
        label: 'GR / Vsh',
        unit: 'GAPI / v/v',
        scaleLabel: ['0', '150'] as [string, string],
        curves: [
          {
            depths: depths as number[],
            values: vshValues,
            color: vshColor,
            colorKey: 'vsh',
            lineStyle: ls('vsh'),
            lineWidth: 1,
            xMin: 0,
            xMax: 1,
            fillLeft: true,
            fillColor: fillFromLineColor(vshColor, 0.35),
            label: 'Vsh',
          },
          {
            depths: depths as number[],
            values: grValues,
            color: grColor,
            colorKey: 'gr',
            lineStyle: ls('gr'),
            lineWidth: 1.2,
            xMin: 0,
            xMax: 150,
            fillLeft: true,
            fillColor: fillFromLineColor(grColor, 0.12),
            label: 'GR',
          },
        ] as CurveConfig[],
        referenceLines:
          meanGr != null
            ? [
                {
                  value: meanGr,
                  color: 'rgba(148, 163, 184, 0.9)',
                  lineStyle: 'dotted',
                  label: `avg ${meanGr.toFixed(1)}`,
                  curveLabel: 'GR',
                },
              ]
            : [],
      },
      // Track 2 — Resistivity (log); auto-scaled to plotted data range
      {
        id: 'rt',
        sidebarHint: 'Deep Rt, shallow Rxo, micro-resistivity',
        label: 'Resistivity',
        unit: 'Ω·m',
        scaleLabel: rtScale.scaleLabel,
        scaleTicks: rtScale.scaleTicks,
        logScaleHeader: true,
        curves: (() => {
          let overlayIx = 0
          return selectedRtMnemonics
            .map((mnem) => {
            const values = rtValuesForMnemonic(mnem)
            if (!values) return null
            const isPrimary = mnem === primaryRtMnemonic
            const color = isPrimary
              ? rtColor
              : RT_COMPARE_COLORS[overlayIx++ % RT_COMPARE_COLORS.length]
            return {
              depths: depths as number[],
              values,
              color,
              colorKey: isPrimary ? ('rt' as const) : undefined,
              renderMode: 'dots' as const,
              dotRadius: isPrimary ? 1.35 : 1.15,
              xMin: rtScale.xMin,
              xMax: rtScale.xMax,
              logScale: true,
              label:
                rtCurveRole(mnem) === 'other'
                  ? mnem
                  : `${mnem} · ${rtCurveRole(mnem)}`,
            }
          })
            .filter(Boolean) as CurveConfig[]
        })(),
        referenceLines:
          meanRt != null
            ? [
                {
                  value: meanRt,
                  color: 'rgba(148, 163, 184, 0.9)',
                  lineStyle: 'dotted',
                  label: `avg ${meanRt < 10 ? meanRt.toFixed(2) : meanRt.toFixed(1)}`,
                },
              ]
            : [],
      },
      // Track 3 — Neutron / density porosity (N–D crossover)
      {
        id: 'nphi-dphi',
        sidebarHint: 'Neutron vs density porosity, gas crossover',
        label: 'NPHI / DPHI',
        unit: 'v/v',
        scaleLabel: ['0.0', '0.6'] as [string, string],
        curves: [
          {
            depths: depths as number[],
            values: nphiValues,
            color: nphiColor,
            colorKey: 'nphi',
            lineStyle: ls('nphi'),
            lineWidth: 1.6,
            xMin: 0.0,
            xMax: 0.6,
            label: 'NPHI',
          },
          {
            depths: depths as number[],
            values: dphiValues,
            color: dphiColor,
            colorKey: 'dphi',
            lineStyle: ls('dphi'),
            lineWidth: 1.6,
            xMin: 0.0,
            xMax: 0.6,
            label: 'DPHI',
          },
          {
            depths: depths as number[],
            values: nphiValues.map((nv, i) => {
              const dv = dphiValues[i]
              if (nv == null || dv == null) return null
              if (!Number.isFinite(nv) || !Number.isFinite(dv)) return null
              return (dv as number) > (nv as number) ? (nv as number) : null
            }),
            color: 'transparent',
            lineWidth: 0,
            xMin: 0.0,
            xMax: 0.6,
            fillLeft: true,
            fillColor: 'rgba(255, 61, 90, 0.14)',
            label: '',
          },
        ] as CurveConfig[],
      },
      // Track 4 — Effective porosity (separate column)
      {
        id: 'phie',
        sidebarHint: 'Effective porosity (PHIE)',
        label: 'PHIE',
        unit: 'v/v',
        scaleLabel: ['0.0', '0.6'] as [string, string],
        curves: [
          {
            depths: depths as number[],
            values: phieValues,
            color: phieColor,
            colorKey: 'phie',
            lineStyle: ls('phie'),
            lineWidth: 1.6,
            xMin: 0.0,
            xMax: 0.6,
            fillLeft: true,
            fillColor: fillFromLineColor(phieColor, 0.12),
            label: 'PHIE',
          },
        ] as CurveConfig[],
        referenceLines:
          meanPhie != null
            ? [
                {
                  value: meanPhie,
                  color: 'rgba(148, 163, 184, 0.9)',
                  lineStyle: 'dotted',
                  label: `avg ${meanPhie.toFixed(3)}`,
                  curveLabel: 'PHIE',
                },
              ]
            : [],
      },
      // Track 5 — Saturation
      {
        id: 'sat',
        sidebarHint: 'Shc, Sw, BVW',
        label: 'Saturation',
        unit: 'v/v',
        scaleLabel: ['0', '1'] as [string, string],
        curves: [
          {
            depths: depths as number[],
            values: shcValues,
            color: shcColor,
            colorKey: 'shc',
            lineStyle: ls('shc'),
            lineWidth: 1.2,
            xMin: 0,
            xMax: 1,
            fillRight: true,
            fillColor: fillFromLineColor(shcColor, 0.18),
            label: 'Shc',
          },
          {
            depths: depths as number[],
            values: swValues,
            color: swColor,
            colorKey: 'sw',
            lineStyle: ls('sw'),
            lineWidth: 1.2,
            xMin: 0,
            xMax: 1,
            fillLeft: true,
            fillColor: fillFromLineColor(swColor, 0.18),
            label: 'Sw',
          },
          {
            depths: depths as number[],
            values: bvwValues,
            color: bvwColor,
            colorKey: 'bvw',
            lineStyle: ls('bvw'),
            lineWidth: 1.0,
            xMin: 0,
            xMax: 0.2,
            label: 'BVW',
          },
        ] as CurveConfig[],
        referenceLines: [
          {
            value: 0.5,
            color: 'rgba(232,244,255,0.4)',
            dashed: true,
            label: 'Sw=0.50',
          },
        ],
      },
      // Track 6 — PEF / Lithology
      {
        id: 'pef',
        sidebarHint: 'PEF + lithology',
        label: 'PEF',
        unit: 'b/e',
        scaleLabel: ['0', '8'] as [string, string],
        leftColorBar: {
          depths: depths as number[],
          values: lithValues,
          colors: lithColorsFromPalette(palette),
        },
        curves: [
          {
            depths: depths as number[],
            values: pefValues,
            color: pefColor,
            colorKey: 'pef',
            lineStyle: ls('pef'),
            lineWidth: 1.2,
            xMin: 0,
            xMax: 8,
            label: 'PEF',
          },
        ] as CurveConfig[],
        referenceLines: [
          { value: 1.81, color: palette.lithSandstone, label: 'SS', dashed: true },
          { value: 3.14, color: palette.lithDolomite, label: 'DOL', dashed: true },
          { value: 5.08, color: palette.lithLimestone, label: 'LS', dashed: true },
        ],
      },
    ]
    // Inject the SP track between GR/Vsh and Resistivity when present
    if (spTrack) {
      base.splice(1, 0, spTrack)
    }
    return base
  }, [
    overview,
    depths,
    result.stats,
    result.raw_arrays,
    palette,
    curveColors,
    curveStyles,
    primaryRtMnemonic,
    selectedRtMnemonics,
  ])

  const [trackVisible, setTrackVisible] = useState<Record<string, boolean>>({})

  useEffect(() => {
    setTrackVisible((prev) => {
      const next = { ...prev }
      let changed = false
      for (const t of tracks) {
        if (next[t.id] === undefined) {
          next[t.id] = true
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [tracks])

  const visibleTracks = useMemo(
    () => tracks.filter((t) => trackVisible[t.id] !== false),
    [tracks, trackVisible],
  )

  const visibleTrackIds = useMemo(
    () => visibleTracks.map((t) => t.id).join(','),
    [visibleTracks],
  )

  // Fit tracks to the log *column* width (outer host). Do not observe the scroll viewport:
  // horizontal scrollbars appearing during column drag change clientWidth and re-trigger a
  // full redistribute, which fights the drag and makes the RHS look "detached" / janky.
  useEffect(() => {
    const host = layoutHostRef.current
    if (!host) return
    if (!visibleTrackIds) return

    const ids = visibleTrackIds.split(',')
    let raf = 0

    const run = () => {
      const scrollEl = containerRef.current
      const viewportW = Math.floor(
        scrollEl && scrollEl.isConnected ? scrollEl.clientWidth : host.clientWidth,
      )
      if (!Number.isFinite(viewportW) || viewportW <= 0) return

      const n = ids.length
      const stripChrome = (1 + n) * RESIZE_STRIP_PX
      const chrome = depthRulerWidth + stripChrome
      const targetSum = viewportW - chrome
      if (targetSum <= 0) return

      setTrackWidths((prev) => {
        const next = redistributeVisibleTrackWidths(ids, prev, targetSum)
        return next ?? prev
      })
    }

    const schedule = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        run()
      })
    }

    const ro = new ResizeObserver(() => schedule())
    ro.observe(host)
    schedule()
    return () => {
      ro.disconnect()
      if (raf) cancelAnimationFrame(raf)
    }
  }, [visibleTrackIds, depthRulerWidth])

  const toggleTrackId = (id: string) => {
    setTrackVisible((prev) => ({
      ...prev,
      [id]: !(prev[id] ?? true),
    }))
  }

  const addRtMnemonic = (mnem: string) => {
    if (!mnem || selectedRtMnemonics.includes(mnem)) return
    setSelectedRtMnemonics((prev) => [...prev, mnem])
  }

  const removeRtMnemonic = (mnem: string) => {
    if (selectedRtMnemonics.length <= 1) return
    setSelectedRtMnemonics((prev) => prev.filter((m) => m !== mnem))
  }

  const rtAddOptions = availableRtMnemonics.filter(
    (m) => !selectedRtMnemonics.includes(m),
  )

  const zonesAsOverlays = useMemo(
    () =>
      zones.map((z) => ({
        id: z.id,
        zone_type: z.zone_type,
        top_ft: z.top_ft,
        bot_ft: z.bot_ft,
        selected: activeZoneId === z.id,
      })),
    [zones, activeZoneId],
  )

  const contentHeight = Math.max(
    600,
    (depthMax - depthMin) * PX_PER_FT * sync.zoomFactor + TRACK_HEADER_PX,
  )

  const pxPerFtZ = PX_PER_FT * sync.zoomFactor
  const lastClientRef = useRef<{ x: number; y: number } | null>(null)
  const DRAG_THRESHOLD_PX = 6
  const pointerDragRef = useRef({
    active: false,
    isDrag: false,
    anchorFt: null as number | null,
    startClientY: 0,
  })

  function depthAtContentY(contentY: number): number | null {
    if (contentY < TRACK_HEADER_PX || contentY > contentHeight) return null
    const raw = depthMin + (contentY - TRACK_HEADER_PX) / pxPerFtZ
    return clampDepth(raw, depthMin, depthMax)
  }

  function syncReadingAtClient(clientX: number, clientY: number) {
    const sc = containerRef.current
    if (!sc) return
    const r = sc.getBoundingClientRect()
    if (
      clientX < r.left ||
      clientX >= r.right ||
      clientY < r.top ||
      clientY >= r.bottom
    ) {
      setCrosshairContentY(null)
      hideReadingTooltip()
      return
    }
    const contentY = clientY - r.top + sc.scrollTop
    setCrosshairContentY(contentY)

    const tip = document.getElementById('tooltip')
    if (!tip) return

    let ftAtCursor: number | null = null
    if (contentY >= TRACK_HEADER_PX && contentY <= contentHeight) {
      const raw = depthMin + (contentY - TRACK_HEADER_PX) / pxPerFtZ
      ftAtCursor = clampDepth(raw, depthMin, depthMax)
    }

    if (ftAtCursor == null) {
      tip.classList.remove('visible')
      return
    }

    tip.innerHTML = readingTooltipHtml(ftAtCursor, visibleTracks, palette.textBright)
    tip.classList.add('visible')
    positionReadingTooltip(tip, clientX, clientY)
    requestAnimationFrame(() => positionReadingTooltip(tip, clientX, clientY))
  }

  function handleCrosshairMove(e: React.MouseEvent<HTMLDivElement>) {
    lastClientRef.current = { x: e.clientX, y: e.clientY }
    syncReadingAtClient(e.clientX, e.clientY)
  }

  function handleCrosshairLeave() {
    lastClientRef.current = null
    setCrosshairContentY(null)
    hideReadingTooltip()
  }

  function selectZoneAtDepth(ft: number) {
    if (!onZoneSelect || zones.length === 0) return
    const hit = zones.find((z) => ft >= z.top_ft && ft <= z.bot_ft)
    if (hit) onZoneSelect(hit.id)
  }

  function handleLogPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return
    const sc = containerRef.current
    if (!sc) return
    const r = sc.getBoundingClientRect()
    const contentY = e.clientY - r.top + sc.scrollTop
    const ft = depthAtContentY(contentY)
    if (ft == null) return

    pointerDragRef.current = {
      active: true,
      isDrag: false,
      anchorFt: ft,
      startClientY: e.clientY,
    }
    if (onDepthIntervalChange) {
      onDepthIntervalChange(null)
      e.preventDefault()
      sc.setPointerCapture(e.pointerId)
    }
  }

  function handleLogPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const drag = pointerDragRef.current
    if (!drag.active || drag.anchorFt == null || !onDepthIntervalChange) return
    if (Math.abs(e.clientY - drag.startClientY) < DRAG_THRESHOLD_PX) return

    const sc = containerRef.current
    if (!sc) return
    const r = sc.getBoundingClientRect()
    const contentY = e.clientY - r.top + sc.scrollTop
    const ft = depthAtContentY(contentY)
    if (ft == null) return

    drag.isDrag = true
    const a = drag.anchorFt
    onDepthIntervalChange({
      top_ft: Math.min(a, ft),
      bot_ft: Math.max(a, ft),
    })
  }

  function handleLogPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const drag = pointerDragRef.current
    if (!drag.active) return

    const sc = containerRef.current
    if (sc?.hasPointerCapture(e.pointerId)) {
      sc.releasePointerCapture(e.pointerId)
    }

    if (drag.isDrag && drag.anchorFt != null) {
      const r = sc?.getBoundingClientRect()
      if (sc && r) {
        const contentY = e.clientY - r.top + sc.scrollTop
        const ft = depthAtContentY(contentY)
        if (ft != null) {
          const lo = Math.min(drag.anchorFt, ft)
          const hi = Math.max(drag.anchorFt, ft)
          if (hi - lo >= 1) {
            onDepthIntervalChange?.({ top_ft: lo, bot_ft: hi })
          } else {
            onDepthIntervalChange?.(null)
          }
        }
      }
    } else if (drag.anchorFt != null) {
      onDepthIntervalChange?.(null)
      selectZoneAtDepth(drag.anchorFt)
    }

    pointerDragRef.current = {
      active: false,
      isDrag: false,
      anchorFt: null,
      startClientY: 0,
    }
  }

  const selectionBandY = useMemo(() => {
    if (!depthInterval) return null
    const lo = Math.min(depthInterval.top_ft, depthInterval.bot_ft)
    const hi = Math.max(depthInterval.top_ft, depthInterval.bot_ft)
    const top = TRACK_HEADER_PX + (lo - depthMin) * pxPerFtZ
    const bot = TRACK_HEADER_PX + (hi - depthMin) * pxPerFtZ
    return { top, height: Math.max(2, bot - top) }
  }, [depthInterval, depthMin, pxPerFtZ])

  function handleScrollerScroll() {
    sync.onScroll()
    const p = lastClientRef.current
    if (p) syncReadingAtClient(p.x, p.y)
  }

  return (
    <div ref={layoutHostRef} className="relative h-full flex flex-col min-h-0 min-w-0">
      <div className="flex min-h-10 shrink-0 items-center gap-x-4 border-b border-border surface-header-bar px-[clamp(0.5rem,4vw,1rem)]">
        <div className="flex min-w-0 shrink-0 items-center gap-x-4">
          <span className="shrink-0 font-mono text-[10px] uppercase tracking-widest text-text-dim">
            Zoom
          </span>
          <div className="panel flex shrink-0 items-center gap-0.5 px-1 py-0.5 text-text-dim">
            <button
              type="button"
              onClick={() => sync.setZoom(sync.zoomFactor / 1.25)}
              className="px-2 leading-none hover:text-accent"
              title="Zoom out (Ctrl+wheel)"
            >
              −
            </button>
            <span className="w-10 text-center px-1 font-mono text-[10px] text-text-bright tabular-nums">
              {sync.zoomFactor.toFixed(2)}×
            </span>
            <button
              type="button"
              onClick={() => sync.setZoom(sync.zoomFactor * 1.25)}
              className="px-2 leading-none hover:text-accent"
              title="Zoom in (Ctrl+wheel)"
            >
              +
            </button>
            <button
              type="button"
              onClick={() => sync.setZoom(1)}
              className="border-l border-border-muted px-2 font-mono text-[10px] hover:text-accent"
              title="Reset zoom"
            >
              1:1
            </button>
          </div>
        </div>

        <div className="flex min-h-[1.75rem] min-w-0 flex-1 items-center gap-3 overflow-x-auto [scrollbar-width:thin]">
          {tracks.map((t) => (
            <label
              key={t.id}
              className="flex shrink-0 cursor-pointer items-center gap-1.5 select-none whitespace-nowrap"
              title={[t.label, t.sidebarHint].filter(Boolean).join(' · ')}
            >
              <input
                type="checkbox"
                className="accent-accent"
                checked={trackVisible[t.id] !== false}
                onChange={() => toggleTrackId(t.id)}
              />
              <span className="font-mono text-[10px] text-text-bright">{t.label}</span>
            </label>
          ))}
          {visibleTracks.length === 0 && (
            <span className="shrink-0 font-mono text-[10px] text-oil whitespace-nowrap">
              No tracks selected
            </span>
          )}
          {trackVisible.rt !== false && availableRtMnemonics.length > 0 && (
            <div
              className="flex shrink-0 items-center gap-1.5 border-l border-border-muted pl-3"
              title="Compare multiple resistivity curves on the RT track"
            >
              <span className="font-mono text-[9px] uppercase tracking-wider text-text-dim">
                RT
              </span>
              {selectedRtMnemonics.map((mnem) => (
                <span
                  key={mnem}
                  className="inline-flex items-center gap-0.5 rounded border border-border-muted bg-bg-elevated px-1.5 py-0.5 font-mono text-[9px] text-text-bright"
                >
                  {mnem}
                  {selectedRtMnemonics.length > 1 && (
                    <button
                      type="button"
                      className="leading-none text-text-dim hover:text-oil"
                      title={`Remove ${mnem}`}
                      onClick={() => removeRtMnemonic(mnem)}
                    >
                      ×
                    </button>
                  )}
                </span>
              ))}
              {rtAddOptions.length > 0 && (
                <select
                  className="max-w-[5.5rem] cursor-pointer rounded border border-border-muted bg-bg-elevated px-1 py-0.5 font-mono text-[9px] text-text-bright"
                  value=""
                  title="Add resistivity curve"
                  onChange={(e) => {
                    const v = e.target.value
                    if (v) addRtMnemonic(v)
                    e.target.value = ''
                  }}
                >
                  <option value="">+ add</option>
                  {rtAddOptions.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}
        </div>
      </div>

      <div
        ref={(el) => {
          containerRef.current = el
          sync.scrollerRef.current = el
        }}
        onScroll={handleScrollerScroll}
        onMouseMove={handleCrosshairMove}
        onMouseLeave={handleCrosshairLeave}
        onPointerDown={handleLogPointerDown}
        onPointerMove={(e) => {
          handleLogPointerMove(e)
        }}
        onPointerUp={handleLogPointerUp}
        onPointerCancel={handleLogPointerUp}
        className="flex-1 min-h-0 overflow-y-auto overflow-x-auto [scrollbar-gutter:stable] select-none"
      >
        <div
          className="relative isolate flex shrink-0"
          style={{ minHeight: contentHeight, alignItems: 'flex-start' }}
        >
          {selectionBandY && (
            <div
              aria-hidden
              className="pointer-events-none absolute left-0 right-0 top-0 z-[14] border-x-2 border-accent/50"
              style={{ height: contentHeight }}
            >
              <div
                className="absolute left-0 right-0 bg-accent/20 ring-1 ring-accent/60"
                style={{ top: selectionBandY.top, height: selectionBandY.height }}
              />
            </div>
          )}
          {crosshairContentY != null &&
            crosshairContentY >= TRACK_HEADER_PX &&
            crosshairContentY <= contentHeight && (
              <div
                aria-hidden
                className="pointer-events-none absolute left-0 right-0 top-0 z-[15]"
                style={{ height: contentHeight }}
              >
                <div
                  className="absolute left-0 right-0 shadow-[0_0_14px_rgba(17,126,154,0.35)] bg-accent pointer-events-none"
                  style={{
                    height: '1px',
                    top: crosshairContentY,
                  }}
                />
              </div>
            )}
          <DepthRuler
            depthMin={depthMin}
            depthMax={depthMax}
            zoomFactor={sync.zoomFactor}
            width={depthRulerWidth}
            scrollTop={sync.scrollTop}
            viewportHeight={viewportHeight}
          />
          {visibleTracks.length > 0 && (
            <ResizeStrip
              ariaLabel="Resize depth ruler column width"
              width={depthRulerWidth}
              min={RULER_WIDTH_MIN}
              max={RULER_WIDTH_MAX}
              onCommitWidth={setDepthRulerWidth}
            />
          )}
          {visibleTracks.map((t) => (
            <Fragment key={t.id}>
              <TrackCanvas
                id={t.id}
                label={t.label}
                unit={t.unit}
                scaleLabel={t.scaleLabel}
                scaleTicks={t.scaleTicks}
                logScaleHeader={t.logScaleHeader}
                width={resolvedTrackWidth(t.id)}
                curves={t.curves}
                zones={zonesAsOverlays}
                intervalHighlight={depthInterval}
                depthMin={depthMin}
                depthMax={depthMax}
                zoomFactor={sync.zoomFactor}
                referenceLines={t.referenceLines}
                leftColorBar={t.leftColorBar}
                scrollTop={sync.scrollTop}
                viewportHeight={viewportHeight}
                onCurveColorChange={handleCurveColorChange}
                onCurveStyleChange={handleCurveStyleChange}
                curveLineStyles={curveStyles}
              />
              <ResizeStrip
                ariaLabel={`Resize ${t.label} track width`}
                width={resolvedTrackWidth(t.id)}
                min={TRACK_WIDTH_MIN}
                max={TRACK_WIDTH_MAX}
                onCommitWidth={(n) =>
                  setTrackWidths((prev) => ({
                    ...prev,
                    [t.id]: clampSize(n, TRACK_WIDTH_MIN, TRACK_WIDTH_MAX),
                  }))
                }
              />
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  )
})

export default LogViewer
