import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import clsx from 'clsx'

import Spinner from './Spinner'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline'
type Size = 'sm' | 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
  icon?: ReactNode
}

const VARIANT_CLS: Record<Variant, string> = {
  primary:
    'bg-accent text-bg hover:bg-accent-dim focus-visible:ring-accent shadow-glow-accent',
  secondary:
    'bg-bg-panel text-text border border-border hover:border-accent hover:text-accent',
  outline:
    'bg-transparent text-accent border border-accent hover:bg-accent/10',
  ghost: 'bg-transparent text-text-dim hover:text-text hover:bg-bg-panel',
  danger:
    'bg-gas/15 text-gas border border-gas/40 hover:bg-gas/25',
}

const SIZE_CLS: Record<Size, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-10 px-4 text-sm',
  lg: 'h-12 px-6 text-base',
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    icon,
    children,
    className,
    disabled,
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-md font-medium tracking-wide transition-all',
        'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-current',
        VARIANT_CLS[variant],
        SIZE_CLS[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner size={size === 'sm' ? 12 : 14} /> : icon}
      <span>{children}</span>
    </button>
  )
})

export default Button
