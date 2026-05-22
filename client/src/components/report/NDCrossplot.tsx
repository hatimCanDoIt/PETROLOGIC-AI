import clsx from 'clsx'
import { useEffect, useMemo, useState } from 'react'
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
  wellId?: string
  activeZoneId?: string | null
  onViewZoneInLogs?: (zoneId: string) => void
  onZoneFocus?: (zoneId: string) => void
}

interface Point {
  x: number
  y: number
  gr: number
  depth: number
  kind: 'bg' | 'oil' | 'gas'
}

const ND_XP_DEPTH_LS = 'petrologic:ndCrossplotDepth:'
const ND_XP_CHART_H_LS = 'petrologic:ndCrossplotChartH:'
const DEFAULT_CHART_HEIGHT = 560
const MIN_CHART_HEIGHT = 400
const MAX_CHART_HEIGHT = 900

function clampChartH(n: number) {
  return Math.min(MAX_CHART_HEIGHT, Math.max(MIN_CHART_HEIGHT, Math.round(n)))
}

function readStoredChartHeight(wellId?: string): number {
  if (!wellId) return DEFAULT_CHART_HEIGHT
  try {
    const n = Number(localStorage.getItem(ND_XP_CHART_H_LS + wellId))
    if (Number.isFinite(n)) return clampChartH(n)
  } catch {
    /* ignore */
  }
  return DEFAULT_CHART_HEIGHT
}

function clampDepth(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n))
}

function readStoredDepthWindow(
  wellId: string | undefined,
  depthMin: number,
  depthMax: number,
): { top: number; bot: number } | null {
  if (!wellId) return null
  try {
    const raw = localStorage.getItem(ND_XP_DEPTH_LS + wellId)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { top?: number; bot?: number }
    const top = Number(parsed.top)
    const bot = Number(parsed.bot)
    if (!Number.isFinite(top) || !Number.isFinite(bot) || bot <= top) return null
    return {
      top: clampDepth(top, depthMin, depthMax),
      bot: clampDepth(bot, depthMin, depthMax),
    }
  } catch {
    return null
  }
}

function zoneById(zones: HcZoneOut[], id: string | null | undefined) {
  if (!id) return null
  return zones.find((z) => z.id === id) ?? null
}

function zoneAtDepth(zones: HcZoneOut[], depth: number): HcZoneOut | null {
  return zones.find((z) => depth >= z.top_ft && depth <= z.bot_ft) ?? null
}

