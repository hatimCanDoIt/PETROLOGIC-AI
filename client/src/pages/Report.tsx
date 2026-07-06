import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import clsx from 'clsx'

import CrossplotWorkspace from '@/components/report/CrossplotWorkspace'
import ExportButton from '@/components/report/ExportButton'
import LogAssistantChat from '@/components/report/LogAssistantChat'
import PdfReportModal from '@/components/report/PdfReportModal'
import ReanalyzeModal from '@/components/report/ReanalyzeModal'
import ZoneCard from '@/components/report/ZoneCard'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import Logo from '@/components/layout/Logo'
import SkeletonTrack from '@/components/ui/SkeletonTrack'
import Spinner from '@/components/ui/Spinner'
import { useToast } from '@/components/ui/Toast'
import LogViewer, { type LogViewerHandle } from '@/components/tracks/LogViewer'
import {
  useAddZone,
  useReanalyzeWell,
  useWell,
  type AssistantContext,
} from '@/hooks/useWell'
import type { AIInterpretation, DepthInterval, HcZoneOut, PetroParams, ProposedZone } from '@/types'

type ReportView = 'logs' | 'crossplots'

const RHS_PANEL_LS_KEY = 'petrologic:reportRhsWidthPx'
const MAIN_MIN_WIDTH_PX = 200
const RHS_PREF_MIN_WIDTH_PX = 220
// Prefer this wide; min/max clamp to viewport so log + RHS never overfill.
const RHS_WIDTH_MAX_RATIO = 0.55

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n))
}

/** Match structured AI interpretation to a zone card (API uses ``zone_index``). */
function zoneInterpretationFor(ai: AIInterpretation | null, zoneIndex: number) {
  const list = ai?.zone_interpretations
  if (!list?.length) return null
  return list.find((z) => z.zone_index === zoneIndex) ?? list[zoneIndex] ?? null
}

