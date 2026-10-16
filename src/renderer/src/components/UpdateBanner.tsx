import { Download, RefreshCw } from 'lucide-react'
import { call, tidy } from '../api'
import { useUpdateStatus } from '../update'
import { Button, ProgressBar } from './ui'

/** Strip above the page when a new version is available, downloading or ready to install. */
export function UpdateBanner(): JSX.Element | null {
  const s = useUpdateStatus()
  if (s.state !== 'available' && s.state !== 'downloading' && s.state !== 'ready') return null
  return (
    <div className="mb-5 flex items-center gap-4 rounded-2xl border border-indigo-500/30 bg-indigo-500/10 px-4 py-3 animate-fade-in" role="status">
      <RefreshCw className="h-5 w-5 shrink-0 text-indigo-500" />
      <div className="min-w-0 flex-1 text-sm">
        {s.state === 'available' && (
          <>
            <span className="font-semibold">TidyDesk {s.version}</span> is available.
          </>
        )}
        {s.state === 'downloading' && (
          <>
            <div className="mb-1.5">
              Downloading <span className="font-semibold">TidyDesk {s.version}</span>… {s.percent ?? 0}%
            </div>
            <ProgressBar value={(s.percent ?? 0) / 100} />
          </>
        )}
        {s.state === 'ready' && (
          <>
            <span className="font-semibold">TidyDesk {s.version}</span> is ready. Restart to finish updating — or it
            installs the next time you quit.
          </>
        )}
      </div>
      {s.state === 'available' && (
        <Button variant="primary" icon={<Download className="h-4 w-4" />} onClick={() => void call(tidy.updateDownload())}>
          Download
        </Button>
      )}
      {s.state === 'ready' && (
        <Button variant="primary" icon={<RefreshCw className="h-4 w-4" />} onClick={() => void call(tidy.updateInstall())}>
          Restart to update
        </Button>
      )}
    </div>
  )
}
