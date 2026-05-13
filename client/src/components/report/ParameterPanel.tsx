import { useState } from 'react'

import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import type { PetroParams } from '@/types'

interface ParameterPanelProps {
  current: Partial<PetroParams>
  onSubmit: (params: Partial<PetroParams>) => void | Promise<void>
  loading?: boolean
}

interface SliderProps {
  label: string
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  step?: number
  format?: (v: number) => string
  unit?: string
  logDisplay?: boolean
}

function Slider({ label, value, onChange, min, max, step = 0.01, format, unit, logDisplay }: SliderProps) {
  const display = format ? format(value) : value.toFixed(2)
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <label className="font-mono text-[10px] uppercase tracking-widest text-text-dim">
          {label}
        </label>
        <span className="font-mono text-xs text-text-bright">
          {display}
          {unit && <span className="text-text-dim ml-1">{unit}</span>}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-accent"
      />
      {logDisplay && (
        <p className="font-mono text-[9px] text-text-dim/70">
          log scale display · linear control
        </p>
      )}
    </div>
  )
}

const DEFAULTS: PetroParams = {
  rho_ma: 2.71,
  rho_fl: 1.0,
  Rw: 1.0,
  a: 1.0,
  m: 2.0,
  n: 2.0,
  GR_clean: null,
  GR_shale: null,
  Rt_cutoff: 15.0,
  Shc_cutoff: 0.35,
  phi_cutoff: 0.08,
  Vsh_cutoff: 0.40,
  Sw_producible: 0.60,
}

export default function ParameterPanel({ current, onSubmit, loading }: ParameterPanelProps) {
  const merge: PetroParams = { ...DEFAULTS, ...current } as PetroParams
  const [p, setP] = useState<PetroParams>(merge)

  const set = (k: keyof PetroParams, v: number | null) =>
    setP((prev) => ({ ...prev, [k]: v }))

  return (
    <div className="space-y-5">
      <p className="text-xs text-text-dim">
        Adjust petrophysical parameters and re-run. The deterministic engine and
        AI interpretation will both refresh.
      </p>

      <div className="space-y-4">
        <Slider
          label="Matrix density (ρₘₐ)"
          value={p.rho_ma}
          onChange={(v) => set('rho_ma', v)}
          min={1.8}
          max={3.2}
          step={0.01}
          unit="g/cc"
        />
        <Slider
          label="Formation water Rw"
          value={p.Rw}
          onChange={(v) => set('Rw', v)}
          min={0.01}
          max={10}
          step={0.01}
          unit="Ω·m"
          logDisplay
        />
        <Slider
          label="Archie a"
          value={p.a}
          onChange={(v) => set('a', v)}
          min={0.5}
          max={2.0}
          step={0.05}
        />
        <Slider
          label="Archie m"
          value={p.m}
          onChange={(v) => set('m', v)}
          min={1.5}
          max={3.0}
          step={0.05}
        />
        <Slider
          label="Archie n"
          value={p.n}
          onChange={(v) => set('n', v)}
          min={1.5}
          max={3.0}
          step={0.05}
        />
        <Slider
          label="Rt cutoff"
          value={p.Rt_cutoff}
          onChange={(v) => set('Rt_cutoff', v)}
          min={1}
          max={100}
          step={1}
          unit="Ω·m"
          format={(v) => v.toFixed(0)}
        />
        <Slider
          label="Shc cutoff"
          value={p.Shc_cutoff * 100}
          onChange={(v) => set('Shc_cutoff', v / 100)}
          min={10}
          max={70}
          step={5}
          unit="%"
          format={(v) => v.toFixed(0)}
        />

        <div className="grid grid-cols-2 gap-3">
          <Input
            label="GR Clean (auto if blank)"
            type="number"
            value={p.GR_clean ?? ''}
            onChange={(e) => set('GR_clean', e.target.value === '' ? null : parseFloat(e.target.value))}
            placeholder="auto"
          />
          <Input
            label="GR Shale (auto if blank)"
            type="number"
            value={p.GR_shale ?? ''}
            onChange={(e) => set('GR_shale', e.target.value === '' ? null : parseFloat(e.target.value))}
            placeholder="auto"
          />
        </div>
      </div>

      <Button
        size="lg"
        className="w-full"
        loading={loading}
        onClick={() => onSubmit(p)}
      >
        Re-analyze
      </Button>
    </div>
  )
}
