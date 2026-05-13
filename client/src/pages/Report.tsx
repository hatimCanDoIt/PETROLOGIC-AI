import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import clsx from 'clsx'

import AIInterpretation from '@/components/report/AIInterpretation'
import ExportButton from '@/components/report/ExportButton'
import NDCrossplot from '@/components/report/NDCrossplot'
import ParameterPanel from '@/components/report/ParameterPanel'
import ZoneCard from '@/components/report/ZoneCard'
import Button from '@/components/ui/Button'
import Logo from '@/components/layout/Logo'
import SkeletonTrack from '@/components/ui/SkeletonTrack'
import Spinner from '@/components/ui/Spinner'
import LogViewer, { type LogViewerHandle } from '@/components/tracks/LogViewer'
import { useReanalyzeWell, useWell } from '@/hooks/useWell'
import type { PetroParams } from '@/types'

type Tab = 'zones' | 'ai' | 'crossplot' | 'parameters'

interface TabDef {
  id: Tab
  label: string
  short: string
  icon: JSX.Element
}

const TABS: TabDef[] = [
  {
    id: 'zones',
    label: 'Zones',
    short: 'ZN',
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6">
        <rect x="4" y="5" width="16" height="4" rx="1" />
        <rect x="4" y="11" width="16" height="3" rx="1" opacity="0.6" />
        <rect x="4" y="16" width="16" height="3" rx="1" opacity="0.35" />
      </svg>
    ),
  },
  {
    id: 'ai',
    label: 'AI Insight',
    short: 'AI',
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
        <circle cx="12" cy="12" r="3.5" />
      </svg>
    ),
  },
  {
    id: 'crossplot',
    label: 'Crossplot',
    short: 'XP',
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M4 4v16h16" />
        <circle cx="9" cy="14" r="1.2" />
        <circle cx="13" cy="10" r="1.2" />
        <circle cx="17" cy="7" r="1.2" />
        <circle cx="11" cy="17" r="1.2" />
      </svg>
    ),
  },
  {
    id: 'parameters',
    label: 'Parameters',
    short: 'PR',
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.9 2.9l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.9-2.9l.1-.1A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.9-2.9l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.9 2.9l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
      </svg>
    ),
  },
]

const RHS_PANEL_LS_KEY = 'petrologic:reportRhsWidthPx'
const MAIN_MIN_WIDTH_PX = 200
const RHS_PREF_MIN_WIDTH_PX = 220
// Prefer this wide; min/max clamp to viewport so log + RHS never overfill.
const RHS_WIDTH_MAX_RATIO = 0.55

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n))
}

function rhsWidthBounds(bodyWidth: number): { min: number; max: number } {
  if (!Number.isFinite(bodyWidth) || bodyWidth <= 0)
    return { min: RHS_PREF_MIN_WIDTH_PX, max: RHS_PREF_MIN_WIDTH_PX }

  const capacity = Math.max(0, bodyWidth - MAIN_MIN_WIDTH_PX)
  const ratioCap = Math.floor(bodyWidth * RHS_WIDTH_MAX_RATIO)
  const maxRaw = Math.min(capacity, ratioCap, bodyWidth)
  const max = Math.max(0, maxRaw)
  const min = clamp(Math.min(RHS_PREF_MIN_WIDTH_PX, max), 0, max)
  return { min, max }
}

