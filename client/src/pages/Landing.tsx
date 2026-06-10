import { useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'

import LandingTour from '@/components/landing/LandingTour'
import Logo from '@/components/layout/Logo'
import { REQUEST_ACCESS_MAILTO } from '@/utils/requestAccess'

const FEATURES = [
  {
    title: 'LAS File Analysis',
    body: 'Upload any LAS 2.0 file and we parse it instantly — gamma ray, resistivity, neutron, density, PEF, all mnemonic aliases supported.',
    accent: 'rgba(2,132,199,0.45)',
  },
  {
    title: 'Deterministic Engine',
    body: 'Archie water saturation, linear-Larionov Vsh, density porosity, neutron-density crossover, contiguous HC zone picks — all reproducible.',
    accent: 'rgba(245,166,35,0.65)',
  },
  {
    title: 'AI Interpretation',
    body: 'Claude reviews every zone like a senior petrophysicist — narrative, producibility assessment, data-quality flags, and concrete follow-ups.',
    accent: 'rgba(57,255,138,0.65)',
  },
]

export default function Landing() {
  const [menuOpen, setMenuOpen] = useState(false)
  return (
    <div className="relative min-h-screen overflow-hidden">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            'linear-gradient(rgb(226 232 240 / 0.45) 1px, transparent 1px),linear-gradient(90deg,rgb(226 232 240 / 0.45) 1px, transparent 1px)',
          backgroundSize: '60px 60px',
          animation: 'gridfade 16s ease-in-out infinite',
        }}
      />
      <div
        className="pointer-events-none absolute -top-40 -left-40 h-[40rem] w-[40rem] rounded-full"
        style={{
          background:
            'radial-gradient(circle, rgb(14 165 233 / 0.1) 0%, transparent 60%)',
          filter: 'blur(40px)',
        }}
      />
      <div
        className="pointer-events-none absolute -bottom-40 -right-40 h-[40rem] w-[40rem] rounded-full"
        style={{
          background:
            'radial-gradient(circle, rgba(245,166,35,0.12) 0%, transparent 60%)',
          filter: 'blur(60px)',
        }}
      />
      <style>
        {`@keyframes gridfade { 0%,100% { opacity: 0.55 } 50% { opacity: 0.95 } }`}
      </style>

      <header className="relative z-20 px-6 py-6 md:px-8">
        <div className="flex items-center justify-between">
          <Logo size={32} />
          <nav
            data-tour="nav-features"
            className="hidden md:flex items-center gap-6 text-xs font-medium uppercase tracking-widest text-text-dim"
          >
            <a href="#features" className="hover:text-accent transition-colors">
              Features
            </a>
            <a href="#methodology" className="hover:text-accent transition-colors">
              Methodology
            </a>
            <Link to="/login" className="hover:text-accent transition-colors">
              Sign in
            </Link>
            <a href={REQUEST_ACCESS_MAILTO} className="hover:text-accent transition-colors">
              Request access
            </a>
          </nav>
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            aria-controls="landing-mobile-menu"
            className="md:hidden rounded-md p-2 text-text-dim transition-colors hover:bg-bg-deep hover:text-text"
          >
            {menuOpen ? (
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M3 6h18M3 12h18M3 18h18" />
              </svg>
            )}
          </button>
        </div>
        {menuOpen && (
          <nav
            id="landing-mobile-menu"
            className="md:hidden mt-4 flex flex-col gap-1 rounded-lg border border-border bg-bg-panel p-2 text-xs font-medium uppercase tracking-widest text-text-dim shadow-lg"
          >
            <a
              href="#features"
              onClick={() => setMenuOpen(false)}
              className="rounded-md px-3 py-2.5 transition-colors hover:bg-bg-deep hover:text-accent"
            >
              Features
            </a>
            <a
              href="#methodology"
              onClick={() => setMenuOpen(false)}
              className="rounded-md px-3 py-2.5 transition-colors hover:bg-bg-deep hover:text-accent"
            >
              Methodology
            </a>
            <Link
              to="/login"
              className="rounded-md px-3 py-2.5 transition-colors hover:bg-bg-deep hover:text-accent"
            >
              Sign in
            </Link>
            <a
              href={REQUEST_ACCESS_MAILTO}
              onClick={() => setMenuOpen(false)}
              className="rounded-md px-3 py-2.5 transition-colors hover:bg-bg-deep hover:text-accent"
            >
              Request access
            </a>
          </nav>
        )}
      </header>

      <main className="relative z-10 mx-auto flex max-w-6xl flex-col items-center px-6 py-16 text-center">
        <motion.h1
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.05 }}
          className="mt-8 font-display text-5xl md:text-7xl tracking-[0.05em] text-text-bright"
        >
          AI-Powered{' '}
          <span
            className="text-accent"
            style={{ textShadow: '0 12px 40px rgb(2 132 199 / 0.18)' }}
          >
            Well Log
          </span>{' '}
          Analysis
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.15 }}
          className="mt-6 max-w-2xl text-lg text-text"
        >
          Detect hydrocarbons. Prove producibility. PETROLOGIC AI parses your LAS files, runs a
          deterministic petrophysical engine, then asks Claude to interpret what the numbers
          actually mean.
        </motion.p>

        <div data-tour="cta-register">
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.25 }}
            className="mt-10 flex flex-col sm:flex-row items-center gap-3"
          >
            <a
              href={REQUEST_ACCESS_MAILTO}
              className="inline-flex h-12 items-center justify-center rounded-md bg-accent px-7 font-semibold tracking-wider text-white shadow-glow-accent transition-all hover:bg-accent-dim"
            >
              Request Access
            </a>
            <Link
              to="/login"
              className="inline-flex h-12 items-center justify-center rounded-md border border-accent bg-transparent px-7 font-semibold tracking-wider text-accent transition-all hover:bg-accent/10"
            >
              Sign In
            </Link>
          </motion.div>
        </div>

        <section
          id="features"
          data-tour="section-features"
          className="mt-24 grid w-full grid-cols-1 gap-5 md:grid-cols-3"
        >
          {FEATURES.map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 + i * 0.1, duration: 0.6 }}
              className="panel relative overflow-hidden p-6 text-left"
            >
              <div
                className="absolute inset-x-0 top-0 h-px"
                style={{
                  background: `linear-gradient(90deg, transparent, ${f.accent}, transparent)`,
                }}
              />
              <h3 className="font-display text-base uppercase tracking-widest text-text-bright">
                {f.title}
              </h3>
              <p className="mt-3 text-sm text-text">{f.body}</p>
            </motion.div>
          ))}
        </section>

        <section
          id="methodology"
          data-tour="methodology-section"
          className="mt-24 w-full panel p-8 text-left"
        >
          <h2 className="font-display text-xl uppercase tracking-widest text-accent">How it works</h2>
          <ol className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-4 text-xs font-semibold uppercase tracking-widest text-text-dim">
            <li>
              <span className="text-accent">01 ·</span> Upload LAS file
            </li>
            <li>
              <span className="text-accent">02 ·</span> Deterministic engine computes Sw, Vsh, ϕ,
              picks zones
            </li>
            <li>
              <span className="text-accent">03 ·</span> Claude interprets the numbers
            </li>
            <li>
              <span className="text-accent">04 ·</span> Validate with your petrophysicist
            </li>
          </ol>
        </section>
      </main>

      <footer className="relative z-10 border-t border-border mt-16 px-6 py-6 text-center text-xs text-text-dim">
        PETROLOGIC AI &middot; {new Date().getFullYear()}
      </footer>

      <LandingTour />
    </div>
  )
}
