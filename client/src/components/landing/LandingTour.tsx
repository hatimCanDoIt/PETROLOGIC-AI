import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react'
import clsx from 'clsx'

const STORAGE_DONE = 'petrologic-landing-tour-done'

type Step = {
  id: string
  title: string
  body: string
  /** CSS selector — omit for intro popover anchored to FAB */
  targetSelector?: string
}

const STEPS: Step[] = [
  {
    id: 'welcome',
    title: 'Quick tour',
    body: 'PETROLOGIC parses LAS files, computes petrophysics, and adds AI narration. Tap Next to highlight the main spots on this page.',
  },
  {
    id: 'nav',
    title: 'Explore sections',
    body: 'Use Features and Methodology in the header to scroll to deeper detail—or jump straight into the app.',
    targetSelector: '[data-tour="nav-features"]',
  },
  {
    id: 'cta',
    title: 'Request access or sign in',
    body: 'PETROLOGIC AI is sales-led: request access to schedule a demo for your team. Existing users sign in to resume where they left off.',
    targetSelector: '[data-tour="cta-register"]',
  },
  {
    id: 'features',
    title: 'What ships today',
    body: 'Card summaries show LAS ingestion, deterministic Sw / Vsh / porosity workflows, and zone-level AI interpretations.',
    targetSelector: '[data-tour="section-features"]',
  },
  {
    id: 'methodology',
    title: 'Deterministic · then AI',
    body: 'The engine always runs reproducible physics first (Archie, Vsh picks, neutron–density)—Claude interprets after.',
    targetSelector: '[data-tour="methodology-section"]',
  },
  {
    id: 'done',
    title: 'You\'re ready',
    body: 'From the dashboard, upload a LAS, open a report, toggle tracks, read zones, export. Open Settings anytime for dark mode.',
  },
]

function readDone() {
  try {
    return localStorage.getItem(STORAGE_DONE) === '1'
  } catch {
    return false
  }
}

export default function LandingTour() {
  const maskUid = useId().replace(/:/g, '')
  const [running, setRunning] = useState(false)
  const [stepIdx, setStepIdx] = useState(0)
  const [hole, setHole] = useState<{
    x: number
    y: number
    w: number
    h: number
    r: number
  } | null>(null)

  const step = STEPS[stepIdx]
  const isLast = stepIdx >= STEPS.length - 1

  const targetSelector = STEPS[stepIdx].targetSelector

  const measureHole = useCallback(() => {
    const sel = targetSelector
    if (!running || !sel) {
      setHole(null)
      return
    }
    const el = document.querySelector(sel)
    if (!el) {
      setHole(null)
      return
    }
    const r = el.getBoundingClientRect()
    const pad = 12
    const rad = 10
    setHole({
      x: Math.max(0, r.left - pad),
      y: Math.max(0, r.top - pad),
      w: Math.min(window.innerWidth, r.width + pad * 2),
      h: Math.min(window.innerHeight, r.height + pad * 2),
      r: rad,
    })

    el.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
      inline: 'nearest',
    })
  }, [running, targetSelector])

  useLayoutEffect(() => {
    measureHole()
    const onResize = () => measureHole()
    const onScroll = () => measureHole()
    window.addEventListener('resize', onResize)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [measureHole, stepIdx])

  useEffect(() => {
    if (!running) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [running])

  useEffect(() => {
    if (readDone()) return
    const t = window.setTimeout(() => setRunning(true), 1200)
    return () => window.clearTimeout(t)
  }, [])

  const markDone = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_DONE, '1')
    } catch {
      /* ignore */
    }
    setRunning(false)
    setStepIdx(0)
    setHole(null)
  }, [])

  const next = useCallback(() => {
    if (isLast) markDone()
    else setStepIdx((i) => Math.min(i + 1, STEPS.length - 1))
  }, [isLast, markDone])

  const back = useCallback(() => setStepIdx((i) => Math.max(0, i - 1)), [])

  const popoverPlacement = useMemo(() => ({ bottom: 96, right: 24 }), [])

  return (
    <>
      <button
        type="button"
        aria-label={running ? 'Close guided tour' : 'Start guided tour'}
        onClick={(e) => {
          e.stopPropagation()
          if (running) markDone()
          else {
            setStepIdx(0)
            setRunning(true)
            setTimeout(measureHole, 120)
          }
        }}
        className={clsx(
          'fixed z-[120] rounded-full px-4 py-2.5 text-xs font-semibold uppercase tracking-wide shadow-lg transition-all',
          'border border-border bg-bg-panel text-text-bright backdrop-blur',
          running && 'border-accent shadow-glow-accent',
          'bottom-6 right-6 pointer-events-auto',
        )}
      >
        Tour
      </button>

      {running && (
        <>
          {hole ? (
            <svg
              className="fixed inset-0 z-[108] h-full w-full pointer-events-none"
              aria-hidden
            >
              <defs>
                <mask id={`tour-mask-${maskUid}`}>
                  <rect width="100%" height="100%" fill="white" />
                  <rect
                    x={hole.x}
                    y={hole.y}
                    width={hole.w}
                    height={hole.h}
                    rx={hole.r}
                    ry={hole.r}
                    fill="black"
                  />
                </mask>
              </defs>
              <rect
                width="100%"
                height="100%"
                fill="var(--tour-overlay)"
                mask={`url(#tour-mask-${maskUid})`}
              />
              <rect
                x={hole.x}
                y={hole.y}
                width={hole.w}
                height={hole.h}
                rx={hole.r}
                ry={hole.r}
                fill="none"
                stroke="var(--c-accent)"
                strokeWidth={2}
                strokeOpacity={0.85}
              />
            </svg>
          ) : (
            <div
              className="fixed inset-0 z-[108] bg-[color:var(--tour-overlay)]"
              aria-hidden
            />
          )}

          <div
            className={clsx(
              'pointer-events-auto fixed z-[118] flex w-[min(22rem,calc(100vw-8rem))] flex-col rounded-lg border border-border bg-bg-panel p-4 shadow-2xl',
              'backdrop-blur-md',
            )}
            style={{ bottom: popoverPlacement.bottom, right: popoverPlacement.right }}
            role="dialog"
            aria-modal="true"
            aria-labelledby={`tour-title-${step.id}`}
          >
            <p className="text-[10px] font-semibold uppercase tracking-widest text-accent">
              {stepIdx + 1}/{STEPS.length}
            </p>
            <h2
              id={`tour-title-${step.id}`}
              className="mt-2 font-display text-sm uppercase tracking-widest text-text-bright"
            >
              {step.title}
            </h2>
            <p className="mt-2 text-sm text-text">{step.body}</p>
            <div className="mt-5 flex justify-between gap-2">
              <button
                type="button"
                onClick={() => {
                  markDone()
                }}
                className="rounded-md px-3 py-1.5 text-xs text-text-dim underline-offset-4 hover:text-text hover:underline"
              >
                Skip
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={stepIdx === 0}
                  onClick={back}
                  className="rounded-md border border-border bg-bg-deep px-3 py-1.5 text-xs text-text disabled:opacity-40"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={next}
                  className="rounded-md bg-accent px-4 py-1.5 text-xs font-semibold text-white hover:bg-accent-dim"
                >
                  {isLast ? 'Done' : 'Next'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  )
}
