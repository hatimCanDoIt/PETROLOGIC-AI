import clsx from 'clsx'

import Badge from '@/components/ui/Badge'
import { useChartPalette } from '@/theme/ThemeProvider'
import type { AIZoneInterpretation, HcZoneOut } from '@/types'

interface ZoneCardProps {
  zone: HcZoneOut
  index: number
  onJump: (zone: HcZoneOut) => void
  selected?: boolean
  cardRef?: (el: HTMLDivElement | null) => void
  /** Structured AI interpretation for this zone (matches ``zone_index`` from the API). */
  zoneAi?: AIZoneInterpretation | null
}

function metric(label: string, value: string, color?: string) {
  return (
    <div className="flex flex-col">
      <span className="font-mono text-[9px] uppercase tracking-widest text-text-dim">
        {label}
      </span>
      <span
        className={clsx('font-display text-sm', !color && 'text-text-bright')}
        style={color ? { color } : undefined}
      >
        {value}
      </span>
    </div>
  )
}

function ZoneAiNarrative({ z }: { z: AIZoneInterpretation }) {
  const confTone =
    z.fluid_type_confidence === 'high'
      ? 'reservoir'
      : z.fluid_type_confidence === 'medium'
        ? 'warning'
        : 'gas'
  return (
    <div className="mt-3 space-y-3 border-t border-border-muted pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[9px] uppercase tracking-widest text-text-dim">AI interpretation</span>
        <Badge tone={confTone}>{z.fluid_type_confidence}</Badge>
      </div>
      <p className="text-sm text-text leading-relaxed">{z.interpretation}</p>
      {z.producibility_assessment && (
        <p className="text-sm text-text-bright">
          <span className="font-mono text-[10px] uppercase tracking-widest text-text-dim mr-2">Producibility</span>
          {z.producibility_assessment}
        </p>
      )}
      {z.concerns?.length > 0 && (
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-oil mb-1">Concerns</p>
          <ul className="list-disc list-inside text-xs text-text space-y-0.5">
            {z.concerns.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      )}
      {z.recommended_actions?.length > 0 && (
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-accent mb-1">Recommended</p>
          <ul className="list-disc list-inside text-xs text-text space-y-0.5">
            {z.recommended_actions.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

export default function ZoneCard({ zone, index, onJump, selected, cardRef, zoneAi }: ZoneCardProps) {
  const palette = useChartPalette()
  const isOil = zone.zone_type === 'OIL'
  const tone = isOil ? 'oil' : 'gas'
  const accent = isOil ? palette.oil : palette.gas

  const activate = () => onJump(zone)

  return (
    <div
      ref={cardRef}
      role="button"
      tabIndex={0}
      onClick={activate}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          activate()
        }
      }}
      title="View this zone in the log"
      className={clsx(
        'panel relative cursor-pointer overflow-hidden p-4 transition-colors',
        'hover:bg-bg-elevated/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
        isOil ? 'border-oil/30' : 'border-gas/30',
        selected && (isOil ? 'bg-oil/10 ring-1 ring-oil/40' : 'bg-gas/10 ring-1 ring-gas/40'),
      )}
    >
      <div
        className="absolute inset-y-0 left-0 w-0.5"
        style={{ background: accent }}
      />
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Badge tone={tone}>{zone.zone_type}</Badge>
          <span className="font-mono text-[10px] text-text-dim">#{index + 1}</span>
          <span className="font-display text-sm text-text-bright">
            {zone.top_ft.toFixed(0)} – {zone.bot_ft.toFixed(0)} ft
          </span>
          <span className="font-mono text-[10px] text-text-dim">
            ({zone.thick_ft.toFixed(1)} ft)
          </span>
        </div>
        <span className="shrink-0 font-mono text-[9px] uppercase tracking-wider text-accent">
          View in log →
        </span>
      </div>

      <div className="mb-3 grid grid-cols-3 gap-3">
        {metric('Shc', `${zone.shc_pct.toFixed(1)}%`, palette.reservoir)}
        {metric('Sw', `${zone.sw_pct.toFixed(1)}%`, palette.sw)}
        {metric('ϕ_eff', `${zone.phi_pct.toFixed(1)}%`)}
        {metric('Vsh', `${zone.vsh_pct.toFixed(1)}%`)}
        {metric('Rt', `${zone.rt_mean.toFixed(1)} Ω·m`, palette.rt)}
        {metric('GR', `${zone.gr_mean.toFixed(0)} GAPI`)}
        {metric('PEF', zone.pef_mean.toFixed(2))}
        {metric('BVW', zone.bvw_mean.toFixed(3))}
        {metric('Lith', zone.lith_flag)}
      </div>

      {/* Producibility bar */}
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="font-mono text-[9px] uppercase tracking-widest text-text-dim">
            Producibility
          </span>
          <span className="font-mono text-[10px] text-text-bright">
            {zone.producible_pct.toFixed(0)}%
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-bg-deep">
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${Math.min(100, Math.max(0, zone.producible_pct))}%`,
              background: `linear-gradient(90deg, ${palette.water}, ${palette.reservoir})`,
            }}
          />
        </div>
      </div>

      {zoneAi && <ZoneAiNarrative z={zoneAi} />}

      {zone.ai_rationale && (
        <div className="mt-3 border-t border-border-muted pt-3">
          <span className="font-mono text-[9px] uppercase tracking-widest text-text-dim">Zone pick rationale</span>
          <p className="mt-1 text-sm leading-relaxed text-text">{zone.ai_rationale}</p>
          {zone.ai_confidence && (
            <p className="mt-2 font-mono text-[10px] text-text-dim">
              Confidence: {zone.ai_confidence}
            </p>
          )}
        </div>
      )}

      {zone.ai_note && !zoneAi && (
        <p className="mt-3 border-l border-accent/40 pl-3 text-xs italic text-text">
          {zone.ai_note}
        </p>
      )}
      {zone.ai_note && zoneAi && (
        <p className="mt-3 border-l border-border-muted pl-3 text-xs italic text-text-dim">{zone.ai_note}</p>
      )}
    </div>
  )
}
