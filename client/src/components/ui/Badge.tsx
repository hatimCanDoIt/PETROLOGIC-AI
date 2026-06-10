import type { HTMLAttributes, ReactNode } from 'react'
import clsx from 'clsx'

type Tone =
  | 'neutral'
  | 'accent'
  | 'oil'
  | 'gas'
  | 'reservoir'
  | 'warning'
  | 'danger'
  | 'water'

const TONE_CLS: Record<Tone, string> = {
  neutral: 'border-border bg-bg-panel text-text',
  accent: 'border-accent/40 bg-accent/10 text-accent',
  oil: 'border-oil/40 bg-oil/15 text-oil',
  gas: 'border-gas/40 bg-gas/15 text-gas',
  reservoir: 'border-reservoir/40 bg-reservoir/15 text-reservoir',
  water: 'border-water/40 bg-water/15 text-water',
  warning: 'border-oil/40 bg-oil/15 text-oil',
  danger: 'border-gas/40 bg-gas/15 text-gas',
}

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone
  children?: ReactNode
}

export default function Badge({
  tone = 'neutral',
  className,
  children,
  ...rest
}: BadgeProps) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded border font-semibold text-[10px] uppercase tracking-wider',
        TONE_CLS[tone],
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  )
}