function WellLevelAISummary({ ai }: { ai: AIInterpretation | null }) {
  const [open, setOpen] = useState(false)
  if (!ai) return null

  if (ai.error) {
    return (
      <div className="mb-4 rounded-lg border border-border-muted bg-bg-deep/80 p-4 text-sm">
        <Badge tone="warning">AI interpretation unavailable</Badge>
        <p className="mt-2 text-text">{ai.reason || ai.error}</p>
      </div>
    )
  }

  const hasWellBlock =
    ai.well_narrative ||
    ai.reservoir_context ||
    ai.lithology_summary ||
    (ai.data_quality_flags && ai.data_quality_flags.length > 0) ||
    ai.overall_confidence

  if (!hasWellBlock) return null

  return (
    <div className="mb-4 rounded-lg border border-border-muted bg-bg-deep/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-widest text-text-dim transition-colors hover:bg-bg-deep hover:text-text"
      >
        <span>Well-level AI summary</span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="shrink-0 text-text-dim"
          style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 0.15s' }}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="space-y-4 border-t border-border-muted px-3 pb-4 pt-3 text-sm">
          {ai.well_narrative && (
            <div>
              <h4 className="font-display text-[10px] uppercase tracking-widest text-accent mb-1.5">Well narrative</h4>
              <p className="text-text leading-relaxed">{ai.well_narrative}</p>
            </div>
          )}
          {ai.reservoir_context && (
            <div>
              <h4 className="font-display text-[10px] uppercase tracking-widest text-text-bright mb-1.5">Context</h4>
              <p className="text-text leading-relaxed">{ai.reservoir_context}</p>
            </div>
          )}
          {ai.lithology_summary && (
            <div>
              <h4 className="font-display text-[10px] uppercase tracking-widest text-text-bright mb-1.5">Lithology</h4>
              <p className="text-text leading-relaxed">{ai.lithology_summary}</p>
            </div>
          )}
          {ai.data_quality_flags && ai.data_quality_flags.length > 0 && (
            <div>
              <h4 className="font-display text-[10px] uppercase tracking-widest text-text-bright mb-2">Data quality</h4>
              <div className="space-y-2">
                {ai.data_quality_flags.map((f, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 border-l-2 pl-2 py-0.5"
                    style={{
                      borderColor: f.severity === 'critical' ? 'var(--gas, #ff3d5a)' : '#f5a623',
                    }}
                  >
                    <Badge tone={f.severity === 'critical' ? 'gas' : 'warning'}>{f.severity}</Badge>
                    <div>
                      <p className="font-mono text-[9px] uppercase tracking-wider text-text-dim">{f.curve}</p>
                      <p className="text-xs text-text">{f.message}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {(ai.overall_confidence || ai.overall_confidence_reason) && (
            <div className="flex flex-wrap items-start justify-between gap-2 border-t border-border-muted pt-3">
              <div>
                <h4 className="font-display text-[10px] uppercase tracking-widest text-text-bright">Overall confidence</h4>
                {ai.overall_confidence_reason && (
                  <p className="mt-1 text-xs text-text">{ai.overall_confidence_reason}</p>
                )}
              </div>
              {ai.overall_confidence && (
                <Badge
                  tone={
                    ai.overall_confidence === 'high'
                      ? 'reservoir'
                      : ai.overall_confidence === 'medium'
                        ? 'warning'
                        : 'gas'
                  }
                >
                  {ai.overall_confidence}
                </Badge>
              )}
            </div>
          )}
          <p className="text-[10px] text-text-dim leading-snug border-t border-border-muted pt-3">
            {ai.disclaimer ||
              'This AI-generated interpretation requires validation by a licensed petrophysicist before use in any well or business decision.'}
          </p>
        </div>
      )}
    </div>
  )
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
  const toast = useToast()
  const { data, isLoading, isError } = useWell(wellId)
  const reanalyze = useReanalyzeWell(wellId)
  const logRef = useRef<LogViewerHandle | null>(null)
  const bodyRowRef = useRef<HTMLDivElement | null>(null)
  const zoneCardRefs = useRef(new Map<string, HTMLDivElement>())
  const [activeZoneId, setActiveZoneId] = useState<string | null>(null)
  const [view, setView] = useState<ReportView>('logs')
  const [panelOpen, setPanelOpen] = useState(true)
  const [reanalyzeOpen, setReanalyzeOpen] = useState(false)
  const [pdfOpen, setPdfOpen] = useState(false)
  const [depthInterval, setDepthInterval] = useState<DepthInterval | null>(null)
  const [assistantContext, setAssistantContext] = useState<AssistantContext | null>(null)
  const addZone = useAddZone(wellId)
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

  const jumpToZone = useCallback((zone: { id: string; top_ft: number; bot_ft: number }) => {
    const mid = (zone.top_ft + zone.bot_ft) / 2
    logRef.current?.scrollToDepth(mid)
    setActiveZoneId(zone.id)
  }, [])

  const selectZoneFromLog = useCallback((zoneId: string) => {
    setActiveZoneId(zoneId)
    setView('logs')
    setPanelOpen(true)
    requestAnimationFrame(() => {
      zoneCardRefs.current.get(zoneId)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    })
  }, [])

  const viewZoneInLogs = useCallback(
    (zoneId: string) => {
      const zone = data?.zones.find((z) => z.id === zoneId)
      setView('logs')
      setPanelOpen(true)
      if (zone) jumpToZone(zone)
      else setActiveZoneId(zoneId)
    },
    [data?.zones, jumpToZone],
  )

  const registerZoneCardRef = useCallback((zoneId: string, el: HTMLDivElement | null) => {
    if (el) zoneCardRefs.current.set(zoneId, el)
    else zoneCardRefs.current.delete(zoneId)
  }, [])

  const openZoneChat = useCallback((zone: HcZoneOut) => {
    setActiveZoneId(zone.id)
    setAssistantContext({ type: 'zone', zoneId: zone.id })
    setPanelOpen(true)
    setView('logs')
  }, [])

  const explainDepthInterval = useCallback(() => {
    if (!depthInterval) return
    const lo = Math.min(depthInterval.top_ft, depthInterval.bot_ft)
    const hi = Math.max(depthInterval.top_ft, depthInterval.bot_ft)
    if (hi - lo < 1) return
    setAssistantContext({ type: 'interval', interval: { top_ft: lo, bot_ft: hi } })
    setPanelOpen(true)
  }, [depthInterval])

  const handleAddProposedZone = useCallback(
    async (proposal: ProposedZone) => {
      if (!wellId) return
      try {
        const detail = await addZone.mutateAsync({
          zone_type: proposal.zone_type,
          top_ft: proposal.top_ft,
          bot_ft: proposal.bot_ft,
          ai_rationale: proposal.rationale,
          ai_confidence: proposal.confidence ?? undefined,
        })
        const added = detail.zones[detail.zones.length - 1]
        if (added) {
          setActiveZoneId(added.id)
          setAssistantContext({ type: 'zone', zoneId: added.id })
        }
        toast.success(
          `Added ${proposal.zone_type.toLowerCase()} zone ${proposal.top_ft.toFixed(0)}–${proposal.bot_ft.toFixed(0)} ft.`,
        )
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not add zone.')
      }
    },
    [wellId, addZone, toast],
  )

  const assistantZone =
    assistantContext?.type === 'zone'
      ? data?.zones.find((z) => z.id === assistantContext.zoneId)
      : null

  const intervalThickness =
    depthInterval != null
      ? Math.abs(depthInterval.bot_ft - depthInterval.top_ft)
      : 0

  // Keyboard shortcut: `\` toggles the zones panel (log view only).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return
      if (e.key === '\\' && view === 'logs') {
        e.preventDefault()
        setPanelOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [view])

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
      let raf = 0
      const latestXRef = { current: e.clientX }

      const flush = () => {
        raf = 0
        const row = bodyRowRef.current
        if (!row) return
        const bw = row.getBoundingClientRect().width
        const { min, max } = rhsWidthBounds(bw)
        const delta = latestXRef.current - startX
        setRhsWidthPx(clamp(startW - delta, min, max))
      }

      const onMove = (ev: PointerEvent) => {
        latestXRef.current = ev.clientX
        if (raf) return
        raf = requestAnimationFrame(flush)
      }

      const onUp = () => {
        if (raf) cancelAnimationFrame(raf)
        raf = 0
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
        document.body.style.removeProperty('cursor')

        const row = bodyRowRef.current
        let w = startW
        if (row) {
          const bw = row.getBoundingClientRect().width
          const { min, max } = rhsWidthBounds(bw)
          const delta = latestXRef.current - startX
          w = clamp(startW - delta, min, max)
        }
        const rounded = Math.round(w)
        try {
          localStorage.setItem(RHS_PANEL_LS_KEY, String(rounded))
        } catch {
          /* ignore quota / private mode */
        }
        setRhsWidthPx(rounded)
      }

      document.body.style.cursor = 'col-resize'
      window.addEventListener('pointermove', onMove, { passive: true })
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
          <span className="text-xs text-text-dim">Loading well…</span>
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
            <SkeletonTrack label="PHIE" />
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

  const handleReanalyze = async (
    params: Partial<PetroParams> & { ai_tune_models?: boolean },
  ) => {
    try {
      await reanalyze.mutateAsync(params)
      setReanalyzeOpen(false)
      toast.success('Re-analysis complete.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Reanalysis failed.')
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
    {
      label: 'Engine',
      value: ((): string => {
        const model = data.result_json?.zone_picker?.model ?? 'Sonnet'
        switch (data.analysis_mode) {
          case 'llm':
            return `Numpy + LLM pay zones (${model})`
          case 'numpy_only':
            return 'Numpy only (no LLM)'
          default:
            return 'Numpy + LLM interpret'
        }
      })(),
    },
  ].filter(Boolean) as { label: string; value: string }[]

  return (
    <div className="h-screen w-full flex flex-col bg-bg overflow-hidden">
      {/* Top header */}
      <header className="flex min-h-[3.5rem] shrink-0 items-center gap-4 border-b border-border surface-header-bar px-[clamp(0.75rem,4vw,1.25rem)] py-2">
        <button
          onClick={() => navigate('/dashboard')}
          className="rounded p-1 text-text-dim hover:text-accent transition-colors"
          title="Back to dashboard"
          aria-label="Back to dashboard"
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
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          <div
            className="flex rounded-md border border-border-muted p-0.5"
            role="tablist"
            aria-label="Report view"
          >
            <button
              type="button"
              role="tab"
              aria-selected={view === 'logs'}
              onClick={() => setView('logs')}
              className={clsx(
                'rounded px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest transition-colors',
                view === 'logs'
                  ? 'bg-accent/15 text-accent'
                  : 'text-text-dim hover:text-text-bright',
              )}
            >
              Log interpretation
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === 'crossplots'}
              onClick={() => setView('crossplots')}
              className={clsx(
                'rounded px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest transition-colors',
                view === 'crossplots'
                  ? 'bg-accent/15 text-accent'
                  : 'text-text-dim hover:text-text-bright',
              )}
            >
              Crossplot analysis
            </button>
          </div>
          <ExportButton wellId={data.id} wellName={data.well_name} logDate={data.log_date} />
          <Button size="sm" variant="secondary" onClick={() => setPdfOpen(true)}>
            PDF report
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setReanalyzeOpen(true)}
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

      {/* Main workspace */}
      <div
        ref={bodyRowRef}
        className="flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden"
      >
        {view === 'crossplots' ? (
          <CrossplotWorkspace
            result={data.result_json}
            zones={data.zones}
            wellId={data.id}
            activeZoneId={activeZoneId}
            onViewZoneInLogs={viewZoneInLogs}
            onZoneFocus={setActiveZoneId}
          />
        ) : (
          <>
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
                curvesAvailable={data.curves_available}
                layoutStorageKey={data.id}
                activeZoneId={activeZoneId}
                onZoneSelect={selectZoneFromLog}
                depthInterval={depthInterval}
                onDepthIntervalChange={setDepthInterval}
              />
              {depthInterval && intervalThickness >= 1 && (
                <div className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 flex-wrap items-center justify-center gap-2">
                  <div className="panel flex flex-wrap items-center gap-2 px-3 py-2 shadow-lg">
                    <span className="font-mono text-[10px] text-text-dim">
                      {Math.min(depthInterval.top_ft, depthInterval.bot_ft).toFixed(0)}–
                      {Math.max(depthInterval.top_ft, depthInterval.bot_ft).toFixed(0)} ft
                    </span>
                    <Button size="sm" onClick={explainDepthInterval}>
                      Explain with AI
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setDepthInterval(null)}
                    >
                      Clear
                    </Button>
                  </div>
                </div>
              )}
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
                <div className="flex min-h-11 items-center border-b border-border-muted px-[clamp(0.6rem,4vw,1rem)]">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-accent">
                    Pay zones &amp; interpretation
                  </span>
                </div>

                <div className="flex flex-wrap gap-x-[clamp(0.75rem,5vw,1.5rem)] gap-y-1 px-[clamp(0.6rem,4vw,1rem)] py-2 text-[10px] font-medium text-text-dim">
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
                <WellLevelAISummary ai={data.ai_interpretation} />
                {assistantContext && wellId && (
                  <LogAssistantChat
                    wellId={wellId}
                    context={assistantContext}
                    zone={assistantZone}
                    onClose={() => setAssistantContext(null)}
                    onAddZone={handleAddProposedZone}
                    addingZone={addZone.isPending}
                  />
                )}
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
                    selected={activeZoneId === z.id}
                    onJump={jumpToZone}
                    cardRef={(el) => registerZoneCardRef(z.id, el)}
                    zoneAi={zoneInterpretationFor(data.ai_interpretation, i)}
                    onChat={openZoneChat}
                    chatActive={
                      assistantContext?.type === 'zone' && assistantContext.zoneId === z.id
                    }
                  />
                ))}
              </div>
            </aside>
          </>
        ) : (
          <aside
            style={{ flexBasis: 'clamp(2.25rem, 12vw, 3rem)' }}
            className={clsx(
              'flex min-w-[2rem] shrink-0 flex-col items-center gap-1 border-l border-border surface-column-muted',
              'py-[clamp(0.25rem,1.75vw,1.25rem)]',
            )}
          >
            <button
              type="button"
              onClick={() => setPanelOpen(true)}
              title="Show pay zones panel (\\)"
              className="flex aspect-square w-[min(2rem,85%)] max-w-[2rem] items-center justify-center rounded border border-accent/40 bg-bg-deep text-accent"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6">
                <rect x="4" y="5" width="16" height="4" rx="1" />
                <rect x="4" y="11" width="16" height="3" rx="1" opacity="0.6" />
                <rect x="4" y="16" width="16" height="3" rx="1" opacity="0.35" />
              </svg>
            </button>
          </aside>
        )}
          </>
        )}
      </div>

      <ReanalyzeModal
        open={reanalyzeOpen}
        onClose={() => setReanalyzeOpen(false)}
        current={data.petro_params}
        onSubmit={handleReanalyze}
        loading={reanalyze.isPending}
        rhoMaAuto={data.result_json?.stats?.rho_ma_auto}
        rwAuto={data.result_json?.stats?.Rw_auto}
      />
      <PdfReportModal
        open={pdfOpen}
        wellId={data.id}
        wellName={data.well_name}
        logDate={data.log_date}
        onClose={() => setPdfOpen(false)}
      />
    </div>
  )
}
