import NDCrossplot from '@/components/report/NDCrossplot'
import type { HcZoneOut, ResultJson } from '@/types'

interface CrossplotWorkspaceProps {
  result: ResultJson
  zones: HcZoneOut[]
  wellId: string
  activeZoneId: string | null
  onViewZoneInLogs: (zoneId: string) => void
  onZoneFocus: (zoneId: string) => void
}

export default function CrossplotWorkspace({
  result,
  zones,
  wellId,
  activeZoneId,
  onViewZoneInLogs,
  onZoneFocus,
}: CrossplotWorkspaceProps) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overflow-x-hidden bg-bg p-[clamp(0.75rem,2vw,1.25rem)] [scrollbar-gutter:stable]">
      <NDCrossplot
        result={result}
        zones={zones}
        wellId={wellId}
        activeZoneId={activeZoneId}
        onViewZoneInLogs={onViewZoneInLogs}
        onZoneFocus={onZoneFocus}
      />
    </div>
  )
}
