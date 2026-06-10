import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import clsx from 'clsx'

type ToastTone = 'success' | 'error' | 'info'

interface ToastItem {
  id: number
  tone: ToastTone
  message: string
}

interface ToastApi {
  success: (message: string) => void
  error: (message: string) => void
  info: (message: string) => void
}

const ToastContext = createContext<ToastApi | null>(null)

const TONE_STYLE: Record<ToastTone, { bar: string; icon: ReactNode }> = {
  success: {
    bar: 'bg-reservoir',
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-reservoir" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M20 6L9 17l-5-5" />
      </svg>
    ),
  },
  error: {
    bar: 'bg-gas',
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-gas" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v4M12 16h.01" />
      </svg>
    ),
  },
  info: {
    bar: 'bg-accent',
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-accent" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 16v-4M12 8h.01" />
      </svg>
    ),
  },
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const idRef = useRef(0)
  const timersRef = useRef(new Map<number, ReturnType<typeof setTimeout>>())

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
    const timer = timersRef.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timersRef.current.delete(id)
    }
  }, [])

  const push = useCallback(
    (tone: ToastTone, message: string) => {
      const id = ++idRef.current
      setToasts((prev) => [...prev.slice(-3), { id, tone, message }])
      const ttl = tone === 'error' ? 7000 : 4500
      timersRef.current.set(
        id,
        setTimeout(() => dismiss(id), ttl),
      )
    },
    [dismiss],
  )

  const api = useMemo<ToastApi>(
    () => ({
      success: (m) => push('success', m),
      error: (m) => push('error', m),
      info: (m) => push('info', m),
    }),
    [push],
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className="toast-enter pointer-events-auto relative flex items-start gap-3 overflow-hidden rounded-lg border border-border bg-bg-panel py-3 pl-3 pr-2 shadow-lg"
          >
            <span aria-hidden className={clsx('absolute left-0 top-0 h-full w-0.5', TONE_STYLE[t.tone].bar)} />
            {TONE_STYLE[t.tone].icon}
            <p className="min-w-0 flex-1 text-sm leading-snug text-text">{t.message}</p>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss notification"
              className="rounded p-1 text-text-dim transition-colors hover:bg-bg-deep hover:text-text"
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
