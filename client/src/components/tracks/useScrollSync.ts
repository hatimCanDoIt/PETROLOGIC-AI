import { useCallback, useEffect, useRef, useState } from 'react'

import { PX_PER_FT } from '@/utils/colors'

/**
 * Provides scroll + zoom state for the log viewer. All tracks share the same
 * `scrollContainerRef`-style container externally; this hook only manages the
 * pixel offset and the zoom factor (1.0 default, 0.1–20 range).
 */
export function useScrollSync(depthMin: number, depthMax: number, viewportHeight: number) {
  const [zoomFactor, setZoomFactor] = useState(1.0)
  const [scrollTop, setScrollTop] = useState(0)
  const scrollerRef = useRef<HTMLDivElement | null>(null)

  const setZoom = useCallback((next: number) => {
    setZoomFactor((prev) => {
      const clamped = Math.min(20, Math.max(0.1, next))
      if (scrollerRef.current) {
        const el = scrollerRef.current
        const center = (el.scrollTop + el.clientHeight / 2) / Math.max(1, prev)
        // Schedule scroll adjustment after re-render
        requestAnimationFrame(() => {
          if (scrollerRef.current) {
            scrollerRef.current.scrollTop =
              center * clamped - scrollerRef.current.clientHeight / 2
          }
        })
      }
      return clamped
    })
  }, [])

  const onScroll = useCallback(() => {
    if (scrollerRef.current) {
      setScrollTop(scrollerRef.current.scrollTop)
    }
  }, [])

  const scrollToDepth = useCallback(
    (ft: number) => {
      const el = scrollerRef.current
      if (!el) return
      const y = (ft - depthMin) * PX_PER_FT * zoomFactor - 150
      el.scrollTo({ top: Math.max(0, y), behavior: 'smooth' })
    },
    [depthMin, zoomFactor],
  )

  // Wheel handler — Ctrl/Cmd + wheel = zoom, otherwise normal scroll
  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const handler = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        const direction = e.deltaY > 0 ? 1 / 1.15 : 1.15
        setZoom(zoomFactor * direction)
      }
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [setZoom, zoomFactor])

  const contentHeight = Math.max(
    viewportHeight,
    (depthMax - depthMin) * PX_PER_FT * zoomFactor,
  )

  return {
    scrollerRef,
    scrollTop,
    zoomFactor,
    setZoom,
    onScroll,
    scrollToDepth,
    contentHeight,
  }
}
