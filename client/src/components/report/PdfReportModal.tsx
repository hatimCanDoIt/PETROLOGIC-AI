import { useEffect, useState } from 'react'

import Button from '@/components/ui/Button'
import Spinner from '@/components/ui/Spinner'
import { downloadWellPdf, fetchReportHtml } from '@/hooks/useWell'

interface PdfReportModalProps {
  open: boolean
  wellId: string
  wellName: string
  logDate?: string | null
  onClose: () => void
}

export default function PdfReportModal({
  open,
  wellId,
  wellName,
  logDate,
  onClose,
}: PdfReportModalProps) {
  const [html, setHtml] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [pdfLoading, setPdfLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setHtml(null)
    fetchReportHtml(wellId)
      .then((doc) => {
        if (!cancelled) setHtml(doc)
      })
      .catch(() => {
        if (!cancelled) setError('Could not load report preview.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, wellId])

  if (!open) return null

  const safe = wellName.replace(/[^a-z0-9_-]+/gi, '_')
  const pdfName = `${safe}_${logDate || 'report'}_petrologic.pdf`

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 surface-scrim backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Zone report preview"
    >
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-border bg-bg-panel shadow-2xl">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border-muted px-4 py-3">
          <div>
            <h2 className="font-display text-sm uppercase tracking-widest text-text-bright">
              Pay-zone report
            </h2>
            <p className="font-mono text-[10px] text-text-dim">{wellName}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              loading={pdfLoading}
              onClick={async () => {
                setPdfLoading(true)
                try {
                  await downloadWellPdf(wellId, pdfName)
                } catch {
                  setError('PDF download failed.')
                } finally {
                  setPdfLoading(false)
                }
              }}
            >
              Download PDF
            </Button>
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1.5 text-text-dim hover:bg-bg-elevated hover:text-text"
              aria-label="Close"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden bg-bg-deep">
          {loading && (
            <div className="flex h-64 items-center justify-center gap-2 text-text-dim">
              <Spinner /> Building report…
            </div>
          )}
          {error && !loading && (
            <p className="p-6 text-center text-sm text-gas">{error}</p>
          )}
          {html && !loading && (
            <iframe
              title="Pay-zone report"
              srcDoc={html}
              className="h-full min-h-[60vh] w-full border-0 bg-[#0d1117]"
              sandbox="allow-same-origin"
            />
          )}
        </div>
      </div>
    </div>
  )
}
