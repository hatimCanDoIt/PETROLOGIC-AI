import { useEffect, useMemo, useRef } from 'react'

import { PX_PER_FT } from '@/utils/colors'
import { useChartPalette } from '@/theme/ThemeProvider'
import { toColorInputValue, type LogCurveColorKey } from '@/utils/logCurveColors'
import {
  canvasLineDash,
  type LogCurveLineStyle,
} from '@/utils/logCurveStyles'

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
  lineStyle?: LogCurveLineStyle
  /** ``dots`` = Excel-style markers (no connecting line); default ``line``. */
  renderMode?: 'line' | 'dots'
  dotRadius?: number
  /** When set, a color picker is shown in the track header for this curve. */
  colorKey?: LogCurveColorKey
  label: string
}

export interface ZoneOverlay {
  id?: string
  zone_type: 'OIL' | 'GAS'
  top_ft: number
  bot_ft: number
  selected?: boolean
}

export interface ReferenceLine {
  value: number
  color: string
  label?: string
  dashed?: boolean
  lineStyle?: LogCurveLineStyle
  /** Match ``CurveConfig.label`` for x-axis scale (default: first curve). */
  curveLabel?: string
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
  scrollTop: number
  viewportHeight: number
  onCurveColorChange?: (key: LogCurveColorKey, color: string) => void
  onCurveStyleChange?: (key: LogCurveColorKey, style: LogCurveLineStyle) => void
  curveLineStyles?: Partial<Record<LogCurveColorKey, LogCurveLineStyle>>
}

