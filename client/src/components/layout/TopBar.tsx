import type { ReactNode } from 'react'

interface TopBarProps {
  title: ReactNode
  subtitle?: ReactNode
  right?: ReactNode
  chips?: { label: string; value: ReactNode }[]
}

export default function TopBar({ title, subtitle, right, chips }: TopBarProps) {
  return (
    <header className="border-b border-border bg-bg-panel/80 backdrop-blur px-6 py-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-lg uppercase tracking-widest text-text-bright">
          {title}
        </h1>
        {subtitle && <p className="text-sm text-text-dim">{subtitle}</p>}
        {chips && chips.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 mt-1">
            {chips.map((c) => (
              <span key={c.label} className="chip">
                <span className="text-text-dim">{c.label}</span>
                <span className="text-text-bright">{c.value}</span>
              </span>
            ))}
          </div>
        )}
      </div>
      {right && <div className="flex items-center gap-2">{right}</div>}
    </header>
  )
}
