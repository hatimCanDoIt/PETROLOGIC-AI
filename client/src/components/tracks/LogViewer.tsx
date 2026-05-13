import {
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  forwardRef,
  Fragment,
} from 'react'

import { PX_PER_FT } from '@/utils/colors'
import { lithColorsFromPalette } from '@/theme/chartPalette'
import { useChartPalette } from '@/theme/ThemeProvider'
import type { HcZoneOut, ResultJson } from '@/types'

import DepthRuler from './DepthRuler'
import TrackCanvas, {
  HEADER_HEIGHT as TRACK_HEADER_PX,
  type CurveConfig,
} from './TrackCanvas'
import { useScrollSync } from './useScrollSync'
import { formatSampleAtDepth, nearestDepthSampleValue } from '@/utils/curveDepthNearest'

interface LogViewerProps {
  result: ResultJson
  zones: HcZoneOut[]
  /** When set, ruler + track widths persist in localStorage for this key (e.g. well id). */
  layoutStorageKey?: string
}

interface ReferenceLineConfig {
  value: number
  color: string
  label?: string
  dashed?: boolean
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

const TRACK_WIDTH_MIN = 100
const TRACK_WIDTH_MAX = 520
const RULER_WIDTH_MIN = 52
const RULER_WIDTH_MAX = 160

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
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    e.preventDefault()
    const startX = e.clientX
    const startW = width

