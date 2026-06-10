import { useEffect, useRef, useState } from 'react'
import { NavLink, useLocation, useSearchParams } from 'react-router-dom'
import clsx from 'clsx'

import { useAuth } from '@/hooks/useAuth'
import Logo from './Logo'

type DashboardTab = 'overview' | 'wells' | 'settings'

interface NavItem {
  to: string
  tab: DashboardTab
  label: string
  icon: JSX.Element
}

const ICON_CLASS = 'h-4 w-4 shrink-0'

const NAV: NavItem[] = [
  {
    tab: 'overview',
    to: '/dashboard',
    label: 'Dashboard',
    icon: (
      <svg viewBox="0 0 24 24" className={ICON_CLASS} fill="none" stroke="currentColor" strokeWidth="1.6">
        <rect x="3" y="3" width="7" height="9" rx="1.5" />
        <rect x="14" y="3" width="7" height="5" rx="1.5" />
        <rect x="14" y="12" width="7" height="9" rx="1.5" />
        <rect x="3" y="16" width="7" height="5" rx="1.5" />
      </svg>
    ),
  },
  {
    tab: 'wells',
    to: '/dashboard?tab=wells',
    label: 'My Wells',
    icon: (
      <svg viewBox="0 0 24 24" className={ICON_CLASS} fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M4 3v18M10 3v18M16 3v18M22 6v12" />
      </svg>
    ),
  },
  {
    tab: 'settings',
    to: '/dashboard?tab=settings',
    label: 'Settings',
    icon: (
      <svg viewBox="0 0 24 24" className={ICON_CLASS} fill="none" stroke="currentColor" strokeWidth="1.6">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.07a2 2 0 1 1-2.83 2.83l-.07-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.11-1.55 1.7 1.7 0 0 0-1.87.34l-.07.06a2 2 0 1 1-2.83-2.83l.06-.07a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.55-1.11 1.7 1.7 0 0 0-.34-1.87l-.06-.07a2 2 0 1 1 2.83-2.83l.07.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.87-.34l.07-.06a2 2 0 1 1 2.83 2.83l-.06.07a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.56 1.03z" />
      </svg>
    ),
  },
]

const LINK_CLASS = (active: boolean) =>
  clsx(
    'flex items-center gap-3 px-3 py-2 rounded-md font-semibold text-xs uppercase tracking-widest transition-colors',
    active ? 'bg-accent/10 text-accent' : 'text-text-dim hover:text-text hover:bg-bg-deep',
  )

function NavSections({ onNavigate }: { onNavigate?: () => void }) {
  const { user, logout } = useAuth()
  const location = useLocation()
  const [params] = useSearchParams()
  const dashTabRaw = params.get('tab')
  const dashTab: DashboardTab =
    dashTabRaw === 'wells' || dashTabRaw === 'settings' ? dashTabRaw : 'overview'

  return (
    <>
      <nav className="px-3 flex-1 flex flex-col gap-1 overflow-y-auto">
        {NAV.map((item) => {
          const active = location.pathname === '/dashboard' && dashTab === item.tab
          return (
            <NavLink key={item.tab} to={item.to} onClick={onNavigate} className={LINK_CLASS(active)}>
              {item.icon}
              {item.label}
            </NavLink>
          )
        })}
      </nav>

      <div className="border-t border-border px-3 py-3">
        <button
          onClick={() => {
            onNavigate?.()
            logout()
          }}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-md font-semibold text-xs uppercase tracking-widest text-text-dim hover:text-gas hover:bg-bg-deep transition-colors"
        >
          <svg viewBox="0 0 24 24" className={ICON_CLASS} fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
          </svg>
          Logout
        </button>
        <div className="mt-3 px-3 py-2">
          <p className="text-sm text-text-bright">{user?.name || 'Petro User'}</p>
          <p className="text-xs text-text-dim truncate">{user?.email || ''}</p>
        </div>
      </div>
    </>
  )
}

export default function Sidebar() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const drawerRef = useRef<HTMLDivElement>(null)
  const openButtonRef = useRef<HTMLButtonElement>(null)
  const location = useLocation()

  // Close the drawer whenever the route changes (e.g. browser back).
  useEffect(() => {
    setDrawerOpen(false)
  }, [location])

  useEffect(() => {
    if (!drawerOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerOpen(false)
    }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    drawerRef.current
      ?.querySelector<HTMLElement>('a, button')
      ?.focus()
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.removeProperty('overflow')
      openButtonRef.current?.focus()
    }
  }, [drawerOpen])

  return (
    <>
      {/* Mobile header bar */}
      <div className="md:hidden flex shrink-0 items-center justify-between border-b border-border surface-header-bar px-4 py-3">
        <Logo size={26} />
        <button
          ref={openButtonRef}
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open navigation menu"
          aria-expanded={drawerOpen}
          className="rounded-md p-2 text-text-dim transition-colors hover:bg-bg-deep hover:text-text"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M3 6h18M3 12h18M3 18h18" />
          </svg>
        </button>
      </div>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="md:hidden fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Navigation menu">
          <button
            type="button"
            aria-label="Close navigation menu"
            tabIndex={-1}
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 cursor-default surface-scrim backdrop-blur-sm"
          />
          <div
            ref={drawerRef}
            className="drawer-enter absolute inset-y-0 left-0 flex w-[min(18rem,85vw)] flex-col border-r border-border bg-bg-panel shadow-2xl"
          >
            <div className="flex items-center justify-between px-5 py-5">
              <Logo size={26} />
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close navigation menu"
                className="rounded-md p-2 text-text-dim transition-colors hover:bg-bg-deep hover:text-text"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            <NavSections onNavigate={() => setDrawerOpen(false)} />
          </div>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-[240px] shrink-0 flex-col border-r border-border surface-sidebar">
        <div className="px-5 py-6">
          <Logo size={28} />
        </div>
        <NavSections />
      </aside>
    </>
  )
}
