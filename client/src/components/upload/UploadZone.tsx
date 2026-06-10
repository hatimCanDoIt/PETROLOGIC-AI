import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDropzone } from 'react-dropzone'
import clsx from 'clsx'

import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Spinner from '@/components/ui/Spinner'
import { useUploadWell } from '@/hooks/useWell'
import type { AnalysisMode } from '@/types'

type Stage = 'idle' | 'uploading' | 'analyzing' | 'done'

const ANALYZING_LABEL: Record<AnalysisMode, string> = {
  deterministic: 'Running petrophysics + AI interpretation…',
  llm: 'Computing curves, Sonnet picking zones…',
}

const MODE_OPTIONS: { value: AnalysisMode; title: string; blurb: string }[] = [
  {
    value: 'deterministic',
    title: 'Numpy + LLM interpret',
    blurb:
      'Deterministic petrophysics picks the zones and computes every curve; Claude only narrates them. Fast, reproducible, defensible.',
  },
  {
    value: 'llm',
    title: 'Numpy + LLM pay zones',
    blurb:
      'Numpy computes the curves; Claude Sonnet reads them and picks the pay zones. Per-zone numbers stay deterministic.',
  },
]

export default function UploadZone() {
  const navigate = useNavigate()
  const upload = useUploadWell()
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)
  // Blank = server estimates from the LAS (see petrophysics._auto_rw / _auto_rho_ma).
  const [rhoMa, setRhoMa] = useState<string>('')
  const [rw, setRw] = useState<string>('')
  const [a, setA] = useState<string>('1.0')
  const [m, setM] = useState<string>('2.0')
  const [n, setN] = useState<string>('2.0')
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>('deterministic')
  const [stage, setStage] = useState<Stage>('idle')
  const [uploadPct, setUploadPct] = useState(0)

  const onDrop = useCallback((accepted: File[]) => {
    setError(null)
    if (accepted.length) {
      setFile(accepted[0])
    }
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'text/plain': ['.las', '.LAS'] },
    multiple: false,
    maxSize: 50 * 1024 * 1024,
  })

  const numOrUndef = (v: string) => {
    if (v.trim() === '') return undefined
    const n = parseFloat(v)
    return Number.isFinite(n) ? n : undefined
  }

  const submit = async () => {
    if (!file) return
    setError(null)
    setStage('uploading')
    setUploadPct(0)

    try {
      const result = await upload.mutateAsync({
        file,
        rho_ma: numOrUndef(rhoMa),
        Rw: numOrUndef(rw),
        a: numOrUndef(a),
        m: numOrUndef(m),
        n: numOrUndef(n),
        analysis_mode: analysisMode,
        onUploadProgress: (pct) => {
          setUploadPct(pct)
          // Bytes are on the server — the rest of the wait is analysis.
          if (pct >= 100) setStage('analyzing')
        },
      })
      setStage('done')
      navigate(`/report/${result.id}`)
    } catch (err) {
      setStage('idle')
      setError(err instanceof Error ? err.message : 'Upload failed.')
    }
  }

  const busy = stage === 'uploading' || stage === 'analyzing'
  const statusLabel =
    stage === 'uploading'
      ? `Uploading… ${uploadPct}%`
      : stage === 'analyzing'
        ? ANALYZING_LABEL[analysisMode]
        : ''

  return (
    <div className="panel p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-sm uppercase tracking-widest text-text-bright">
            Upload a LAS File
          </h2>
          <p className="text-xs text-text-dim mt-1">
            LAS 2.0 · max 50&nbsp;MB · we never store your file as-is
          </p>
        </div>
        <button
          onClick={() => setShowAdvanced((v) => !v)}
          className="text-[10px] font-semibold uppercase tracking-widest text-text-dim hover:text-accent transition-colors"
        >
          {showAdvanced ? 'Hide' : 'Show'} Advanced Parameters
        </button>
      </div>

      <div
        {...getRootProps()}
        className={clsx(
          'mt-4 flex flex-col items-center justify-center rounded-lg border-2 border-dashed py-12 px-6 cursor-pointer transition-all',
          isDragActive
            ? 'border-accent bg-accent/5 shadow-glow-accent'
            : 'border-border hover:border-accent/60 hover:bg-bg-deep',
        )}
      >
        <input {...getInputProps()} />
        <svg viewBox="0 0 24 24" className="h-10 w-10 text-accent" fill="none" stroke="currentColor" strokeWidth="1.4">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
        </svg>
        <p className="mt-3 text-sm text-text">
          {isDragActive
            ? 'Drop the LAS file here…'
            : 'Drag & drop a .LAS file, or click to browse'}
        </p>
        {file && (
          <p className="mt-2 font-mono text-xs text-accent">
            {file.name} · {(file.size / 1024).toFixed(1)} KB
          </p>
        )}
      </div>

      <div className="mt-5">
        <div className="text-[10px] font-semibold uppercase tracking-widest text-text-dim mb-2">
          Analysis method
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {MODE_OPTIONS.map((opt) => {
            const selected = analysisMode === opt.value
            return (
              <label
                key={opt.value}
                className={clsx(
                  'cursor-pointer rounded-lg border p-3 transition-all',
                  selected
                    ? 'border-accent bg-accent/5 shadow-glow-accent'
                    : 'border-border hover:border-accent/60 hover:bg-bg-deep',
                )}
              >
                <input
                  type="radio"
                  name="analysis-mode"
                  value={opt.value}
                  checked={selected}
                  onChange={() => setAnalysisMode(opt.value)}
                  className="sr-only"
                />
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className={clsx(
                      'inline-block h-3 w-3 rounded-full border',
                      selected
                        ? 'border-accent bg-accent shadow-glow-accent'
                        : 'border-border',
                    )}
                  />
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-text-bright">
                    {opt.title}
                  </span>
                </div>
                <p className="mt-1 ml-5 text-xs text-text-dim">{opt.blurb}</p>
              </label>
            )
          })}
        </div>
      </div>

      {showAdvanced && (
        <div className="mt-5 space-y-3">
          <p className="text-xs text-text-dim">
            Leave ρₘₐ and Rw blank to estimate from the log. Only fill these if you
            want to override the automatic values.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Input
              label="ρₘₐ (g/cc)"
              value={rhoMa}
              onChange={(e) => setRhoMa(e.target.value)}
              placeholder="auto"
            />
            <Input
              label="Rw (Ω·m)"
              value={rw}
              onChange={(e) => setRw(e.target.value)}
              placeholder="auto"
            />
            <Input label="Archie a" value={a} onChange={(e) => setA(e.target.value)} />
            <Input label="Archie m" value={m} onChange={(e) => setM(e.target.value)} />
            <Input label="Archie n" value={n} onChange={(e) => setN(e.target.value)} />
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-4 text-sm text-gas">
          {error}
        </p>
      )}

      {busy && (
        <div className="mt-5" role="status" aria-live="polite">
          <div className="flex items-center gap-2 text-xs text-text-dim tabular-nums">
            <Spinner size={12} />
            <span>{statusLabel}</span>
          </div>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-bg-elevated">
            <div
              className={clsx(
                'h-full rounded-full bg-accent transition-all duration-200',
                stage === 'analyzing' && 'animate-pulse',
              )}
              style={{ width: stage === 'uploading' ? `${uploadPct}%` : '100%' }}
            />
          </div>
        </div>
      )}

      <div className="mt-5 flex items-center justify-end">
        <Button disabled={!file || busy} loading={busy} onClick={submit} size="lg">
          {busy ? statusLabel : 'Analyze Well'}
        </Button>
      </div>
    </div>
  )
}