    const move = (ev: PointerEvent) => {
      onCommitWidth(clampSize(startW + (ev.clientX - startX), min, max))
    }
    const up = () => {
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
        width: 11,
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
  { result, zones, layoutStorageKey },
  ref,
) {
  const overview = result.overview
  const depths = cleanArray(overview.depth as unknown as number[])
  const validDepths = depths.filter((d) => Number.isFinite(d))
  const depthMin = validDepths.length ? Math.min(...validDepths) : 0
  const depthMax = validDepths.length ? Math.max(...validDepths) : 1

  const containerRef = useRef<HTMLDivElement | null>(null)
  const [viewportHeight, setViewportHeight] = useState(600)
  const [crosshairContentY, setCrosshairContentY] = useState<number | null>(null)
  const [depthRulerWidth, setDepthRulerWidth] = useState(80)
  const [trackWidths, setTrackWidths] = useState<Record<string, number>>({})

  const resolvedTrackWidth = (id: string) => trackWidths[id] ?? defaultTrackWidth(id)

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
      scrollToDepth: sync.scrollToDepth,
      setZoom: sync.setZoom,
      zoomIn: () => sync.setZoom(sync.zoomFactor * 1.25),
      zoomOut: () => sync.setZoom(sync.zoomFactor / 1.25),
    }),
    [sync],
  )

  // Auto-scroll to the first HC zone on first load
  const didAutoScrollRef = useRef(false)
  useEffect(() => {
    if (didAutoScrollRef.current) return
    if (zones.length > 0) {
      didAutoScrollRef.current = true
      // run after the canvas has laid out
      requestAnimationFrame(() => {
        sync.scrollToDepth(zones[0].top_ft)
      })
    }
  }, [zones, sync])

  useEffect(() => () => hideReadingTooltip(), [])

  // ---- track configs ------------------------------------------------------
  const tracks = useMemo(() => {
    const grValues = overview.GR as (number | null)[]
    const vshValues = overview.Vsh as (number | null)[]
    const nphiValues = overview.NPHI as (number | null)[]
    const dphiValues = overview.DPHI as (number | null)[]
    const phieValues = overview.phi_eff as (number | null)[]
    const rtValues = overview.RT as (number | null)[]
    const shcValues = overview.Shc as (number | null)[]
    const swValues = overview.Sw as (number | null)[]
    const bvwValues = overview.BVW as (number | null)[]
    const pefValues = overview.PEF as (number | null)[]
    const spValues = (overview.SP as (number | null)[] | undefined) ?? null
    const lithValues = overview.lith_flag as number[]

    const grClean = result.stats?.GR_clean ?? 30
    const grShale = result.stats?.GR_shale ?? 120
    const spBaseline = result.stats?.sp_shale_baseline
    const spSandLine = result.stats?.sp_sand_line
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
              color: palette.sp,
              lineWidth: 1.2,
              xMin: spMin,
              xMax: spMax,
              label: 'SP',
            },
          ] as CurveConfig[],
          referenceLines: [
            spBaseline != null && {
              value: spBaseline,
              color: 'rgba(74,102,128,0.6)',
              dashed: true,
              label: 'shale',
            },
            spSandLine != null && {
              value: spSandLine,
              color: palette.sp,
              dashed: true,
              label: 'sand',
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
            color: 'rgba(74,102,128,0.55)',
            lineWidth: 1,
            xMin: 0,
            xMax: 1,
            fillRight: true,
            fillColor: palette.vsh,
            label: 'Vsh',
          },
          {
            depths: depths as number[],
            values: grValues,
            color: palette.gr,
            lineWidth: 1.2,
            xMin: 0,
            xMax: 150,
            fillLeft: true,
            fillColor: palette.grFill,
            label: 'GR',
          },
        ] as CurveConfig[],
        referenceLines: [
          { value: grClean, color: palette.accent, label: `clean ${grClean.toFixed(0)}`, dashed: true },
          { value: grShale, color: palette.oil, label: `shale ${grShale.toFixed(0)}`, dashed: true },
        ],
      },
      // Track 2 — Resistivity (log)
      {
        id: 'rt',
        sidebarHint: 'Deep resistivity',
        label: 'Resistivity',
        unit: 'Ω·m',
        scaleLabel: ['0.1', '1000'] as [string, string],
        scaleTicks: [0.1, 1, 10, 100, 1000],
        logScaleHeader: true,
        curves: [
          {
            depths: depths as number[],
            values: rtValues,
            color: palette.rt,
            lineWidth: 1.4,
            xMin: 0.1,
            xMax: 1000,
            logScale: true,
            fillRight: true,
            fillColor: palette.rtFill,
            label: 'RT',
          },
        ] as CurveConfig[],
      },
      // Track 3 — Neutron / Density porosity + effective porosity
      {
        id: 'nphi-dphi',
        sidebarHint: 'Neutron, density, effective φ',
        label: 'NPHI / DPHI / PHIE',
        unit: 'v/v',
        scaleLabel: ['0.6', '0.0'] as [string, string],
        curves: [
          // PHIE drawn first so its cyan fill sits *under* the NPHI/DPHI lines.
          {
            depths: depths as number[],
            values: phieValues,
            color: palette.phie,
            lineWidth: 1.4,
            xMin: 0.0,
            xMax: 0.6,
            reversed: true,
            fillLeft: false,
            fillRight: true,
            fillColor: palette.phieFill,
            label: 'PHIE',
          },
          {
            depths: depths as number[],
            values: nphiValues,
            color: palette.nphi,
            lineWidth: 1.2,
            xMin: 0.0,
            xMax: 0.6,
            reversed: true,
            label: 'NPHI',
          },
          {
            depths: depths as number[],
            values: dphiValues,
            color: palette.dphi,
            lineWidth: 1.2,
            xMin: 0.0,
            xMax: 0.6,
            reversed: true,
            dashed: true,
            label: 'DPHI',
          },
          // Crossover shading: a synthetic curve that is min(NPHI, DPHI) only where
          // DPHI > NPHI; otherwise NaN. We use the gas-red fill to colour the gap.
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
            reversed: true,
            fillLeft: false,
            fillRight: false,
            label: '',
          },
        ] as CurveConfig[],
      },
      // Track 4 — Saturation
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
            color: palette.shc,
            lineWidth: 1.2,
            xMin: 0,
            xMax: 1,
            fillRight: true,
            fillColor: palette.shcFill,
            label: 'Shc',
          },
          {
            depths: depths as number[],
            values: swValues,
            color: palette.sw,
            lineWidth: 1.2,
            xMin: 0,
            xMax: 1,
            fillLeft: true,
            fillColor: palette.swFill,
            label: 'Sw',
          },
          {
            depths: depths as number[],
            values: bvwValues,
            color: palette.bvw,
            lineWidth: 1.0,
            xMin: 0,
            xMax: 0.2,
            dashed: true,
            label: 'BVW',
          },
        ] as CurveConfig[],
        referenceLines: [
          {
            value: 0.6,
            color: 'rgba(232,244,255,0.4)',
            dashed: true,
            label: 'Sw=0.60',
          },
        ],
      },
      // Track 5 — PEF / Lithology
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
            color: palette.pef,
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
  }, [overview, depths, result.stats, palette])

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

  const toggleTrackId = (id: string) => {
    setTrackVisible((prev) => ({
      ...prev,
      [id]: !(prev[id] ?? true),
    }))
  }

  const zonesAsOverlays = useMemo(
    () =>
      zones.map((z) => ({
        zone_type: z.zone_type,
        top_ft: z.top_ft,
        bot_ft: z.bot_ft,
      })),
    [zones],
  )

  const contentHeight = Math.max(
    600,
    (depthMax - depthMin) * PX_PER_FT * sync.zoomFactor + TRACK_HEADER_PX,
  )

  const pxPerFtZ = PX_PER_FT * sync.zoomFactor
  const lastClientRef = useRef<{ x: number; y: number } | null>(null)

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
    tip.style.left = `${clientX + 14}px`
    tip.style.top = `${clientY + 14}px`
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

  function handleScrollerScroll() {
    sync.onScroll()
    const p = lastClientRef.current
    if (p) syncReadingAtClient(p.x, p.y)
  }

  return (
    <div className="relative h-full flex flex-col min-h-0 min-w-0">
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
        className="flex-1 min-h-0 overflow-y-auto overflow-x-auto"
      >
        <div
          className="relative isolate flex shrink-0"
          style={{ minHeight: contentHeight, alignItems: 'flex-start' }}
        >
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
                depthMin={depthMin}
                depthMax={depthMax}
                zoomFactor={sync.zoomFactor}
                referenceLines={t.referenceLines}
                leftColorBar={t.leftColorBar}
                scrollTop={sync.scrollTop}
                viewportHeight={viewportHeight}
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