export default function NDCrossplot({
  result,
  zones,
  wellId,
  activeZoneId,
  onViewZoneInLogs,
  onZoneFocus,
}: NDCrossplotProps) {
  const palette = useChartPalette()
  const [chartHeight, setChartHeight] = useState(DEFAULT_CHART_HEIGHT)

  useEffect(() => {
    setChartHeight(readStoredChartHeight(wellId))
  }, [wellId])

  useEffect(() => {
    if (!wellId) return
    const t = window.setTimeout(() => {
      try {
        localStorage.setItem(ND_XP_CHART_H_LS + wellId, String(chartHeight))
      } catch {
        /* ignore */
      }
    }, 350)
    return () => window.clearTimeout(t)
  }, [wellId, chartHeight])

  const depthBounds = useMemo(() => {
    const depth = result.overview.depth
    const finite = depth.filter((d): d is number => d != null && Number.isFinite(d))
    if (!finite.length) return { min: 0, max: 1 }
    return { min: Math.min(...finite), max: Math.max(...finite) }
  }, [result.overview.depth])

  const [depthTop, setDepthTop] = useState(depthBounds.min)
  const [depthBot, setDepthBot] = useState(depthBounds.max)
  const [topDraft, setTopDraft] = useState('')
  const [botDraft, setBotDraft] = useState('')

  const applyDepthWindow = (top: number, bot: number, persist = true) => {
    const lo = depthBounds.min
    const hi = depthBounds.max
    const t = clampDepth(Math.min(top, bot), lo, hi)
    const b = clampDepth(Math.max(top, bot), lo, hi)
    setDepthTop(t)
    setDepthBot(b)
    setTopDraft(t.toFixed(1))
    setBotDraft(b.toFixed(1))
    if (persist && wellId) {
      try {
        localStorage.setItem(ND_XP_DEPTH_LS + wellId, JSON.stringify({ top: t, bot: b }))
      } catch {
        /* ignore */
      }
    }
  }

  useEffect(() => {
    const stored = readStoredDepthWindow(wellId, depthBounds.min, depthBounds.max)
    if (stored) {
      applyDepthWindow(stored.top, stored.bot, false)
      return
    }
    const active = zoneById(zones, activeZoneId)
    if (active) {
      applyDepthWindow(active.top_ft, active.bot_ft, false)
      return
    }
    if (zones.length > 0) {
      applyDepthWindow(zones[0].top_ft, zones[0].bot_ft, false)
      return
    }
    applyDepthWindow(depthBounds.min, depthBounds.max, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- init per well
  }, [wellId, depthBounds.min, depthBounds.max])

  useEffect(() => {
    const active = zoneById(zones, activeZoneId)
    if (active) applyDepthWindow(active.top_ft, active.bot_ft)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- snap on external zone pick
  }, [activeZoneId])

  const allPoints = useMemo<Point[]>(() => {
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
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(g) || !Number.isFinite(d))
        continue
      const hit = zoneAtDepth(zones, d as number)
      out.push({
        x: (x as number) * 100,
        y: (y as number) * 100,
        gr: g as number,
        depth: d as number,
        kind: hit ? (hit.zone_type === 'OIL' ? 'oil' : 'gas') : 'bg',
      })
    }
    return out
  }, [result, zones])

  const windowPoints = useMemo(
    () => allPoints.filter((p) => p.depth >= depthTop && p.depth <= depthBot),
    [allPoints, depthTop, depthBot],
  )

  const cleanPts = windowPoints.filter((p) => p.kind === 'bg' && p.gr < 50)
  const midPts = windowPoints.filter((p) => p.kind === 'bg' && p.gr >= 50 && p.gr <= 80)
  const shalePts = windowPoints.filter((p) => p.kind === 'bg' && p.gr > 80)
  const oilPts = windowPoints.filter((p) => p.kind === 'oil')
  const gasPts = windowPoints.filter((p) => p.kind === 'gas')

  const commitDraftInputs = () => {
    const t = Number(topDraft)
    const b = Number(botDraft)
    if (!Number.isFinite(t) || !Number.isFinite(b)) return
    applyDepthWindow(t, b)
  }

  const activeZone = zoneById(zones, activeZoneId)

  return (
    <div className="flex w-full min-w-0 flex-col gap-4 pb-10">
      {/* Controls — scrolls away with the page (single scrollbar on workspace) */}
      <div className="panel shrink-0 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-sm uppercase tracking-widest text-text-bright">
              Neutron–Density crossplot
            </h2>
            <p className="mt-1 font-mono text-[10px] text-text-dim leading-snug max-w-xl">
              Filter to a pay depth window — gas crossover pulls points upper-left. More plot types
              (Pickett, Buckles, Rt–Rxo) coming here.
            </p>
          </div>
          <span className="font-mono text-[10px] text-text-dim tabular-nums">
            {windowPoints.length} / {allPoints.length} samples
          </span>
        </div>

        <div className="mt-4 space-y-3">
          <p className="font-mono text-[9px] uppercase tracking-widest text-text-dim">
            Depth window (ft)
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 font-mono text-[10px] text-text-dim">
              Top
              <input
                type="number"
                step={0.5}
                value={topDraft}
                onChange={(e) => setTopDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && commitDraftInputs()}
                onBlur={commitDraftInputs}
                className="w-[5.5rem] rounded border border-border-muted bg-bg-deep px-2 py-1 text-[11px] text-text-bright tabular-nums"
              />
            </label>
            <span className="text-text-dim">–</span>
            <label className="flex items-center gap-1.5 font-mono text-[10px] text-text-dim">
              Bottom
              <input
                type="number"
                step={0.5}
                value={botDraft}
                onChange={(e) => setBotDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && commitDraftInputs()}
                onBlur={commitDraftInputs}
                className="w-[5.5rem] rounded border border-border-muted bg-bg-deep px-2 py-1 text-[11px] text-text-bright tabular-nums"
              />
            </label>
            <button
              type="button"
              onClick={commitDraftInputs}
              className="rounded border border-border-muted px-2 py-1 font-mono text-[10px] text-text-bright hover:border-accent/50 hover:text-accent"
            >
              Apply
            </button>
            <button
              type="button"
              onClick={() => applyDepthWindow(depthBounds.min, depthBounds.max)}
              className="rounded border border-border-muted px-2 py-1 font-mono text-[10px] text-text-dim hover:text-text-bright"
            >
              Full well
            </button>
          </div>

          <div className="grid max-w-2xl grid-cols-1 gap-1">
            <input
              type="range"
              min={depthBounds.min}
              max={depthBounds.max}
              step={0.5}
              value={depthTop}
              onChange={(e) => applyDepthWindow(Number(e.target.value), depthBot)}
              className="w-full accent-accent"
              aria-label="Depth window top"
            />
            <input
              type="range"
              min={depthBounds.min}
              max={depthBounds.max}
              step={0.5}
              value={depthBot}
              onChange={(e) => applyDepthWindow(depthTop, Number(e.target.value))}
              className="w-full accent-accent"
              aria-label="Depth window bottom"
            />
          </div>

          {zones.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {zones.map((z, i) => {
                const selected =
                  Math.abs(depthTop - z.top_ft) < 0.6 && Math.abs(depthBot - z.bot_ft) < 0.6
                return (
                  <button
                    key={z.id}
                    type="button"
                    title={`${z.top_ft.toFixed(0)}–${z.bot_ft.toFixed(0)} ft`}
                    onClick={() => {
                      applyDepthWindow(z.top_ft, z.bot_ft)
                      onZoneFocus?.(z.id)
                    }}
                    className={clsx(
                      'rounded px-2 py-0.5 font-mono text-[9px] tabular-nums transition-colors',
                      selected
                        ? z.zone_type === 'OIL'
                          ? 'border border-oil/40 bg-oil/20 text-oil'
                          : 'border border-gas/40 bg-gas/20 text-gas'
                        : 'border border-border-muted text-text-dim hover:text-text-bright',
                    )}
                  >
                    {z.zone_type[0]}
                    {i + 1}{' '}
                    <span className="opacity-75">
                      {z.top_ft.toFixed(0)}–{z.bot_ft.toFixed(0)}
                    </span>
                  </button>
                )
              })}
            </div>
          )}

          {activeZone && onViewZoneInLogs && (
            <button
              type="button"
              onClick={() => onViewZoneInLogs(activeZone.id)}
              className="font-mono text-[10px] text-accent hover:underline"
            >
              View {activeZone.zone_type} zone interpretation in log view →
            </button>
          )}
        </div>
      </div>

      {/* Chart — below controls in the same scroll flow */}
      <div className="panel shrink-0 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <span className="font-mono text-[9px] uppercase tracking-widest text-text-dim">
            Chart height
          </span>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={MIN_CHART_HEIGHT}
              max={MAX_CHART_HEIGHT}
              step={20}
              value={chartHeight}
              onChange={(e) => setChartHeight(clampChartH(Number(e.target.value)))}
              className="w-32 accent-accent sm:w-44"
              aria-label="Crossplot chart height"
            />
            <span className="w-12 font-mono text-[10px] tabular-nums text-text-dim">
              {chartHeight}px
            </span>
          </div>
        </div>

        {windowPoints.length === 0 ? (
          <div
            className="flex items-center justify-center font-mono text-sm text-text-dim"
            style={{ height: chartHeight }}
          >
            No samples in this depth window — widen the range or pick a zone chip.
          </div>
        ) : (
          <div className="w-full" style={{ height: chartHeight }}>
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 16, right: 24, left: 12, bottom: 56 }}>
                <CartesianGrid stroke={palette.border} strokeDasharray="2 4" />
                <XAxis
                  type="number"
                  dataKey="x"
                  domain={[0, 60]}
                  tick={{ fill: palette.textDim, fontSize: 11, fontFamily: 'IBM Plex Mono' }}
                  stroke={palette.border}
                >
                  <Label
                    value="NPHI (%)"
                    position="insideBottom"
                    offset={-10}
                    fill={palette.textDim}
                  />
                </XAxis>
                <YAxis
                  type="number"
                  dataKey="y"
                  domain={[-10, 50]}
                  tick={{ fill: palette.textDim, fontSize: 11, fontFamily: 'IBM Plex Mono' }}
                  stroke={palette.border}
                >
                  <Label
                    value="DPHI (%)"
                    angle={-90}
                    position="insideLeft"
                    fill={palette.textDim}
                  />
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
                  formatter={(value: number, name: string) => [
                    `${value.toFixed(2)}`,
                    name === 'x' ? 'NPHI%' : name === 'y' ? 'DPHI%' : name,
                  ]}
                  labelFormatter={(_, payload) => {
                    const p = payload?.[0]?.payload as Point | undefined
                    return p ? `Depth ${p.depth.toFixed(1)} ft · GR ${p.gr.toFixed(0)}` : ''
                  }}
                />
                <Legend
                  verticalAlign="bottom"
                  align="center"
                  wrapperStyle={{
                    fontFamily: 'IBM Plex Mono',
                    fontSize: 11,
                    color: palette.textDim,
                    paddingTop: 8,
                  }}
                />

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
                <ReferenceLine
                  segment={[
                    { x: 0, y: 6 },
                    { x: 60, y: 38 },
                  ]}
                  stroke={palette.lithSandstone}
                  strokeDasharray="2 4"
                />
                <ReferenceLine
                  segment={[
                    { x: 0, y: -5 },
                    { x: 60, y: 25 },
                  ]}
                  stroke={palette.lithDolomite}
                  strokeDasharray="2 4"
                />

                <Scatter
                  name="Clean (GR<50)"
                  data={cleanPts}
                  fill={palette.reservoir}
                  fillOpacity={0.55}
                />
                <Scatter name="Mid (50-80)" data={midPts} fill={palette.accent} fillOpacity={0.35} />
                <Scatter name="Shale (GR>80)" data={shalePts} fill={palette.vsh} fillOpacity={0.22} />
                <Scatter name="Oil (in window)" data={oilPts} fill={palette.oil}>
                  {oilPts.map((_, i) => (
                    <Cell key={`oil-${i}`} r={7} />
                  ))}
                </Scatter>
                <Scatter name="Gas (in window)" data={gasPts} fill={palette.gas}>
                  {gasPts.map((_, i) => (
                    <Cell key={`gas-${i}`} r={7} />
                  ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        )}

        <p className="mt-3 font-mono text-[10px] text-text-dim">
          {depthTop.toFixed(0)}–{depthBot.toFixed(0)} ft · Upper-left = gas crossover · Scroll down
          past the controls to view the full chart · Drag chart height to resize
        </p>
      </div>
    </div>
  )
}
