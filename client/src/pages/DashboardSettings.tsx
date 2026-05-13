import Card from '@/components/ui/Card'
import { useTheme, type ThemePreference } from '@/theme/ThemeProvider'

const OPTIONS: { value: ThemePreference; label: string; hint?: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'Same as OS', hint: 'Follows device appearance' },
]

export default function DashboardSettings() {
  const { preference, setPreference } = useTheme()

  return (
    <Card
      title="Appearance"
      subtitle="Applies everywhere you are signed in on this browser."
      className="max-w-xl"
    >
      <fieldset className="space-y-2">
        <legend className="sr-only">Colour theme</legend>
        {OPTIONS.map((opt) => {
          const id = `theme-${opt.value}`
          const selected = preference === opt.value
          return (
            <label
              key={opt.value}
              htmlFor={id}
              className={
                selected
                  ? 'flex cursor-pointer flex-col rounded-md border border-accent bg-accent/10 px-4 py-3'
                  : 'flex cursor-pointer flex-col rounded-md border border-border px-4 py-3 hover:border-border-light hover:bg-bg-deep'
              }
            >
              <div className="flex items-center gap-3">
                <input
                  id={id}
                  type="radio"
                  name="theme"
                  checked={selected}
                  onChange={() => setPreference(opt.value)}
                  className="h-3.5 w-3.5 border-border text-accent focus:ring-accent"
                />
                <span className="font-medium text-text">{opt.label}</span>
              </div>
              {opt.hint && <p className="mt-1 pl-7 text-xs text-text-dim">{opt.hint}</p>}
            </label>
          )
        })}
      </fieldset>

      <p className="mt-4 border-t border-border pt-4 text-xs text-text-dim font-mono">
        Log canvases use the chosen mode so grids and lith colours stay readable.
      </p>
    </Card>
  )
}
