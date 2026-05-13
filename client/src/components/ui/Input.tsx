import { forwardRef, useId, type InputHTMLAttributes } from 'react'
import clsx from 'clsx'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  hint?: string
}

const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, hint, className, id, ...rest },
  ref,
) {
  const generated = useId()
  const inputId = id || generated
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label
          htmlFor={inputId}
          className="text-xs uppercase tracking-wider text-text-dim font-mono"
        >
          {label}
        </label>
      )}
      <input
        ref={ref}
        id={inputId}
        className={clsx(
          'h-10 px-3 rounded-md bg-bg-deep border text-text placeholder:text-text-softer',
          'transition-colors focus:outline-none focus:border-accent',
          error ? 'border-gas' : 'border-border',
          className,
        )}
        {...rest}
      />
      {error ? (
        <span className="text-xs text-gas font-mono">{error}</span>
      ) : hint ? (
        <span className="text-xs text-text-dim font-mono">{hint}</span>
      ) : null}
    </div>
  )
})

export default Input
