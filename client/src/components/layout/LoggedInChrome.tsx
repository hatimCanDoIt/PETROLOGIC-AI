import type { ReactNode } from 'react'

import Sidebar from '@/components/layout/Sidebar'
import TopBar from '@/components/layout/TopBar'

interface LoggedInChromeProps {
  title: ReactNode
  subtitle?: ReactNode
  topRight?: ReactNode
  children: ReactNode
}

export default function LoggedInChrome({
  title,
  subtitle,
  topRight,
  children,
}: LoggedInChromeProps) {
  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <TopBar title={title} subtitle={subtitle} right={topRight} />
        <div className="px-6 py-6 space-y-6">{children}</div>
      </main>
    </div>
  )
}
