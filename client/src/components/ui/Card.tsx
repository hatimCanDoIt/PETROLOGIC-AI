import type { HTMLAttributes, ReactNode } from 'react'
import clsx from 'clsx'

interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: ReactNode
  subtitle?: ReactNode
  action?: ReactNode
  glow?: boolean
}

export default function Card({
  title,
  subtitle,
  action,
  glow,
  children,
  className,
  ...rest
}: CardProps) {
  return (
    <div
      className={clsx(
        'panel p-5 relative',
        glow && 'shadow-glow-accent',
        className,
      )}
      {...rest}
    >
      {(title || action) && (
        <div className="flex items-start justify-between gap-4 mb-3">
          <div>
            {title && (
              <h3 className="text-text-bright font-display text-sm uppercase tracking-widest">
                {title}
              </h3>
            )}
            {subtitle && (
              <p className="text-text-dim text-xs mt-1 font-mono">{subtitle}</p>
            )}
          </div>
          {action}
        </div>
      )}
      {children}
    </div>
  )
}
