import { useEffect, useMemo, useRef } from 'react'

import { PX_PER_FT } from '@/utils/colors'
import { useChartPalette } from '@/theme/ThemeProvider'

interface DepthRulerProps {
  depthMin: number
  depthMax: number
  zoomFactor: number
  width?: number
  scrollTop: number
  viewportHeight: number
}

const VIRT_BUFFER = 1500
const VIRT_CHUNK = 500
const MAX_CANVAS_PX = 14000

export default function DepthRuler({
  depthMin,
  depthMax,
  zoomFactor,
  width = 80,
  scrollTop,
  viewportHeight,
}: DepthRulerProps) {
  const palette = useChartPalette()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  const totalHeight = useMemo(
    () => Math.max(1, (depthMax - depthMin) * PX_PER_FT * zoomFactor),
    [depthMax, depthMin, zoomFactor],
  )

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
    ctx.fillStyle = palette.bgDeep
    ctx.fillRect(0, 0, width, canvasH)

    let step = 100
    if (zoomFactor > 5) step = 10
    else if (zoomFactor > 2) step = 25
    else if (zoomFactor > 1.2) step = 50

    ctx.font = '500 10px "JetBrains Mono", monospace'
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'

    const sliceTopFt = depthMin + canvasTop / (PX_PER_FT * zoomFactor)
    const sliceBotFt =
      depthMin + (canvasTop + canvasH) / (PX_PER_FT * zoomFactor)
    const startTick = Math.ceil(sliceTopFt / step) * step
    const endTick = Math.min(depthMax, sliceBotFt)

    for (let d = startTick; d <= endTick; d += step) {
      const y = (d - depthMin) * PX_PER_FT * zoomFactor - canvasTop
      ctx.beginPath()
      ctx.moveTo(width - 8, y)
      ctx.lineTo(width, y)
      ctx.strokeStyle = palette.borderLight
      ctx.lineWidth = 0.5
      ctx.stroke()
      ctx.fillStyle = palette.textDim
      ctx.fillText(String(Math.round(d)), width - 12, y)
    }

    ctx.strokeStyle = palette.border
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(width - 0.5, 0)
    ctx.lineTo(width - 0.5, canvasH)
    ctx.stroke()
  }, [depthMin, depthMax, zoomFactor, width, canvasTop, canvasH, palette])

  return (
    <div
      style={{ width, minWidth: width }}
      className="relative bg-bg-deep border-r border-border"
    >
      <div className="sticky top-0 z-10 surface-depth-stick border-b border-border h-[60px] flex flex-col items-center justify-center">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-text-dim">
          Depth
        </span>
        <span className="font-mono text-[9px] text-text-faint">ft</span>
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
