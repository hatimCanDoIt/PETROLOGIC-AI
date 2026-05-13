import { useState } from 'react'

import Button from '@/components/ui/Button'
import { downloadWellExport } from '@/hooks/useWell'

interface ExportButtonProps {
  wellId: string
  wellName: string
  logDate?: string | null
}

export default function ExportButton({ wellId, wellName, logDate }: ExportButtonProps) {
  const [loading, setLoading] = useState(false)
  const onClick = async () => {
    setLoading(true)
    try {
      const safe = wellName.replace(/[^a-z0-9_-]+/gi, '_')
      const date = logDate || 'unknown'
      await downloadWellExport(wellId, `${safe}_${date}_petrologic.csv`)
    } catch (err) {
      alert('Export failed.')
    } finally {
      setLoading(false)
    }
  }
  return (
    <Button onClick={onClick} loading={loading} variant="secondary" size="sm">
      Export CSV
    </Button>
  )
}
