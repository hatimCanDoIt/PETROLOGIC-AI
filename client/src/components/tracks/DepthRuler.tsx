import { useEffect, useRef } from 'react'

import { COLORS, PX_PER_FT } from '@/utils/colors'

interface DepthRulerProps {
  depthMin: number
  depthMax: number
  zoomFactor: number
  width?: number
}

export default function DepthRuler({
  depthMin,
  depthMax,
  zoomFactor,
  width = 80,
}: DepthRulerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const height = (depthMax - depthMin) * PX_PER_FT * zoomFactor
    canvas.width = width * dpr
    canvas.height = height * dpr
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = COLORS.bgDeep
    ctx.fillRect(0, 0, width, height)

    // Determine label spacing based on zoom
    let step = 100
    if (zoomFactor > 5) step = 10
    else if (zoomFactor > 2) step = 25
    else if (zoomFactor > 1.2) step = 50

    ctx.strokeStyle = COLORS.border
    ctx.fillStyle = COLORS.text
    ctx.font = '10px "Space Mono", monospace'
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'

    const startTick = Math.ceil(depthMin / step) * step
    for (let d = startTick; d <= depthMax; d += step) {
      const y = (d - depthMin) * PX_PER_FT * zoomFactor
      ctx.beginPath()
      ctx.moveTo(width - 8, y)
      ctx.lineTo(width, y)
      ctx.strokeStyle = COLORS.borderLight
      ctx.lineWidth = 0.5
      ctx.stroke()
      ctx.fillStyle = COLORS.textDim
      ctx.fillText(String(Math.round(d)), width - 12, y)
    }

    // Right edge accent
    ctx.strokeStyle = COLORS.border
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(width - 0.5, 0)
    ctx.lineTo(width - 0.5, height)
    ctx.stroke()
  }, [depthMin, depthMax, zoomFactor, width])

  return (
    <div
      style={{ width, minWidth: width }}
      className="relative bg-bg-deep border-r border-border"
    >
      <div className="sticky top-0 z-10 bg-bg-deep/95 border-b border-border h-[60px] flex flex-col items-center justify-center">
        <span className="font-mono text-[10px] uppercase tracking-widest text-text-dim">
          Depth
        </span>
        <span className="font-mono text-[9px] text-text-dim/70">ft</span>
      </div>
      <canvas ref={canvasRef} />
    </div>
  )
}
