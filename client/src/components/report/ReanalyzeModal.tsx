import { useEffect, useRef } from 'react'

import ParameterPanel from '@/components/report/ParameterPanel'
import Button from '@/components/ui/Button'
import type { PetroParams } from '@/types'

interface ReanalyzeModalProps {
  open: boolean
  onClose: () => void
  current: Partial<PetroParams>
  onSubmit: (params: Partial<PetroParams>) => void | Promise<void>
  loading?: boolean
  rhoMaAuto?: boolean
  rwAuto?: boolean
}

export default function ReanalyzeModal({
  open,
  onClose,
  current,
  onSubmit,
  loading,
  rhoMaAuto,
  rwAuto,
}: ReanalyzeModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (!open || !panelRef.current) return
    const focusable = panelRef.current.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    )
    focusable?.focus()
  }, [open])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center p-4 surface-scrim backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reanalyze-modal-title"
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Close"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        className="relative z-10 flex max-h-[min(90vh,840px)] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-border bg-bg-panel shadow-glow-accent"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-4">
          <h2 id="reanalyze-modal-title" className="font-display text-sm uppercase tracking-widest text-text-bright">
            Re-analyze parameters
          </h2>
          <Button type="button" variant="ghost" size="sm" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <ParameterPanel
            current={current}
            onSubmit={onSubmit}
            loading={loading}
            rhoMaAuto={rhoMaAuto}
            rwAuto={rwAuto}
          />
        </div>
      </div>
    </div>
  )
}
