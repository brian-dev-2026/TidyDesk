import { useState } from 'react'
import { Bug, FileDown, FolderOpen } from 'lucide-react'
import { call, tidy, toast } from '../api'
import { Button, Card } from './ui'

const ISSUES_URL = 'https://github.com/brian-dev-2026/TidyDesk/issues'

/** Settings card: logs folder, activity export and where to report problems. */
export function SupportCard(): JSX.Element {
  const [exporting, setExporting] = useState(false)
  const exportCsv = async (): Promise<void> => {
    setExporting(true)
    const file = await call(tidy.exportCsv())
    setExporting(false)
    if (file) toast.success(`Activity exported to ${file}`)
  }
  return (
    <Card title="Support" subtitle="Useful when something goes wrong or you want a record of what TidyDesk did." className="mb-5">
      <div className="flex flex-wrap gap-2">
        <Button icon={<FileDown className="h-4 w-4" />} loading={exporting} onClick={() => void exportCsv()}>
          Export activity as CSV
        </Button>
        <Button icon={<FolderOpen className="h-4 w-4" />} onClick={() => void call(tidy.openLogs())}>
          Open logs folder
        </Button>
      </div>
      <p className="mt-3 flex items-center gap-1.5 text-xs text-muted">
        <Bug className="h-3.5 w-3.5" />
        Found a bug? Report it at <span className="selectable font-medium text-fg">{ISSUES_URL}</span> and attach the
        latest log file.
      </p>
    </Card>
  )
}
