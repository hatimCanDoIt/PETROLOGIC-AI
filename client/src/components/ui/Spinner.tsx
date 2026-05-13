interface SpinnerProps {
  size?: number
  className?: string
}

export default function Spinner({ size = 16, className }: SpinnerProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 50 50"
      className={className}
      style={{ animation: 'spin 0.9s linear infinite' }}
      aria-label="loading"
    >
      <circle
        cx="25"
        cy="25"
        r="20"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray="80 200"
      />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </svg>
  )
}
