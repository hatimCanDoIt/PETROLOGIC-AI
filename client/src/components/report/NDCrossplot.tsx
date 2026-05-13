import { useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent } from 'react'
import {
  CartesianGrid,
  Cell,
  Label,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts'

import { useChartPalette } from '@/theme/ThemeProvider'
import type { HcZoneOut, ResultJson } from '@/types'

interface NDCrossplotProps {
  result: ResultJson
  zones: HcZoneOut[]
  /** Persist chart height in localStorage per well */
  wellId?: string
}

interface Point {
  x: number
  y: number
  gr: number
  depth: number
  kind: 'bg' | 'oil' | 'gas'
}

const ND_XP_H_LS = 'petrologic:ndCrossplotH:'
const DEFAULT_CHART_PANEL_H = 520
const MIN_CHART_PANEL_H = 300
const MAX_CHART_PANEL_H = 920

function clampPanelH(n: number) {
  return Math.min(MAX_CHART_PANEL_H, Math.max(MIN_CHART_PANEL_H, Math.round(n)))
}

function readStoredChartHeight(wellId?: string): number {
  if (!wellId) return DEFAULT_CHART_PANEL_H
  try {
    const n = Number(localStorage.getItem(ND_XP_H_LS + wellId))
    if (Number.isFinite(n)) return clampPanelH(n)
  } catch {
    /* ignore */
  }
  return DEFAULT_CHART_PANEL_H
}

/** Drag down to grow height of the panel above this strip */
function HorizontalResizeStrip({
  ariaLabel,
  height,
  onCommitHeight,
}: {
  ariaLabel: string
  height: number
  onCommitHeight: (n: number) => void
}) {
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    e.preventDefault()
    const startY = e.clientY
    const startH = height

    const move = (ev: PointerEvent) => {
      onCommitHeight(clampPanelH(startH + (ev.clientY - startY)))
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
      aria-orientation="horizontal"
      aria-label={ariaLabel}
      onPointerDown={onPointerDown}
      className="mt-1 shrink-0 cursor-row-resize select-none rounded-b-md bg-border/70 py-1.5 hover:bg-accent/40 active:bg-accent touch-none outline-none focus-visible:ring-2 focus-visible:ring-accent"
      style={{ touchAction: 'none' }}
      tabIndex={0}
      onKeyDown={(ev) => {
        const step = ev.shiftKey ? 16 : 6
        if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
          ev.preventDefault()
          const dir = ev.key === 'ArrowDown' ? 1 : -1
          onCommitHeight(clampPanelH(height + dir * step))
        }
      }}
    />
  )
}

