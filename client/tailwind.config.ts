import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: '#03080f',
          panel: '#081422',
          deep: '#050d17',
        },
        border: {
          DEFAULT: '#162840',
          light: '#1e3a5f',
        },
        accent: {
          DEFAULT: '#00d4ff',
          dim: '#0099bb',
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
          DEFAULT: '#b8d4e8',
          dim: '#4a6680',
          bright: '#e8f4ff',
        },
      },
      fontFamily: {
        mono: ["'Space Mono'", 'monospace'],
        sans: ["'IBM Plex Sans'", 'sans-serif'],
        display: ["'Orbitron'", 'monospace'],
      },
      boxShadow: {
        'glow-accent': '0 0 18px rgba(0, 212, 255, 0.18)',
        'glow-oil': '0 0 18px rgba(245, 166, 35, 0.18)',
        'glow-gas': '0 0 18px rgba(255, 61, 90, 0.18)',
      },
      backgroundImage: {
        'grid-faint':
          'linear-gradient(rgba(22,40,64,0.18) 1px, transparent 1px),linear-gradient(90deg,rgba(22,40,64,0.18) 1px, transparent 1px)',
      },
    },
  },
  plugins: [],
}

export default config
