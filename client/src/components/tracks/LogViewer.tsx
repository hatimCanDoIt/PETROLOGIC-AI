import { useEffect, useImperativeHandle, useMemo, useRef, forwardRef } from 'react'

import { COLORS, LITH_COLORS, PX_PER_FT } from '@/utils/colors'
import type { HcZoneOut, ResultJson } from '@/types'

import DepthRuler from './DepthRuler'
import TrackCanvas, { type CurveConfig } from './TrackCanvas'
import { useScrollSync } from './useScrollSync'

interface LogViewerProps {
  result: ResultJson
  zones: HcZoneOut[]
}

export interface LogViewerHandle {
  scrollToDepth: (ft: number) => void
  setZoom: (z: number) => void
  zoomIn: () => void
  zoomOut: () => void
}

function cleanArray(arr?: (number | null)[]): number[] {
  if (!arr) return []
  return arr.map((v) => (v == null || !Number.isFinite(v) ? NaN : v))
}

const LogViewer = forwardRef<LogViewerHandle, LogViewerProps>(function LogViewer(
  { result, zones },
  ref,
) {
  const overview = result.overview
  const depths = cleanArray(overview.depth as unknown as number[])
  const validDepths = depths.filter((d) => Number.isFinite(d))
  const depthMin = validDepths.length ? Math.min(...validDepths) : 0
  const depthMax = validDepths.length ? Math.max(...validDepths) : 1

  const containerRef = useRef<HTMLDivElement | null>(null)
  const viewportHeight = containerRef.current?.clientHeight ?? 600

  const sync = useScrollSync(depthMin, depthMax, viewportHeight)

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

  // ---- track configs ------------------------------------------------------
  const tracks = useMemo(() => {
    const grValues = overview.GR as (number | null)[]
    const vshValues = overview.Vsh as (number | null)[]
    const nphiValues = overview.NPHI as (number | null)[]
    const dphiValues = overview.DPHI as (number | null)[]
    const rtValues = overview.RT as (number | null)[]
    const shcValues = overview.Shc as (number | null)[]
    const swValues = overview.Sw as (number | null)[]
    const bvwValues = overview.BVW as (number | null)[]
    const pefValues = overview.PEF as (number | null)[]
    const lithValues = overview.lith_flag as number[]

    const grClean = result.stats?.GR_clean ?? 30
    const grShale = result.stats?.GR_shale ?? 120

    return [
      // Track 1 — GR / Vsh
      {
        id: 'gr-vsh',
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
            fillColor: COLORS.vsh,
            label: 'Vsh',
          },
          {
            depths: depths as number[],
            values: grValues,
            color: COLORS.gr,
            lineWidth: 1.2,
            xMin: 0,
            xMax: 150,
            fillLeft: true,
            fillColor: COLORS.grFill,
            label: 'GR',
          },
        ] as CurveConfig[],
        referenceLines: [
          { value: grClean, color: COLORS.accent, label: `clean ${grClean.toFixed(0)}`, dashed: true },
          { value: grShale, color: COLORS.oil, label: `shale ${grShale.toFixed(0)}`, dashed: true },
        ],
      },
      // Track 2 — Resistivity (log)
      {
        id: 'rt',
        label: 'Resistivity',
        unit: 'Ω·m',
        scaleLabel: ['0.1', '1000'] as [string, string],
        scaleTicks: [0.1, 1, 10, 100, 1000],
        logScaleHeader: true,
        curves: [
          {
            depths: depths as number[],
            values: rtValues,
            color: COLORS.rt,
            lineWidth: 1.4,
            xMin: 0.1,
            xMax: 1000,
            logScale: true,
            fillRight: true,
            fillColor: COLORS.rtFill,
            label: 'RT',
          },
        ] as CurveConfig[],
      },
      // Track 3 — Neutron / Density porosity
      {
        id: 'nphi-dphi',
        label: 'NPHI / DPHI',
        unit: 'v/v',
        scaleLabel: ['0.6', '0.0'] as [string, string],
        curves: [
          {
            depths: depths as number[],
            values: nphiValues,
            color: COLORS.nphi,
            lineWidth: 1.2,
            xMin: 0.0,
            xMax: 0.6,
            reversed: true,
            label: 'NPHI',
          },
          {
            depths: depths as number[],
            values: dphiValues,
            color: COLORS.dphi,
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
        label: 'Saturation',
        unit: 'v/v',
        scaleLabel: ['0', '1'] as [string, string],
        curves: [
          {
            depths: depths as number[],
            values: shcValues,
            color: COLORS.shc,
            lineWidth: 1.2,
            xMin: 0,
            xMax: 1,
            fillRight: true,
            fillColor: COLORS.shcFill,
            label: 'Shc',
          },
          {
            depths: depths as number[],
            values: swValues,
            color: COLORS.sw,
            lineWidth: 1.2,
            xMin: 0,
            xMax: 1,
            fillLeft: true,
            fillColor: COLORS.swFill,
            label: 'Sw',
          },
          {
            depths: depths as number[],
            values: bvwValues,
            color: COLORS.bvw,
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
        label: 'PEF',
        unit: 'b/e',
        scaleLabel: ['0', '8'] as [string, string],
        leftColorBar: {
          depths: depths as number[],
          values: lithValues,
          colors: LITH_COLORS,
        },
        curves: [
          {
            depths: depths as number[],
            values: pefValues,
            color: COLORS.pef,
            lineWidth: 1.2,
            xMin: 0,
            xMax: 8,
            label: 'PEF',
          },
        ] as CurveConfig[],
        referenceLines: [
          { value: 1.81, color: COLORS.lithSandstone, label: 'SS', dashed: true },
          { value: 3.14, color: COLORS.lithDolomite, label: 'DOL', dashed: true },
          { value: 5.08, color: COLORS.lithLimestone, label: 'LS', dashed: true },
        ],
      },
    ]
  }, [overview, depths, result.stats])

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
    (depthMax - depthMin) * PX_PER_FT * sync.zoomFactor + 60,
  )

  return (
    <div className="relative h-full flex flex-col">
      {/* Zoom controls */}
      <div className="absolute top-2 right-3 z-20 flex gap-1 panel px-1.5 py-1 text-text-dim text-xs">
        <button
          onClick={() => sync.setZoom(sync.zoomFactor / 1.25)}
          className="px-2 hover:text-accent"
          title="Zoom out (Ctrl+wheel)"
        >
          −
        </button>
        <span className="font-mono px-1 text-[10px]">
          {sync.zoomFactor.toFixed(2)}×
        </span>
        <button
          onClick={() => sync.setZoom(sync.zoomFactor * 1.25)}
          className="px-2 hover:text-accent"
          title="Zoom in (Ctrl+wheel)"
        >
          +
        </button>
        <button
          onClick={() => sync.setZoom(1)}
          className="px-2 font-mono text-[10px] hover:text-accent"
          title="Reset zoom"
        >
          1:1
        </button>
      </div>

      <div
        ref={(el) => {
          containerRef.current = el
          sync.scrollerRef.current = el
        }}
        onScroll={sync.onScroll}
        className="flex-1 overflow-y-auto overflow-x-auto"
      >
        <div
          className="flex"
          style={{ minHeight: contentHeight, alignItems: 'flex-start' }}
        >
          <DepthRuler
            depthMin={depthMin}
            depthMax={depthMax}
            zoomFactor={sync.zoomFactor}
          />
          {tracks.map((t) => (
            <TrackCanvas
              key={t.id}
              id={t.id}
              label={t.label}
              unit={t.unit}
              scaleLabel={t.scaleLabel}
              scaleTicks={t.scaleTicks}
              logScaleHeader={t.logScaleHeader}
              width={t.id === 'pef' ? 180 : 170}
              curves={t.curves}
              zones={zonesAsOverlays}
              depthMin={depthMin}
              depthMax={depthMax}
              zoomFactor={sync.zoomFactor}
              referenceLines={t.referenceLines}
              leftColorBar={t.leftColorBar}
            />
          ))}
        </div>
      </div>
    </div>
  )
})

export default LogViewer
