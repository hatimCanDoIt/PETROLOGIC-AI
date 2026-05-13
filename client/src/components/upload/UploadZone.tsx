import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDropzone } from 'react-dropzone'
import clsx from 'clsx'

import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Spinner from '@/components/ui/Spinner'
import { useUploadWell } from '@/hooks/useWell'

type Stage = 'idle' | 'parsing' | 'petro' | 'ai' | 'done'

const STAGE_LABEL: Record<Stage, string> = {
  idle: 'Analyze Well',
  parsing: 'Parsing LAS…',
  petro: 'Running Petrophysics…',
  ai: 'Getting AI Interpretation…',
  done: 'Done',
}

const STAGE_ORDER: Stage[] = ['parsing', 'petro', 'ai', 'done']

export default function UploadZone() {
  const navigate = useNavigate()
  const upload = useUploadWell()
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [rhoMa, setRhoMa] = useState<string>('2.71')
  const [rw, setRw] = useState<string>('1.0')
  const [a, setA] = useState<string>('1.0')
  const [m, setM] = useState<string>('2.0')
  const [n, setN] = useState<string>('2.0')
  const [stage, setStage] = useState<Stage>('idle')

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
    setStage('parsing')

    // Drive the progress label forward as we wait for the server. The actual
    // server work is sequential so we just show the next label after a short
    // delay so the user sees motion.
    const advance = () => {
      setStage((s) => {
        const idx = STAGE_ORDER.indexOf(s)
        if (idx < 0 || idx === STAGE_ORDER.length - 1) return s
        return STAGE_ORDER[idx + 1]
      })
    }
    const t1 = setTimeout(advance, 800)
    const t2 = setTimeout(advance, 2200)

    try {
      const result = await upload.mutateAsync({
        file,
        rho_ma: numOrUndef(rhoMa),
        Rw: numOrUndef(rw),
        a: numOrUndef(a),
        m: numOrUndef(m),
        n: numOrUndef(n),
      })
      setStage('done')
      navigate(`/report/${result.id}`)
    } catch (err) {
      setStage('idle')
      setError(err instanceof Error ? err.message : 'Upload failed.')
    } finally {
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }

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
          className="font-mono text-[10px] uppercase tracking-widest text-text-dim hover:text-accent transition-colors"
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

      {showAdvanced && (
        <div className="mt-5 grid grid-cols-2 md:grid-cols-5 gap-3">
          <Input label="ρₘₐ (g/cc)" value={rhoMa} onChange={(e) => setRhoMa(e.target.value)} />
          <Input label="Rw (Ω·m)" value={rw} onChange={(e) => setRw(e.target.value)} />
          <Input label="Archie a" value={a} onChange={(e) => setA(e.target.value)} />
          <Input label="Archie m" value={m} onChange={(e) => setM(e.target.value)} />
          <Input label="Archie n" value={n} onChange={(e) => setN(e.target.value)} />
        </div>
      )}

      {error && (
        <p role="alert" className="mt-4 text-sm font-mono text-gas">
          {error}
        </p>
      )}

      <div className="mt-5 flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-mono text-text-dim">
          {stage !== 'idle' && stage !== 'done' && <Spinner size={12} />}
          <span>{STAGE_LABEL[stage]}</span>
        </div>
        <Button
          disabled={!file || (stage !== 'idle' && stage !== 'done')}
          loading={stage !== 'idle' && stage !== 'done'}
          onClick={submit}
          size="lg"
        >
          {stage === 'idle' || stage === 'done' ? 'Analyze Well' : STAGE_LABEL[stage]}
        </Button>
      </div>
    </div>
  )
}
