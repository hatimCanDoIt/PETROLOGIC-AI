import { useRef, useState } from 'react'
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

type Tab = 'zones' | 'crossplot' | 'ai' | 'parameters'

const TABS: { id: Tab; label: string }[] = [
  { id: 'zones', label: 'Zones' },
  { id: 'crossplot', label: 'Crossplot' },
  { id: 'ai', label: 'AI Insight' },
  { id: 'parameters', label: 'Parameters' },
]

export default function Report() {
  const { wellId } = useParams<{ wellId: string }>()
  const navigate = useNavigate()
  const { data, isLoading, isError, refetch } = useWell(wellId)
  const reanalyze = useReanalyzeWell(wellId)
  const logRef = useRef<LogViewerHandle | null>(null)
  const [tab, setTab] = useState<Tab>('zones')

  if (isLoading) {
    return (
      <div className="h-screen flex flex-col">
        <div className="h-[60px] border-b border-border bg-bg-panel/80 flex items-center px-6 gap-4">
          <Logo size={28} />
          <span className="text-text-dim font-mono text-xs">Loading well…</span>
        </div>
        <div className="flex-1 flex items-stretch">
          <div className="w-[80px] bg-bg-deep border-r border-border" />
          <div className="flex gap-px bg-border">
            <SkeletonTrack label="GR" />
            <SkeletonTrack label="RT" />
            <SkeletonTrack label="NPHI/DPHI" />
            <SkeletonTrack label="Sw" />
            <SkeletonTrack label="PEF" />
          </div>
          <div className="flex-1 panel-deep" />
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
      <header className="h-[60px] shrink-0 border-b border-border bg-bg-panel/85 backdrop-blur flex items-center px-5 gap-4">
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
            onClick={() => setTab('parameters')}
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

      {/* Three-panel body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Log viewer (DepthRuler is inside) */}
        <div className="flex-1 min-w-0 relative">
          {reanalyze.isPending && (
            <div className="absolute inset-0 z-30 bg-bg/70 backdrop-blur-sm flex items-center justify-center">
              <div className="panel px-6 py-4 flex items-center gap-3 text-text">
                <Spinner /> Re-running petrophysics + AI…
              </div>
            </div>
          )}
          <LogViewer
            ref={logRef}
            result={data.result_json}
            zones={data.zones}
          />
        </div>

        {/* Right analysis panel */}
        <aside className="w-[380px] shrink-0 border-l border-border bg-bg-panel/60 flex flex-col">
          <div className="border-b border-border bg-bg-deep">
            <div className="flex">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={clsx(
                    'flex-1 py-3 font-mono text-[10px] uppercase tracking-widest transition-colors',
                    tab === t.id
                      ? 'text-accent border-b-2 border-accent bg-bg-panel/40'
                      : 'text-text-dim hover:text-text',
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {tab === 'zones' && (
              <>
                {data.zones.length === 0 && (
                  <p className="text-sm text-text-dim text-center py-12">
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
              <NDCrossplot result={data.result_json} zones={data.zones} />
            )}

            {tab === 'ai' && (
              <AIInterpretation
                ai={data.ai_interpretation}
                onRetry={() => refetch()}
              />
            )}

            {tab === 'parameters' && (
              <ParameterPanel
                current={data.petro_params}
                onSubmit={handleReanalyze}
                loading={reanalyze.isPending}
              />
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}
