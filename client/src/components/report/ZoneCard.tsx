import clsx from 'clsx'

import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import { useChartPalette } from '@/theme/ThemeProvider'
import type { HcZoneOut } from '@/types'

interface ZoneCardProps {
  zone: HcZoneOut
  index: number
  onJump: (depth: number) => void
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

export default function ZoneCard({ zone, index, onJump }: ZoneCardProps) {
  const palette = useChartPalette()
  const isOil = zone.zone_type === 'OIL'
  const tone = isOil ? 'oil' : 'gas'
  const accent = isOil ? palette.oil : palette.gas

  return (
    <div
      className={clsx(
        'panel p-4 relative overflow-hidden',
        isOil ? 'border-oil/30' : 'border-gas/30',
      )}
    >
      <div
        className="absolute inset-y-0 left-0 w-0.5"
        style={{ background: accent }}
      />
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Badge tone={tone}>{zone.zone_type}</Badge>
          <span className="font-mono text-[10px] text-text-dim">#{index + 1}</span>
          <span className="font-display text-sm text-text-bright">
            {zone.top_ft.toFixed(0)} – {zone.bot_ft.toFixed(0)} ft
          </span>
          <span className="font-mono text-[10px] text-text-dim">
            ({zone.thick_ft.toFixed(1)} ft)
          </span>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onJump(zone.top_ft)}
          title="Jump to zone in the log viewer"
        >
          Jump
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-3">
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
        <div className="flex items-center justify-between mb-1">
          <span className="font-mono text-[9px] uppercase tracking-widest text-text-dim">
            Producibility
          </span>
          <span className="font-mono text-[10px] text-text-bright">
            {zone.producible_pct.toFixed(0)}%
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-bg-deep overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${Math.min(100, Math.max(0, zone.producible_pct))}%`,
              background: `linear-gradient(90deg, ${palette.water}, ${palette.reservoir})`,
            }}
          />
        </div>
      </div>

      {zone.ai_note && (
        <p className="mt-3 text-xs text-text border-l border-accent/40 pl-3 italic">
          {zone.ai_note}
        </p>
      )}
    </div>
  )
}
