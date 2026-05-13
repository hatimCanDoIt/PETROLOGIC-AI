import { useEffect, useMemo, useRef } from 'react'

import { COLORS, PX_PER_FT } from '@/utils/colors'

export interface CurveConfig {
  depths: number[]
  values: (number | null)[]
  color: string
  lineWidth?: number
  xMin: number
  xMax: number
  logScale?: boolean
  reversed?: boolean
  fillLeft?: boolean
  fillRight?: boolean
  fillColor?: string
  dashed?: boolean
  label: string
}

export interface ZoneOverlay {
  zone_type: 'OIL' | 'GAS'
  top_ft: number
  bot_ft: number
}

export interface ReferenceLine {
  value: number
  color: string
  label?: string
  dashed?: boolean
}

export interface TrackCanvasProps {
  id: string
  label: string
  unit?: string
  scaleLabel?: [string, string]
  width?: number
  curves: CurveConfig[]
  zones?: ZoneOverlay[]
  depthMin: number
  depthMax: number
  zoomFactor: number
  referenceLines?: ReferenceLine[]
  leftColorBar?: { depths: number[]; values: number[]; colors: string[] }
  scaleTicks?: number[]
  logScaleHeader?: boolean
}

// ---------- coordinate helpers ----------

function ftToPx(ft: number, depthMin: number, zoomFactor: number) {
  return (ft - depthMin) * PX_PER_FT * zoomFactor
}

function curveValueToX(value: number, curve: CurveConfig, width: number): number | null {
  const { xMin, xMax, logScale, reversed } = curve
  if (!Number.isFinite(value)) return null

  let t: number
  if (logScale) {
    const lo = Math.max(1e-6, xMin)
    const hi = Math.max(lo * 1.01, xMax)
    const v = Math.max(lo, value)
    t = (Math.log10(v) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo))
  } else {
    t = (value - xMin) / (xMax - xMin)
  }
  t = Math.min(1, Math.max(0, t))
  return reversed ? width - t * width : t * width
}

// ---------- main component ----------

const HEADER_HEIGHT = 60

