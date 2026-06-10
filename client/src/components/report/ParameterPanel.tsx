import { useState } from 'react'

import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import type { PetroParams } from '@/types'

interface ParameterPanelProps {
  current: Partial<PetroParams>
  onSubmit: (params: Partial<PetroParams>) => void | Promise<void>
  loading?: boolean
  // Diagnostics from the result so we can show what auto-estimation used
  rhoMaAuto?: boolean
  rwAuto?: boolean
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
        <label className="text-[10px] font-semibold uppercase tracking-widest text-text-dim">
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
        <p className="text-[9px] text-text-faint">
          log scale display · linear control
        </p>
      )}
    </div>
  )
}

const DEFAULTS: PetroParams = {
  rho_ma: null,
  rho_fl: 1.0,
  Rw: null,
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

// Local form state — separate the "auto" override from the numeric value so
// the user can type a number, clear it, or revert to auto without ambiguity.
interface FormState {
  rho_ma_auto: boolean
  rho_ma_input: string
  Rw_auto: boolean
  Rw_input: string
  a: number
  m: number
  n: number
  Rt_cutoff: number
  Shc_cutoff: number
  GR_clean: string
  GR_shale: string
}

function num(s: string): number | null {
  if (s === '' || s == null) return null
  const v = parseFloat(s)
  return Number.isFinite(v) ? v : null
}

interface AutoFieldProps {
  label: string
  unit?: string
  auto: boolean
  value: string
  resolvedValue?: number | null
  onAutoChange: (auto: boolean) => void
  onValueChange: (v: string) => void
  step?: string
  min?: string
  max?: string
  placeholder?: string
}

function AutoField({
  label,
  unit,
  auto,
  value,
  resolvedValue,
  onAutoChange,
  onValueChange,
  step,
  min,
  max,
  placeholder,
}: AutoFieldProps) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <label className="text-[10px] font-semibold uppercase tracking-widest text-text-dim">
          {label}
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={auto}
            onChange={(e) => onAutoChange(e.target.checked)}
            className="accent-accent"
          />
          <span className="text-[10px] font-semibold uppercase tracking-widest text-text-dim">
            auto
          </span>
        </label>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={auto ? '' : value}
          onChange={(e) => onValueChange(e.target.value)}
          step={step}
          min={min}
          max={max}
          placeholder={placeholder ?? 'auto'}
          disabled={auto}
          className="flex-1 bg-bg-deep border border-border rounded px-2 py-1.5 font-mono text-xs text-text-bright disabled:text-text-softer disabled:cursor-not-allowed focus:outline-none focus:border-accent"
        />
        {unit && (
          <span className="font-mono text-[10px] text-text-dim shrink-0">{unit}</span>
        )}
      </div>
      {auto && resolvedValue != null && Number.isFinite(resolvedValue) && (
        <p className="text-[9px] text-accent/80">
          auto-estimated: {resolvedValue.toFixed(3)}
          {unit ? ` ${unit}` : ''}
        </p>
      )}
    </div>
  )
}

export default function ParameterPanel({
  current,
  onSubmit,
  loading,
  rhoMaAuto,
  rwAuto,
}: ParameterPanelProps) {
  const merged: PetroParams = { ...DEFAULTS, ...current } as PetroParams

  const [form, setForm] = useState<FormState>(() => ({
    rho_ma_auto: rhoMaAuto ?? merged.rho_ma == null,
    rho_ma_input:
      merged.rho_ma != null ? merged.rho_ma.toFixed(3) : '',
    Rw_auto: rwAuto ?? merged.Rw == null,
    Rw_input: merged.Rw != null ? merged.Rw.toFixed(3) : '',
    a: merged.a,
    m: merged.m,
    n: merged.n,
    Rt_cutoff: merged.Rt_cutoff,
    Shc_cutoff: merged.Shc_cutoff,
    GR_clean: merged.GR_clean != null ? String(merged.GR_clean) : '',
    GR_shale: merged.GR_shale != null ? String(merged.GR_shale) : '',
  }))

  const setForm_ = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((prev) => ({ ...prev, [k]: v }))

  const handleSubmit = () => {
    const payload: Partial<PetroParams> = {
      // null explicitly clears the stored value → re-trigger auto on the server
      rho_ma: form.rho_ma_auto ? null : num(form.rho_ma_input),
      Rw: form.Rw_auto ? null : num(form.Rw_input),
      a: form.a,
      m: form.m,
      n: form.n,
      Rt_cutoff: form.Rt_cutoff,
      Shc_cutoff: form.Shc_cutoff,
      GR_clean: num(form.GR_clean),
      GR_shale: num(form.GR_shale),
    }
    onSubmit(payload)
  }

  return (
    <div className="space-y-5">
      <p className="text-xs text-text-dim">
        Matrix density and Rw are estimated directly from the logs unless you
        provide an override. Re-running refreshes both the deterministic
        engine and the AI interpretation.
      </p>

      <div className="space-y-4">
        <AutoField
          label="Matrix density (ρₘₐ)"
          unit="g/cc"
          auto={form.rho_ma_auto}
          value={form.rho_ma_input}
          resolvedValue={merged.rho_ma}
          onAutoChange={(v) => setForm_('rho_ma_auto', v)}
          onValueChange={(v) => setForm_('rho_ma_input', v)}
          step="0.01"
          min="1.8"
          max="3.2"
        />
        <AutoField
          label="Formation water Rw"
          unit="Ω·m"
          auto={form.Rw_auto}
          value={form.Rw_input}
          resolvedValue={merged.Rw}
          onAutoChange={(v) => setForm_('Rw_auto', v)}
          onValueChange={(v) => setForm_('Rw_input', v)}
          step="0.001"
          min="0.01"
          max="10"
        />
        <Slider
          label="Archie a"
          value={form.a}
          onChange={(v) => setForm_('a', v)}
          min={0.5}
          max={2.0}
          step={0.05}
        />
        <Slider
          label="Archie m"
          value={form.m}
          onChange={(v) => setForm_('m', v)}
          min={1.5}
          max={3.0}
          step={0.05}
        />
        <Slider
          label="Archie n"
          value={form.n}
          onChange={(v) => setForm_('n', v)}
          min={1.5}
          max={3.0}
          step={0.05}
        />
        <Slider
          label="Rt cutoff"
          value={form.Rt_cutoff}
          onChange={(v) => setForm_('Rt_cutoff', v)}
          min={1}
          max={100}
          step={1}
          unit="Ω·m"
          format={(v) => v.toFixed(0)}
        />
        <Slider
          label="Shc cutoff"
          value={form.Shc_cutoff * 100}
          onChange={(v) => setForm_('Shc_cutoff', v / 100)}
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
            value={form.GR_clean}
            onChange={(e) => setForm_('GR_clean', e.target.value)}
            placeholder="auto"
          />
          <Input
            label="GR Shale (auto if blank)"
            type="number"
            value={form.GR_shale}
            onChange={(e) => setForm_('GR_shale', e.target.value)}
            placeholder="auto"
          />
        </div>
      </div>

      <Button size="lg" className="w-full" loading={loading} onClick={handleSubmit}>
        Re-analyze
      </Button>
    </div>
  )
}
