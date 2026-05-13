import { useEffect } from 'react'
import { Link } from 'react-router-dom'

import Sidebar from '@/components/layout/Sidebar'
import TopBar from '@/components/layout/TopBar'
import UploadZone from '@/components/upload/UploadZone'
import Badge from '@/components/ui/Badge'
import Card from '@/components/ui/Card'
import Spinner from '@/components/ui/Spinner'
import { useAuth } from '@/hooks/useAuth'
import { useDeleteWell, useWellStats, useWells } from '@/hooks/useWell'
import type { WellSummary } from '@/types'

function StatCard({
  label,
  value,
  hint,
  tone = 'accent',
}: {
  label: string
  value: string
  hint?: string
  tone?: 'accent' | 'oil' | 'gas' | 'reservoir'
}) {
  const toneColor = {
    accent: 'text-accent',
    oil: 'text-oil',
    gas: 'text-gas',
    reservoir: 'text-reservoir',
  }[tone]
  return (
    <Card>
      <p className="font-mono text-[10px] uppercase tracking-widest text-text-dim">
        {label}
      </p>
      <p className={`font-display text-3xl mt-2 ${toneColor}`}>{value}</p>
      {hint && <p className="text-xs text-text-dim mt-1">{hint}</p>}
    </Card>
  )
}

function todayString() {
  return new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

function WellRow({ well, onDelete }: { well: WellSummary; onDelete: (id: string) => void }) {
  return (
    <tr className="border-b border-border hover:bg-bg-deep transition-colors">
      <td className="py-3 px-4">
        <Link to={`/report/${well.id}`} className="text-accent font-medium hover:underline">
          {well.well_name}
        </Link>
        {well.field && (
          <p className="text-xs text-text-dim font-mono mt-0.5">{well.field}</p>
        )}
      </td>
      <td className="py-3 px-4 font-mono text-xs text-text-dim">
        {well.api_number || '—'}
      </td>
      <td className="py-3 px-4 font-mono text-xs">
        {well.depth_start.toFixed(0)} – {well.depth_stop.toFixed(0)} ft
      </td>
      <td className="py-3 px-4">
        <div className="flex items-center gap-1">
          {well.oil_zone_count > 0 && (
            <Badge tone="oil">{well.oil_zone_count} oil</Badge>
          )}
          {well.gas_zone_count > 0 && (
            <Badge tone="gas">{well.gas_zone_count} gas</Badge>
          )}
          {well.zone_count === 0 && (
            <span className="text-xs text-text-dim font-mono">none</span>
          )}
        </div>
      </td>
      <td className="py-3 px-4 font-mono text-xs text-text-dim">
        {new Date(well.created_at).toLocaleDateString()}
      </td>
      <td className="py-3 px-4">
        <div className="flex items-center justify-end gap-2">
          <Link
            to={`/report/${well.id}`}
            className="text-text-dim hover:text-accent transition-colors"
            title="View report"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </Link>
          <button
            onClick={() => {
              if (confirm(`Delete well "${well.well_name}"? This cannot be undone.`)) {
                onDelete(well.id)
              }
            }}
            className="text-text-dim hover:text-gas transition-colors"
            title="Delete"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            </svg>
          </button>
        </div>
      </td>
    </tr>
  )
}

export default function Dashboard() {
  const { user, fetchMe } = useAuth()
  const wells = useWells()
  const stats = useWellStats()
  const del = useDeleteWell()

  useEffect(() => {
    // Refresh user record on first mount (e.g. after OAuth login)
    if (user && !user.email) {
      fetchMe().catch(() => undefined)
    }
  }, [user, fetchMe])

  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <TopBar
          title={`Welcome back, ${user?.name || 'petro engineer'}`}
          subtitle={todayString()}
        />

        <div className="px-6 py-6 space-y-6">
          {/* Stat row */}
          <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              label="Total Wells"
              value={stats.data ? String(stats.data.total_wells) : '—'}
              tone="accent"
            />
            <StatCard
              label="HC Zones Found"
              value={stats.data ? String(stats.data.total_hc_zones) : '—'}
              tone="oil"
            />
            <StatCard
              label="Avg Porosity"
              value={
                stats.data && stats.data.total_hc_zones > 0
                  ? `${stats.data.avg_porosity_pct.toFixed(1)}%`
                  : '—'
              }
              tone="reservoir"
            />
            <StatCard
              label="Avg Sw"
              value={
                stats.data && stats.data.total_hc_zones > 0
                  ? `${stats.data.avg_sw_pct.toFixed(1)}%`
                  : '—'
              }
              tone="gas"
            />
          </section>

          {/* Upload */}
          <UploadZone />

          {/* Recent wells */}
          <Card title="Recent Wells" subtitle="Click a well to open its report">
            {wells.isLoading ? (
              <div className="flex items-center gap-2 py-8 text-text-dim">
                <Spinner /> Loading wells…
              </div>
            ) : wells.isError ? (
              <p className="text-gas py-8">Could not load wells.</p>
            ) : !wells.data?.length ? (
              <div className="py-12 text-center">
                <svg
                  viewBox="0 0 64 64"
                  className="mx-auto h-16 w-16 text-text-dim/60"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <path d="M8 8v48M20 8v48M32 8v48M44 8v48M56 8v48" />
                  <path d="M14 16 Q18 22 14 28 Q10 34 14 40 L14 50" stroke="#00d4ff" />
                </svg>
                <p className="mt-4 text-text-dim">No wells yet.</p>
                <p className="text-sm text-accent mt-1">Upload your first LAS file above.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left">
                      <th className="py-3 px-4 font-mono text-[10px] uppercase tracking-widest text-text-dim">
                        Well Name
                      </th>
                      <th className="py-3 px-4 font-mono text-[10px] uppercase tracking-widest text-text-dim">
                        API
                      </th>
                      <th className="py-3 px-4 font-mono text-[10px] uppercase tracking-widest text-text-dim">
                        Depth Range
                      </th>
                      <th className="py-3 px-4 font-mono text-[10px] uppercase tracking-widest text-text-dim">
                        HC Zones
                      </th>
                      <th className="py-3 px-4 font-mono text-[10px] uppercase tracking-widest text-text-dim">
                        Date
                      </th>
                      <th className="py-3 px-4 font-mono text-[10px] uppercase tracking-widest text-text-dim text-right">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {wells.data.map((w) => (
                      <WellRow
                        key={w.id}
                        well={w}
                        onDelete={(id) =>
                          del.mutate(id, {
                            onError: () => alert('Failed to delete well.'),
                          })
                        }
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      </main>
    </div>
  )
}
