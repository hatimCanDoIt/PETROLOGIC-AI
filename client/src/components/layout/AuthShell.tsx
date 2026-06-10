import { type ReactNode } from 'react'

import Logo from './Logo'

interface AuthShellProps {
  title: string
  subtitle?: string
  children: ReactNode
  footer?: ReactNode
}

export default function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: AuthShellProps) {
  return (
    <div className="relative min-h-screen flex items-center justify-center px-4 overflow-hidden">
      <div
        className="pointer-events-none absolute inset-0 grid-bg opacity-30"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute top-1/2 left-1/2 h-[36rem] w-[36rem] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          background:
            'radial-gradient(circle, rgb(2 132 199 / 0.09) 0%, transparent 65%)',
          filter: 'blur(40px)',
        }}
        aria-hidden
      />
      <div className="relative z-10 w-full max-w-[400px]">
        <div className="flex flex-col items-center mb-8">
          <Logo size={36} />
          <p className="mt-3 text-[10px] font-medium uppercase tracking-[0.35em] text-text-dim">
            Petrophysical · Well · Log · Analysis
          </p>
        </div>
        <div className="panel p-8">
          <h1 className="font-display text-xl uppercase tracking-widest text-text-bright text-center">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-2 text-center text-sm text-text-dim">{subtitle}</p>
          )}
          <div className="mt-6">{children}</div>
        </div>
        {footer && (
          <div className="mt-6 text-center text-xs text-text-dim">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