export default function NDCrossplot({ result, zones, wellId }: NDCrossplotProps) {
  const palette = useChartPalette()
  const [panelHeight, setPanelHeight] = useState(DEFAULT_CHART_PANEL_H)

  useEffect(() => {
    setPanelHeight(readStoredChartHeight(wellId))
  }, [wellId])

  useEffect(() => {
    if (!wellId) return
    const t = window.setTimeout(() => {
      try {
        localStorage.setItem(ND_XP_H_LS + wellId, String(panelHeight))
      } catch {
        /* ignore */
      }
    }, 350)
    return () => window.clearTimeout(t)
  }, [wellId, panelHeight])

  const data = useMemo<Point[]>(() => {
    const out: Point[] = []
    const nphi = result.overview.NPHI
    const dphi = result.overview.DPHI
    const gr = result.overview.GR
    const depth = result.overview.depth

    const n = Math.min(nphi.length, dphi.length, gr.length, depth.length)
    for (let i = 0; i < n; i++) {
      const x = nphi[i]
      const y = dphi[i]
      const g = gr[i]
      const d = depth[i]
      if (x == null || y == null || g == null || d == null) continue
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(g)) continue
      out.push({
        x: (x as number) * 100,
        y: (y as number) * 100,
        gr: g as number,
        depth: d as number,
        kind: 'bg',
      })
    }
    return out
  }, [result])

  // Group background points by GR bucket
  const cleanPts = data.filter((p) => p.gr < 50)
  const midPts = data.filter((p) => p.gr >= 50 && p.gr <= 80)
  const shalePts = data.filter((p) => p.gr > 80)

  // Highlight points for HC zones — depth mid-point of each zone
  const hcPoints = useMemo(() => {
    const out: Point[] = []
    for (const z of zones) {
      const mid = (z.top_ft + z.bot_ft) / 2
      // Find nearest depth in overview
      const depths = result.overview.depth as (number | null)[]
      let bestIdx = -1
      let bestDist = Infinity
      for (let i = 0; i < depths.length; i++) {
        const d = depths[i]
        if (d == null || !Number.isFinite(d)) continue
        const dist = Math.abs((d as number) - mid)
        if (dist < bestDist) {
          bestDist = dist
          bestIdx = i
        }
      }
      if (bestIdx === -1) continue
      const x = result.overview.NPHI[bestIdx]
      const y = result.overview.DPHI[bestIdx]
      const g = result.overview.GR[bestIdx]
      if (x == null || y == null) continue
      out.push({
        x: (x as number) * 100,
        y: (y as number) * 100,
        gr: g != null ? (g as number) : 0,
        depth: mid,
        kind: z.zone_type === 'OIL' ? 'oil' : 'gas',
      })
    }
    return out
  }, [zones, result.overview])

  return (
    <div
      className="w-full panel flex flex-col overflow-hidden p-0 min-w-0"
      style={{ height: panelHeight }}
    >
      <div className="flex shrink-0 items-baseline justify-between px-4 pt-4 pb-2">
        <h3 className="font-display text-sm uppercase tracking-widest text-text-bright">
          Neutron-Density Crossplot
        </h3>
        <span className="font-mono text-[10px] text-text-dim">{data.length} samples</span>
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col px-4" style={{ minHeight: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 10, right: 20, left: 0, bottom: 20 }}>
          <CartesianGrid stroke={palette.border} strokeDasharray="2 4" />
          <XAxis
            type="number"
            dataKey="x"
            domain={[0, 60]}
            tick={{ fill: palette.textDim, fontSize: 11, fontFamily: 'IBM Plex Mono' }}
            stroke={palette.border}
          >
            <Label value="NPHI (%)" position="insideBottom" offset={-10} fill={palette.textDim} />
          </XAxis>
          <YAxis
            type="number"
            dataKey="y"
            domain={[-10, 50]}
            tick={{ fill: palette.textDim, fontSize: 11, fontFamily: 'IBM Plex Mono' }}
            stroke={palette.border}
          >
            <Label value="DPHI (%)" angle={-90} position="insideLeft" fill={palette.textDim} />
          </YAxis>
          <ZAxis range={[20, 60]} />
          <Tooltip
            cursor={{ stroke: palette.accent, strokeDasharray: '3 3' }}
            contentStyle={{
              background: palette.bgPanel,
              border: `1px solid ${palette.border}`,
              fontFamily: 'IBM Plex Sans',
              fontSize: 11,
              color: palette.text,
            }}
            formatter={(value: number, name: string, props: { payload?: Point }) => {
              if (props?.payload) {
                return [
                  `${value.toFixed(2)}`,
                  name === 'x'
                    ? 'NPHI%'
                    : name === 'y'
                    ? 'DPHI%'
                    : name,
                ]
              }
              return [value, name]
            }}
            labelFormatter={(_, payload) => {
              const p = payload?.[0]?.payload as Point | undefined
              return p ? `Depth ${p.depth.toFixed(0)} ft · GR ${p.gr.toFixed(0)}` : ''
            }}
          />
          <Legend
            wrapperStyle={{
              fontFamily: 'IBM Plex Mono',
              fontSize: 11,
              color: palette.textDim,
            }}
          />

          {/* 1:1 diagonal */}
          <ReferenceLine
            segment={[
              { x: 0, y: 0 },
              { x: 60, y: 60 },
            ]}
            stroke={palette.borderLight}
            strokeDasharray="3 3"
            label={{
              value: 'Limestone (1:1)',
              fill: palette.lithLimestone,
              fontSize: 10,
              position: 'insideTopRight',
            }}
          />
          {/* Sandstone line: shifted up ~6 */}
          <ReferenceLine
            segment={[
              { x: 0, y: 6 },
              { x: 60, y: 38 },
            ]}
            stroke={palette.lithSandstone}
            strokeDasharray="2 4"
          />
          {/* Dolomite line: shifted down ~5 */}
          <ReferenceLine
            segment={[
              { x: 0, y: -5 },
              { x: 60, y: 25 },
            ]}
            stroke={palette.lithDolomite}
            strokeDasharray="2 4"
          />

          <Scatter name="Clean (GR<50)" data={cleanPts} fill={palette.reservoir} fillOpacity={0.45} />
          <Scatter name="Mid (50-80)" data={midPts} fill={palette.accent} fillOpacity={0.3} />
          <Scatter name="Shale (GR>80)" data={shalePts} fill={palette.vsh} fillOpacity={0.18} />
          <Scatter name="Oil zones" data={hcPoints.filter((p) => p.kind === 'oil')} fill={palette.oil}>
            {hcPoints
              .filter((p) => p.kind === 'oil')
              .map((_, i) => (
                <Cell key={`oil-${i}`} r={8} />
              ))}
          </Scatter>
          <Scatter name="Gas zones" data={hcPoints.filter((p) => p.kind === 'gas')} fill={palette.gas}>
            {hcPoints
              .filter((p) => p.kind === 'gas')
              .map((_, i) => (
                <Cell key={`gas-${i}`} r={8} />
              ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
      </div>

      <p className="shrink-0 px-4 pt-3 pb-1 font-mono text-[10px] text-text-dim leading-snug">
        ← Gas effect (low NPHI, high DPHI) drives points toward upper-left · Heavy shales fall
        lower-right
      </p>

      <HorizontalResizeStrip
        ariaLabel="Resize crossplot height — drag vertically"
        height={panelHeight}
        onCommitHeight={setPanelHeight}
      />
    </div>
  )
}