// Browsers cap each canvas at ~32 767 px (Chrome, Edge) or 16 384 px (Safari).
// To stay safe at any zoom level we virtualize: only the currently visible
// slice (+ a buffer in both directions, snapped to chunks so we don't have to
// re-render on every single scroll pixel) is drawn.
const VIRT_BUFFER = 1500
const VIRT_CHUNK = 500
const MAX_CANVAS_PX = 14000

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
  scrollTop,
  viewportHeight,
  onCurveColorChange,
  onCurveStyleChange,
  curveLineStyles,
}: TrackCanvasProps) {
  const palette = useChartPalette()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  const totalHeight = useMemo(
    () => Math.max(1, (depthMax - depthMin) * PX_PER_FT * zoomFactor),
    [depthMax, depthMin, zoomFactor],
  )

  // Virtualized canvas window — snap to chunks so we only re-render every
  // ~500 scrolled px and never ask the GPU to allocate a > MAX_CANVAS_PX
  // pixel-tall surface.
  const { canvasTop, canvasH } = useMemo(() => {
    if (totalHeight <= viewportHeight + 2 * VIRT_BUFFER) {
      return { canvasTop: 0, canvasH: totalHeight }
    }
    const rawTop = Math.max(0, scrollTop - VIRT_BUFFER)
    const snappedTop = Math.floor(rawTop / VIRT_CHUNK) * VIRT_CHUNK
    const desiredH = viewportHeight + 2 * VIRT_BUFFER + VIRT_CHUNK
    const h = Math.min(MAX_CANVAS_PX, Math.min(totalHeight - snappedTop, desiredH))
    return { canvasTop: snappedTop, canvasH: Math.max(1, h) }
  }, [totalHeight, scrollTop, viewportHeight])

  // ---------------------------------------------------------------- render
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = width * dpr
    canvas.height = canvasH * dpr
    canvas.style.width = `${width}px`
    canvas.style.height = `${canvasH}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const canvasBottom = canvasTop + canvasH
    const ftToY = (ft: number) =>
      ftToPx(ft, depthMin, zoomFactor) - canvasTop

    // Depth range visible in this canvas slice
    const sliceTopFt = depthMin + canvasTop / (PX_PER_FT * zoomFactor)
    const sliceBotFt =
      depthMin + canvasBottom / (PX_PER_FT * zoomFactor)

    // 1) background
    ctx.fillStyle = palette.bgPanel
    ctx.fillRect(0, 0, width, canvasH)

    // 2) horizontal grid every 100ft
    ctx.strokeStyle = palette.trackGrid
    ctx.lineWidth = 0.5
    const gridStart = Math.ceil(sliceTopFt / 100) * 100
    const gridEnd = Math.min(depthMax, sliceBotFt)
    for (let d = gridStart; d <= gridEnd; d += 100) {
      const y = ftToY(d)
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(width, y)
      ctx.stroke()
    }

    // 3) zone backgrounds + 4) top/bot lines + 5) depth labels
    for (const z of zones) {
      if (z.bot_ft < sliceTopFt - 2 || z.top_ft > sliceBotFt + 2) continue
      const top = ftToY(z.top_ft)
      const bot = ftToY(z.bot_ft)
      ctx.fillStyle = z.zone_type === 'OIL' ? palette.zoneOilFill : palette.zoneGasFill
      ctx.fillRect(0, top, width, Math.max(1, bot - top))

      const lineColor = z.zone_type === 'OIL' ? palette.zoneOilLine : palette.zoneGasLine
      ctx.strokeStyle = lineColor
      ctx.lineWidth = z.selected ? 2.5 : 1.5
      ctx.setLineDash(z.selected ? [] : [4, 3])
      ctx.beginPath()
      ctx.moveTo(0, top)
      ctx.lineTo(width, top)
      ctx.moveTo(0, bot)
      ctx.lineTo(width, bot)
      ctx.stroke()
      ctx.setLineDash([])

      ctx.fillStyle = lineColor
      ctx.font = '600 10px "IBM Plex Sans", system-ui, sans-serif'
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
        const d0 = leftColorBar.depths[i]
        const d1 = leftColorBar.depths[i + 1]
        if (d1 < sliceTopFt || d0 > sliceBotFt) continue
        const y0 = ftToY(d0)
        const y1 = ftToY(d1)
        ctx.fillStyle = leftColorBar.colors[v as number] || palette.lithUncertain
        ctx.fillRect(0, y0, barWidth, Math.max(0.5, y1 - y0))
      }
      ctx.strokeStyle = palette.border
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(barWidth + 0.5, 0)
      ctx.lineTo(barWidth + 0.5, canvasH)
      ctx.stroke()
    }

    // 7) reference lines (vertical at curve-value positions)
    for (const ref of referenceLines) {
      const c =
        (ref.curveLabel
          ? curves.find((curve) => curve.label === ref.curveLabel)
          : undefined) ?? curves[0]
      if (!c) continue
      const x = curveValueToX(ref.value, c, width)
      if (x == null) continue
      ctx.strokeStyle = ref.color
      ctx.lineWidth = 1
      const refStyle: LogCurveLineStyle = ref.lineStyle
        ? ref.lineStyle
        : ref.dashed
          ? 'dashed'
          : 'solid'
      ctx.setLineDash(canvasLineDash(refStyle))
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, canvasH)
      ctx.stroke()
      ctx.setLineDash([])
      if (ref.label && canvasTop === 0) {
        ctx.fillStyle = ref.color
        ctx.font = '500 9px "IBM Plex Mono", monospace'
        ctx.textBaseline = 'top'
        ctx.textAlign = 'left'
        ctx.fillText(ref.label, x + 3, 4)
      }
    }

    // 8) curves — fills first, then strokes (only visible slice)
    for (const curve of curves) {
      const n = Math.min(curve.depths.length, curve.values.length)
      if (n === 0) continue

      // Find first/last sample inside the slice (with one extra on each side
      // so polylines continue cleanly off the edges).
      let i0 = 0
      while (i0 < n && curve.depths[i0] < sliceTopFt) i0++
      i0 = Math.max(0, i0 - 1)
      let i1 = n - 1
      while (i1 > 0 && curve.depths[i1] > sliceBotFt) i1--
      i1 = Math.min(n - 1, i1 + 1)
      if (i1 <= i0) continue

      // Build polyline points (only valid samples)
      const points: { x: number; y: number }[] = []
      for (let i = i0; i <= i1; i++) {
        const v = curve.values[i]
        const y = ftToY(curve.depths[i])
        if (v == null || !Number.isFinite(v)) {
          points.push({ x: NaN, y })
          continue
        }
        const x = curveValueToX(v, curve, width)
        if (x == null) {
          points.push({ x: NaN, y })
          continue
        }
        points.push({ x, y })
      }

      if (curve.renderMode === 'dots') {
        ctx.fillStyle = curve.color
        const r = curve.dotRadius ?? 1.25
        for (const p of points) {
          if (Number.isNaN(p.x)) continue
          ctx.beginPath()
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
          ctx.fill()
        }
        continue
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
      const strokeStyle: LogCurveLineStyle =
        curve.lineStyle ?? (curve.dashed ? 'dashed' : 'solid')
      ctx.setLineDash(canvasLineDash(strokeStyle))
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
    canvasTop,
    canvasH,
    depthMin,
    depthMax,
    zoomFactor,
    curves,
    zones,
    referenceLines,
    leftColorBar,
    palette,
  ])

  return (
    <div
      ref={containerRef}
      style={{ width, minWidth: width }}
      className="relative border-r border-border bg-bg"
      id={`track-${id}`}
    >
      <div className="surface-track-stick relative sticky top-0 z-10 flex h-[60px] shrink-0 flex-col overflow-hidden border-b border-border px-2 py-1">
        <div className="flex h-[14px] shrink-0 items-center justify-between gap-1">
          <span className="truncate font-display text-[10px] uppercase tracking-widest text-text-bright">
            {label}
          </span>
          {unit && (
            <span className="shrink-0 font-mono text-[9px] text-text-dim">{unit}</span>
          )}
        </div>
        {/* Legend — single row; fixed header height keeps all columns aligned */}
        <div className="mt-0.5 flex h-[18px] shrink-0 flex-nowrap items-center gap-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none]">
          {curves.map((c) => {
            if (!c.label.trim() || c.lineWidth === 0) return null
            return (
              <span
                key={c.label}
                className="inline-flex shrink-0 items-center gap-0.5 text-[8px] font-mono leading-none text-text-dim"
              >
                {c.colorKey && onCurveColorChange ? (
                  <>
                    <input
                      type="color"
                      value={toColorInputValue(c.color, c.colorKey)}
                      title={`${c.label} color`}
                      className="h-3 w-3 shrink-0 cursor-pointer border-0 bg-transparent p-0"
                      onChange={(e) =>
                        onCurveColorChange(c.colorKey!, e.target.value)
                      }
                    />
                    {onCurveStyleChange && (
                      <select
                        value={
                          curveLineStyles?.[c.colorKey] ??
                          (c.lineStyle ?? (c.dashed ? 'dashed' : 'solid'))
                        }
                        title={`${c.label} line style`}
                        className="max-w-[1.35rem] cursor-pointer border-0 bg-transparent p-0 font-mono text-[7px] text-text-dim"
                        onChange={(e) =>
                          onCurveStyleChange(
                            c.colorKey!,
                            e.target.value as LogCurveLineStyle,
                          )
                        }
                      >
                        <option value="solid">─</option>
                        <option value="dashed">╌</option>
                        <option value="dotted">···</option>
                      </select>
                    )}
                  </>
                ) : (
                  <span
                    className="inline-block w-3 shrink-0"
                    style={
                      (c.lineStyle ?? (c.dashed ? 'dashed' : 'solid')) !==
                      'solid'
                        ? {
                            height: 0,
                            borderBottom: `2px ${
                              (c.lineStyle ?? (c.dashed ? 'dashed' : 'solid')) ===
                              'dotted'
                                ? 'dotted'
                                : 'dashed'
                            } ${c.color}`,
                          }
                        : { height: '2px', background: c.color }
                    }
                  />
                )}
                {c.label}
              </span>
            )
          })}
        </div>
        {/* Scale labels */}
        {scaleLabel && (
          <div className="absolute bottom-0.5 left-1 right-1 flex justify-between font-mono text-[8px] text-text-subtle80">
            <span>{scaleLabel[0]}</span>
            {scaleTicks && (
              <span className="text-text-softer">
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
      <div style={{ position: 'relative', height: totalHeight }}>
        <canvas
          ref={canvasRef}
          style={{
            position: 'absolute',
            left: 0,
            top: canvasTop,
            display: 'block',
          }}
        />
      </div>
    </div>
  )
}

export { HEADER_HEIGHT }