export default function TrackCanvas({
  id,
  label,
  unit,
  scaleLabel,
  width = 160,
  curves,
  zones = [],
  depthMin,
  depthMax,
  zoomFactor,
  referenceLines = [],
  leftColorBar,
  scaleTicks,
  logScaleHeader,
}: TrackCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const tooltipState = useRef<{ visible: boolean }>({ visible: false })

  const totalHeight = useMemo(
    () => Math.max(1, (depthMax - depthMin) * PX_PER_FT * zoomFactor),
    [depthMax, depthMin, zoomFactor],
  )

  // Build, for each curve, an index by depth (depth → array index) for the
  // tooltip lookup. The curves are usually already depth-sorted.
  const curveIndexes = useMemo(() => {
    return curves.map((c) => c.depths.slice())
  }, [curves])

  // ---------------------------------------------------------------- render
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = width * dpr
    canvas.height = totalHeight * dpr
    canvas.style.width = `${width}px`
    canvas.style.height = `${totalHeight}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    // 1) background
    ctx.fillStyle = COLORS.bg
    ctx.fillRect(0, 0, width, totalHeight)

    // 2) horizontal grid every 100ft
    ctx.strokeStyle = 'rgba(22,40,64,0.5)'
    ctx.lineWidth = 0.5
    const start = Math.ceil(depthMin / 100) * 100
    for (let d = start; d <= depthMax; d += 100) {
      const y = ftToPx(d, depthMin, zoomFactor)
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(width, y)
      ctx.stroke()
    }

    // 3) zone backgrounds + 4) top/bot lines + 5) depth labels
    for (const z of zones) {
      const top = ftToPx(z.top_ft, depthMin, zoomFactor)
      const bot = ftToPx(z.bot_ft, depthMin, zoomFactor)
      ctx.fillStyle = z.zone_type === 'OIL' ? COLORS.zoneOilFill : COLORS.zoneGasFill
      ctx.fillRect(0, top, width, Math.max(1, bot - top))

      const lineColor = z.zone_type === 'OIL' ? COLORS.zoneOilLine : COLORS.zoneGasLine
      ctx.strokeStyle = lineColor
      ctx.lineWidth = 1.5
      ctx.setLineDash([4, 3])
      ctx.beginPath()
      ctx.moveTo(0, top)
      ctx.lineTo(width, top)
      ctx.moveTo(0, bot)
      ctx.lineTo(width, bot)
      ctx.stroke()
      ctx.setLineDash([])

      ctx.fillStyle = lineColor
      ctx.font = '9px "Orbitron", monospace'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'bottom'
      ctx.fillText(`${z.top_ft.toFixed(0)} ft`, 4, top - 2)
      ctx.textBaseline = 'top'
      ctx.fillText(`${z.bot_ft.toFixed(0)} ft`, 4, bot + 2)
    }

    // 6) left colour bar (lithology)
    if (leftColorBar && leftColorBar.depths.length === leftColorBar.values.length) {
      const barWidth = 12
      for (let i = 0; i < leftColorBar.depths.length - 1; i++) {
        const v = leftColorBar.values[i]
        if (!Number.isFinite(v)) continue
        const y0 = ftToPx(leftColorBar.depths[i], depthMin, zoomFactor)
        const y1 = ftToPx(leftColorBar.depths[i + 1], depthMin, zoomFactor)
        ctx.fillStyle = leftColorBar.colors[v as number] || COLORS.lithUncertain
        ctx.fillRect(0, y0, barWidth, Math.max(0.5, y1 - y0))
      }
      ctx.strokeStyle = COLORS.border
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(barWidth + 0.5, 0)
      ctx.lineTo(barWidth + 0.5, totalHeight)
      ctx.stroke()
    }

    // 7) reference lines (vertical at curve-value positions)
    for (const ref of referenceLines) {
      // Use the first curve's scale for the reference value
      const c = curves[0]
      if (!c) continue
      const x = curveValueToX(ref.value, c, width)
      if (x == null) continue
      ctx.strokeStyle = ref.color
      ctx.lineWidth = 1
      ctx.setLineDash(ref.dashed ? [3, 3] : [])
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, totalHeight)
      ctx.stroke()
      ctx.setLineDash([])
      if (ref.label) {
        ctx.fillStyle = ref.color
        ctx.font = '9px "Space Mono", monospace'
        ctx.textBaseline = 'top'
        ctx.textAlign = 'left'
        ctx.fillText(ref.label, x + 3, 4)
      }
    }

    // 8) curves — fills first, then strokes
    for (const curve of curves) {
      const n = Math.min(curve.depths.length, curve.values.length)
      if (n === 0) continue

      // Build polyline points (only valid samples)
      const points: { x: number; y: number }[] = []
      for (let i = 0; i < n; i++) {
        const v = curve.values[i]
        if (v == null || !Number.isFinite(v)) {
          // Push a break marker (null x) so we can split the line
          points.push({ x: NaN, y: ftToPx(curve.depths[i], depthMin, zoomFactor) })
          continue
        }
        const x = curveValueToX(v, curve, width)
        if (x == null) {
          points.push({ x: NaN, y: ftToPx(curve.depths[i], depthMin, zoomFactor) })
          continue
        }
        points.push({ x, y: ftToPx(curve.depths[i], depthMin, zoomFactor) })
      }

      // Fill (left or right)
      if ((curve.fillLeft || curve.fillRight) && curve.fillColor) {
        ctx.fillStyle = curve.fillColor
        ctx.beginPath()
        let started = false
        const baseX = curve.fillLeft ? 0 : width
        for (const p of points) {
          if (Number.isNaN(p.x)) {
            if (started) {
              ctx.lineTo(baseX, p.y)
              ctx.closePath()
              ctx.fill()
              ctx.beginPath()
              started = false
            }
            continue
          }
          if (!started) {
            ctx.moveTo(baseX, p.y)
            ctx.lineTo(p.x, p.y)
            started = true
          } else {
            ctx.lineTo(p.x, p.y)
          }
        }
        if (started) {
          const last = points[points.length - 1]
          ctx.lineTo(baseX, last.y)
          ctx.closePath()
          ctx.fill()
        }
      }

      // Stroke
      ctx.strokeStyle = curve.color
      ctx.lineWidth = curve.lineWidth || 1
      if (curve.dashed) ctx.setLineDash([4, 3])
      ctx.beginPath()
      let drawing = false
      for (const p of points) {
        if (Number.isNaN(p.x)) {
          drawing = false
          continue
        }
        if (!drawing) {
          ctx.moveTo(p.x, p.y)
          drawing = true
        } else {
          ctx.lineTo(p.x, p.y)
        }
      }
      ctx.stroke()
      ctx.setLineDash([])
    }
  }, [
    width,
    totalHeight,
    depthMin,
    depthMax,
    zoomFactor,
    curves,
    zones,
    referenceLines,
    leftColorBar,
  ])

  // -------------------------------------------------- tooltip on hover
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const tooltip = document.getElementById('tooltip')
    if (!tooltip) return

    const onMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect()
      const y = e.clientY - rect.top
      const ft = depthMin + y / (PX_PER_FT * zoomFactor)
      const lines: string[] = [`<strong>${ft.toFixed(1)} ft</strong>`]

      for (let i = 0; i < curves.length; i++) {
        const c = curves[i]
        const depths = curveIndexes[i]
        if (!depths || depths.length === 0) continue
        // Binary search nearest depth
        let lo = 0
        let hi = depths.length - 1
        while (lo < hi) {
          const mid = (lo + hi) >> 1
          if (depths[mid] < ft) lo = mid + 1
          else hi = mid
        }
        const idx = lo
        const v = c.values[idx]
        if (v == null || !Number.isFinite(v)) {
          lines.push(`<span style="color:${c.color}">${c.label}:</span> —`)
        } else {
          lines.push(
            `<span style="color:${c.color}">${c.label}:</span> ${(v as number).toFixed(c.logScale ? 2 : 3)}`,
          )
        }
      }

      tooltip.innerHTML = lines.join('<br/>')
      tooltip.classList.add('visible')
      tooltip.style.left = `${e.clientX + 14}px`
      tooltip.style.top = `${e.clientY + 14}px`
      tooltipState.current.visible = true
    }
    const onLeave = () => {
      tooltip.classList.remove('visible')
      tooltipState.current.visible = false
    }

    canvas.addEventListener('mousemove', onMove)
    canvas.addEventListener('mouseleave', onLeave)
    return () => {
      canvas.removeEventListener('mousemove', onMove)
      canvas.removeEventListener('mouseleave', onLeave)
      onLeave()
    }
  }, [curves, curveIndexes, depthMin, zoomFactor])

  return (
    <div
      ref={containerRef}
      style={{ width, minWidth: width }}
      className="relative border-r border-border bg-bg"
      id={`track-${id}`}
    >
      <div className="sticky top-0 z-10 bg-bg-panel/95 border-b border-border h-[60px] px-2 py-1 flex flex-col">
        <div className="flex items-center justify-between">
          <span className="font-display text-[10px] uppercase tracking-widest text-text-bright">
            {label}
          </span>
          {unit && (
            <span className="font-mono text-[9px] text-text-dim">{unit}</span>
          )}
        </div>
        {/* Legend pills for each curve */}
        <div className="flex flex-wrap gap-1 mt-1">
          {curves.map((c) => (
            <span
              key={c.label}
              className="inline-flex items-center gap-1 text-[9px] font-mono text-text-dim"
            >
              <span
                className="inline-block h-0.5 w-3"
                style={{ background: c.color }}
              />
              {c.label}
            </span>
          ))}
        </div>
        {/* Scale labels */}
        {scaleLabel && (
          <div className="absolute bottom-0.5 left-1 right-1 flex justify-between font-mono text-[8px] text-text-dim/80">
            <span>{scaleLabel[0]}</span>
            {scaleTicks && (
              <span className="text-text-dim/60">
                {scaleTicks
                  .map((t) =>
                    logScaleHeader
                      ? t < 1
                        ? `0.1`
                        : t.toString()
                      : t.toString(),
                  )
                  .join(' · ')}
              </span>
            )}
            <span>{scaleLabel[1]}</span>
          </div>
        )}
      </div>
      <canvas ref={canvasRef} style={{ display: 'block' }} />
    </div>
  )
}

export { HEADER_HEIGHT }
