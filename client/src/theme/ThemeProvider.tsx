import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import { buildChartPalette, type ChartPalette, type ThemeMode } from './chartPalette'

const STORAGE_KEY = 'petrologic-theme'

export type ThemePreference = 'light' | 'dark' | 'system'

function readPreference(): ThemePreference {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {
    /* ignore */
  }
  return 'system'
}

function systemIsDark() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function resolveThemeMode(pref: ThemePreference): ThemeMode {
  if (pref === 'system') return systemIsDark() ? 'dark' : 'light'
  return pref
}

function applyDocumentClass(mode: ThemeMode) {
  document.documentElement.classList.toggle('dark', mode === 'dark')
  document.documentElement.style.colorScheme = mode === 'dark' ? 'dark' : 'light'
}

interface ThemeContextValue {
  preference: ThemePreference
  resolved: ThemeMode
  setPreference: (p: ThemePreference) => void
  chart: ChartPalette
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>('system')
  const [systemEpoch, setSystemEpoch] = useState(0)

  useEffect(() => {
    setPreferenceState(readPreference())
  }, [])

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setSystemEpoch((n) => n + 1)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const resolved = useMemo(
    () => resolveThemeMode(preference),
    [preference, systemEpoch],
  )

  const chart = useMemo(() => buildChartPalette(resolved), [resolved])

  useEffect(() => {
    applyDocumentClass(resolved)
    const meta = document.getElementById('theme-color-meta') as HTMLMetaElement | null
    if (meta) meta.content = resolved === 'dark' ? '#09090b' : '#ffffff'
  }, [resolved])

  const setPreference = useCallback((p: ThemePreference) => {
    setPreferenceState(p)
    try {
      localStorage.setItem(STORAGE_KEY, p)
    } catch {
      /* ignore */
    }
    applyDocumentClass(resolveThemeMode(p))
  }, [])

  const value = useMemo(
    () => ({ preference, resolved, setPreference, chart }),
    [preference, resolved, setPreference, chart],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}

export function useChartPalette() {
  return useTheme().chart
}
