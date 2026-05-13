interface LogoProps {
  size?: number
  showText?: boolean
  className?: string
}

export default function Logo({ size = 28, showText = true, className }: LogoProps) {
  return (
    <div className={`inline-flex items-center gap-2 ${className ?? ''}`}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 64 64"
        fill="none"
        aria-label="PETROLOGIC logo"
      >
        <rect width="64" height="64" rx="10" fill="var(--c-panel)" stroke="var(--c-border)" />
        {/* depth track ruler */}
        <line x1="10" y1="12" x2="10" y2="52" stroke="var(--c-border-light)" strokeWidth="1" />
        <line x1="22" y1="12" x2="22" y2="52" stroke="var(--c-border-light)" strokeWidth="1" />
        <line x1="34" y1="12" x2="34" y2="52" stroke="var(--c-border-light)" strokeWidth="1" />
        <line x1="46" y1="12" x2="46" y2="52" stroke="var(--c-border-light)" strokeWidth="1" />
        {/* GR-like curve */}
        <path
          d="M16 14 Q22 22 16 30 Q10 38 18 46 L18 52"
          stroke="#39ff8a"
          strokeWidth="2"
          fill="none"
        />
        {/* resistivity-like curve */}
        <path
          d="M34 14 Q30 24 38 32 Q44 40 36 50"
          stroke="var(--c-accent)"
          strokeWidth="2"
          fill="none"
        />
      </svg>
      {showText && (
        <span className="font-display tracking-[0.2em] text-accent text-base">
          PETROLOGIC
        </span>
      )}
    </div>
  )
}
