import { useMemo } from 'react'
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

import { COLORS } from '@/utils/colors'
import type { HcZoneOut, ResultJson } from '@/types'

interface NDCrossplotProps {
  result: ResultJson
  zones: HcZoneOut[]
}

interface Point {
  x: number
  y: number
  gr: number
  depth: number
  kind: 'bg' | 'oil' | 'gas'
}

export default function NDCrossplot({ result, zones }: NDCrossplotProps) {
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
    <div className="w-full h-[520px] panel p-4">
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="font-display text-sm uppercase tracking-widest text-text-bright">
          Neutron-Density Crossplot
        </h3>
        <span className="font-mono text-[10px] text-text-dim">
          {data.length} samples
        </span>
      </div>
      <ResponsiveContainer width="100%" height="85%">
        <ScatterChart margin={{ top: 10, right: 20, left: 0, bottom: 20 }}>
          <CartesianGrid stroke="#162840" strokeDasharray="2 4" />
          <XAxis
            type="number"
            dataKey="x"
            domain={[0, 60]}
            tick={{ fill: COLORS.textDim, fontSize: 11, fontFamily: 'Space Mono' }}
            stroke={COLORS.border}
          >
            <Label value="NPHI (%)" position="insideBottom" offset={-10} fill={COLORS.textDim} />
          </XAxis>
          <YAxis
            type="number"
            dataKey="y"
            domain={[-10, 50]}
            tick={{ fill: COLORS.textDim, fontSize: 11, fontFamily: 'Space Mono' }}
            stroke={COLORS.border}
          >
            <Label value="DPHI (%)" angle={-90} position="insideLeft" fill={COLORS.textDim} />
          </YAxis>
          <ZAxis range={[20, 60]} />
          <Tooltip
            cursor={{ stroke: COLORS.accent, strokeDasharray: '3 3' }}
            contentStyle={{
              background: COLORS.bgDeep,
              border: `1px solid ${COLORS.border}`,
              fontFamily: 'Space Mono',
              fontSize: 11,
              color: COLORS.text,
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
            wrapperStyle={{ fontFamily: 'Space Mono', fontSize: 11, color: COLORS.textDim }}
          />

          {/* 1:1 diagonal */}
          <ReferenceLine
            segment={[
              { x: 0, y: 0 },
              { x: 60, y: 60 },
            ]}
            stroke={COLORS.borderLight}
            strokeDasharray="3 3"
            label={{
              value: 'Limestone (1:1)',
              fill: COLORS.lithLimestone,
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
            stroke={COLORS.lithSandstone}
            strokeDasharray="2 4"
          />
          {/* Dolomite line: shifted down ~5 */}
          <ReferenceLine
            segment={[
              { x: 0, y: -5 },
              { x: 60, y: 25 },
            ]}
            stroke={COLORS.lithDolomite}
            strokeDasharray="2 4"
          />

          <Scatter name="Clean (GR<50)" data={cleanPts} fill={COLORS.reservoir} fillOpacity={0.45} />
          <Scatter name="Mid (50-80)" data={midPts} fill={COLORS.accent} fillOpacity={0.3} />
          <Scatter name="Shale (GR>80)" data={shalePts} fill={COLORS.vsh} fillOpacity={0.18} />
          <Scatter name="Oil zones" data={hcPoints.filter((p) => p.kind === 'oil')} fill={COLORS.oil}>
            {hcPoints
              .filter((p) => p.kind === 'oil')
              .map((_, i) => (
                <Cell key={`oil-${i}`} r={8} />
              ))}
          </Scatter>
          <Scatter name="Gas zones" data={hcPoints.filter((p) => p.kind === 'gas')} fill={COLORS.gas}>
            {hcPoints
              .filter((p) => p.kind === 'gas')
              .map((_, i) => (
                <Cell key={`gas-${i}`} r={8} />
              ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
      <p className="font-mono text-[10px] text-text-dim mt-2">
        ← Gas effect (low NPHI, high DPHI) drives points toward upper-left · Heavy
        shales fall lower-right
      </p>
    </div>
  )
}