export default function Report() {
  const { wellId } = useParams<{ wellId: string }>()
  const navigate = useNavigate()
  const { data, isLoading, isError, refetch } = useWell(wellId)
  const reanalyze = useReanalyzeWell(wellId)
  const logRef = useRef<LogViewerHandle | null>(null)
  const bodyRowRef = useRef<HTMLDivElement | null>(null)
  const [tab, setTab] = useState<Tab>('zones')
  const [panelOpen, setPanelOpen] = useState(true)
  const [rhsWidthPx, setRhsWidthPx] = useState(() => {
    if (typeof window === 'undefined') return 360
    const stored = Number(localStorage.getItem(RHS_PANEL_LS_KEY))
    const bw =
      typeof document !== 'undefined'
        ? (document.documentElement?.clientWidth ?? window.innerWidth)
        : window.innerWidth
    const { min, max } = rhsWidthBounds(bw)
    if (Number.isFinite(stored)) return clamp(Math.round(stored), min, max)
    return clamp(Math.round(bw * 0.28), min, max)
  })

  const openPanel = (next?: Tab) => {
    if (next) setTab(next)
    setPanelOpen(true)
  }

  // Keyboard shortcut: `\` toggles the analysis panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return
      if (e.key === '\\') {
        e.preventDefault()
        setPanelOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Keep RHS width within [min, max] as the report body resizes (window / zoom / devtools).
  useEffect(() => {
    const el = bodyRowRef.current
    if (!el) return

    const fit = () => {
      const bw = el.getBoundingClientRect().width
      const { min, max } = rhsWidthBounds(bw)
      setRhsWidthPx((w) => clamp(w, min, max))
    }

    const ro = new ResizeObserver(() => fit())
    ro.observe(el)
    fit()
    return () => ro.disconnect()
  }, [])

  const onRhsResizePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!panelOpen) return
      if (e.button !== 0) return
      e.preventDefault()

      const startX = e.clientX
      const startW = rhsWidthPx

      const onMove = (ev: PointerEvent) => {
        const row = bodyRowRef.current
        if (!row) return
        const bw = row.getBoundingClientRect().width
        const { min, max } = rhsWidthBounds(bw)
        const delta = ev.clientX - startX
        setRhsWidthPx(clamp(startW - delta, min, max))
      }

      const onUp = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
        document.body.style.removeProperty('cursor')
        setRhsWidthPx((w) => {
          const rounded = Math.round(w)
          try {
            localStorage.setItem(RHS_PANEL_LS_KEY, String(rounded))
          } catch {
            /* ignore quota / private mode */
          }
          return rounded
        })
      }

      document.body.style.cursor = 'col-resize'
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
    },
    [panelOpen, rhsWidthPx],
  )

  if (isLoading) {
    return (
      <div className="flex h-screen flex-col">
        <div className="flex min-h-[3.5rem] shrink-0 items-center gap-4 border-b border-border surface-header-bar px-[clamp(1rem,4vw,2rem)] py-2">
          <Logo size={28} />
          <span className="font-mono text-xs text-text-dim">Loading well…</span>
        </div>
        <div className="flex flex-1 items-stretch">
          <div
            className="shrink-0 border-r border-border bg-bg-deep"
            style={{ width: 'clamp(4.75rem,22vw,7rem)' }}
          />
          <div className="flex gap-px bg-border">
            <SkeletonTrack label="GR" />
            <SkeletonTrack label="RT" />
            <SkeletonTrack label="NPHI/DPHI" />
            <SkeletonTrack label="Sw" />
            <SkeletonTrack label="PEF" />
          </div>
          <div className="panel-deep flex-1" />
        </div>
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="h-screen flex flex-col items-center justify-center gap-3">
        <p className="text-gas font-display tracking-widest">Failed to load well.</p>
        <Link to="/dashboard" className="text-accent underline">
          Back to dashboard
        </Link>
      </div>
    )
  }

  const handleReanalyze = async (params: Partial<PetroParams>) => {
    try {
      await reanalyze.mutateAsync(params)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Reanalysis failed.')
    }
  }

  const chips = [
    data.api_number && { label: 'API', value: data.api_number },
    data.operator && { label: 'Operator', value: data.operator },
    data.log_date && { label: 'Date', value: data.log_date },
    {
      label: 'Depth',
      value: `${data.depth_start.toFixed(0)}–${data.depth_stop.toFixed(0)} ft`,
    },
  ].filter(Boolean) as { label: string; value: string }[]

  return (
    <div className="h-screen w-screen flex flex-col bg-bg overflow-hidden">
      {/* Top header */}
      <header className="flex min-h-[3.5rem] shrink-0 items-center gap-4 border-b border-border surface-header-bar px-[clamp(0.75rem,4vw,1.25rem)] py-2">
        <button
          onClick={() => navigate('/dashboard')}
          className="text-text-dim hover:text-accent transition-colors"
          title="Back to dashboard"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
        <Logo size={26} showText={false} />
        <div className="flex flex-col min-w-0">
          <h1 className="font-display text-base uppercase tracking-widest text-text-bright truncate">
            {data.well_name}
          </h1>
          <div className="flex flex-wrap items-center gap-1.5">
            {chips.map((c) => (
              <span key={c.label} className="chip">
                <span className="text-text-dim">{c.label}</span>
                <span className="text-text-bright">{c.value}</span>
              </span>
            ))}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <ExportButton wellId={data.id} wellName={data.well_name} logDate={data.log_date} />
          <Button
            size="sm"
            variant="outline"
            onClick={() => openPanel('parameters')}
            icon={
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6">
                <path d="M21 12a9 9 0 1 1-9-9" />
                <polyline points="21 4 21 10 15 10" />
              </svg>
            }
          >
            Re-analyze
          </Button>
        </div>
      </header>

      {/* Main + resizable RHS */}
      <div
        ref={bodyRowRef}
        className="flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden"
      >
        {/* Log viewer (DepthRuler is inside) */}
        <section className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          {reanalyze.isPending && (
            <div className="absolute inset-0 z-30 flex items-center justify-center surface-scrim backdrop-blur-sm">
              <div className="panel flex items-center gap-3 px-6 py-4 text-text">
                <Spinner /> Re-running petrophysics + AI…
              </div>
            </div>
          )}
          <LogViewer
            ref={logRef}
            result={data.result_json}
            zones={data.zones}
            layoutStorageKey={data.id}
          />
        </section>

        {panelOpen ? (
          <>
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize analysis panel"
              className={clsx(
                'relative flex shrink-0 touch-none cursor-col-resize flex-col justify-center',
                'select-none border-l border-border surface-rail-soft hover:bg-accent/10',
              )}
              style={{
                flexBasis: 'clamp(8px, 2.25vw, 14px)',
                minWidth: '6px',
              }}
              onPointerDown={onRhsResizePointerDown}
            >
              <button
                type="button"
                aria-label="Collapse analysis panel"
                title="Hide analysis panel (\\)"
                onPointerDown={(ev) => ev.stopPropagation()}
                onClick={() => setPanelOpen(false)}
                className={clsx(
                  'pointer-events-auto z-10 mx-auto flex min-h-[2.75rem] w-[min(100%+4px,calc(1.75rem+4px))]',
                  'items-center justify-center rounded-sm border border-border bg-bg-panel',
                  'text-text-dim transition-colors hover:border-accent/60 hover:text-accent',
                )}
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-3 w-3"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden
                >
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </button>
            </div>

            <aside
              className="flex min-h-0 min-w-0 flex-shrink-0 flex-col overflow-hidden border-l border-border surface-column-muted"
              style={{ flex: `0 0 ${rhsWidthPx}px`, maxWidth: '100%' }}
            >
              <div className="shrink-0 border-b border-border bg-bg-deep">
                <div className="flex min-h-11 min-w-0">
                  {TABS.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setTab(t.id)}
                      className={clsx(
                        'min-w-0 flex-1 shrink px-2 py-3 font-mono text-[10px] uppercase tracking-widest transition-colors',
                        tab === t.id
                          ? 'border-b-2 border-accent surface-tab-subtle text-accent'
                          : 'text-text-dim hover:text-text',
                      )}
                    >
                      <span className="block truncate text-center">{t.label}</span>
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap gap-x-[clamp(0.75rem,5vw,1.5rem)] gap-y-1 border-t border-border-muted px-[clamp(0.6rem,4vw,1rem)] py-2 font-mono text-[10px] text-text-dim">
                  <span className="shrink-0">
                    Zones{' '}
                    <span className="tabular-nums text-text-bright">{data.zones.length}</span>
                  </span>
                  <span className="shrink-0">
                    Oil{' '}
                    <span className="tabular-nums text-text-bright">{data.oil_zone_count}</span>
                  </span>
                  <span className="shrink-0">
                    Gas{' '}
                    <span className="tabular-nums text-text-bright">{data.gas_zone_count}</span>
                  </span>
                </div>
              </div>

              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-[clamp(0.75rem,4vw,1.25rem)]">
                {tab === 'zones' && (
                  <>
                    {data.zones.length === 0 && (
                      <p className="py-12 text-center text-sm text-text-dim">
                        No HC zones detected with current parameters.
                      </p>
                    )}
                    {data.zones.map((z, i) => (
                      <ZoneCard
                        key={z.id}
                        zone={z}
                        index={i}
                        onJump={(depth) => logRef.current?.scrollToDepth(depth)}
                      />
                    ))}
                  </>
                )}

                {tab === 'crossplot' && (
                  <NDCrossplot result={data.result_json} zones={data.zones} wellId={data.id} />
                )}

                {tab === 'ai' && (
                  <AIInterpretation ai={data.ai_interpretation} onRetry={() => refetch()} />
                )}

                {tab === 'parameters' && (
                  <ParameterPanel
                    current={data.petro_params}
                    onSubmit={handleReanalyze}
                    loading={reanalyze.isPending}
                    rhoMaAuto={data.result_json?.stats?.rho_ma_auto}
                    rwAuto={data.result_json?.stats?.Rw_auto}
                  />
                )}
              </div>
            </aside>
          </>
        ) : (
          /* Collapsed rail */
          <aside
            style={{ flexBasis: 'clamp(2.25rem, 12vw, 3rem)' }}
            className={clsx(
              'flex min-w-[2rem] shrink-0 flex-col items-center gap-1 border-l border-border surface-column-muted',
              'py-[clamp(0.25rem,1.75vw,1.25rem)]',
            )}
          >
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => openPanel(t.id)}
                title={`${t.label} (open with \\)`}
                className={clsx(
                  'flex aspect-square w-[min(2rem,85%)] max-w-[2rem] items-center justify-center rounded transition-colors',
                  tab === t.id
                    ? 'border border-accent/40 bg-bg-deep text-accent'
                    : 'text-text-dim hover:bg-bg-deep hover:text-accent',
                )}
              >
                {t.icon}
              </button>
            ))}
          </aside>
        )}
      </div>
    </div>
  )
}
