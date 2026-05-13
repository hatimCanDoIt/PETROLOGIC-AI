import { NavLink, useLocation } from 'react-router-dom'
import clsx from 'clsx'

import { useAuth } from '@/hooks/useAuth'
import Logo from './Logo'

interface NavItem {
  to: string
  label: string
  icon: JSX.Element
}

const ICON_CLASS = 'h-4 w-4 shrink-0'

const NAV: NavItem[] = [
  {
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
    to: '/dashboard?tab=wells',
    label: 'My Wells',
    icon: (
      <svg viewBox="0 0 24 24" className={ICON_CLASS} fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M4 3v18M10 3v18M16 3v18M22 6v12" />
      </svg>
    ),
  },
  {
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

export default function Sidebar() {
  const { user, logout } = useAuth()
  const location = useLocation()

  return (
    <aside className="hidden md:flex w-[240px] shrink-0 flex-col border-r border-border bg-bg-panel/60">
      <div className="px-5 py-6">
        <Logo size={28} />
      </div>

      <nav className="px-3 flex-1 flex flex-col gap-1">
        {NAV.map((item) => {
          const [path, query] = item.to.split('?')
          const active =
            location.pathname === path &&
            (!query || location.search.includes(query.split('=')[1] ?? ''))
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={clsx(
                'flex items-center gap-3 px-3 py-2 rounded-md font-mono text-xs uppercase tracking-widest transition-colors',
                active
                  ? 'bg-accent/10 text-accent'
                  : 'text-text-dim hover:text-text hover:bg-bg-deep',
              )}
            >
              {item.icon}
              {item.label}
            </NavLink>
          )
        })}
      </nav>

      <div className="border-t border-border px-3 py-3">
        <button
          onClick={logout}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-md font-mono text-xs uppercase tracking-widest text-text-dim hover:text-gas hover:bg-bg-deep transition-colors"
        >
          <svg viewBox="0 0 24 24" className={ICON_CLASS} fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
          </svg>
          Logout
        </button>
        <div className="mt-3 px-3 py-2">
          <p className="text-sm text-text-bright">{user?.name || 'Petro User'}</p>
          <p className="text-xs text-text-dim font-mono truncate">
            {user?.email || ''}
          </p>
        </div>
      </div>
    </aside>
  )
}
