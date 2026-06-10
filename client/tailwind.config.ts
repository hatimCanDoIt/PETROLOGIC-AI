import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: 'var(--c-bg)',
          panel: 'var(--c-panel)',
          deep: 'var(--c-deep)',
          elevated: 'var(--c-elevated)',
        },
        border: {
          DEFAULT: 'var(--c-border)',
          light: 'var(--c-border-light)',
          muted: 'var(--c-muted-border)',
        },
        accent: {
          DEFAULT: 'var(--c-accent)',
          dim: 'var(--c-accent-dim)',
        },
        oil: {
          DEFAULT: '#f5a623',
          dim: '#c4841c',
        },
        gas: {
          DEFAULT: '#ff3d5a',
          dim: '#cc2f47',
        },
        reservoir: {
          DEFAULT: '#39ff8a',
          dim: '#2acc6e',
        },
        water: {
          DEFAULT: '#3b82f6',
          dim: '#2563eb',
        },
        text: {
          DEFAULT: 'var(--c-text)',
          dim: 'var(--c-text-dim)',
          bright: 'var(--c-text-bright)',
          faint: 'color-mix(in srgb, var(--c-text-dim) 70%, transparent)',
          softer: 'color-mix(in srgb, var(--c-text-dim) 60%, transparent)',
          subtle80: 'color-mix(in srgb, var(--c-text-dim) 82%, transparent)',
        },
      },
      fontFamily: {
        sans: ["'Inter'", 'system-ui', 'sans-serif'],
        display: ["'Inter'", 'system-ui', 'sans-serif'],
        mono: ["'JetBrains Mono'", 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        'glow-accent': '0 0 22px color-mix(in srgb, var(--c-accent) 22%, transparent)',
        'glow-oil': '0 0 18px rgba(245, 166, 35, 0.18)',
        'glow-gas': '0 0 18px rgba(255, 61, 90, 0.18)',
      },
      backgroundImage: {
        'grid-faint':
          'linear-gradient(rgb(228 228 231 / 0.35) 1px, transparent 1px),linear-gradient(90deg,rgb(228 228 231 / 0.35) 1px, transparent 1px)',
      },
    },
  },
  plugins: [],
}

export default config
