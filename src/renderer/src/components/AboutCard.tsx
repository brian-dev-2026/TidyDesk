import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { call, tidy, useSettings } from '../api'
import { describeUpdate, useUpdateStatus } from '../update'
import { Button, Card, Toggle } from './ui'

/** Settings card: version, update status and update preferences. */
export function AboutCard(): JSX.Element {
  const { settings, update } = useSettings()
  const status = useUpdateStatus()
  const [version, setVersion] = useState('')
  useEffect(() => {
    void call(tidy.appVersion()).then((v) => v && setVersion(v))
  }, [])
  const busy = status.state === 'checking' || status.state === 'downloading'
  return (
    <Card
      title={`TidyDesk ${version}`}
      subtitle={describeUpdate(status)}
      className="mb-5"
      actions={
        <Button
          icon={<RefreshCw className="h-4 w-4" />}
          loading={busy}
          disabled={status.state === 'disabled'}
          onClick={() => void call(tidy.updateCheck())}
        >
          Check for updates
        </Button>
      }
    >
      <div className="flex items-center justify-between gap-6">
        <div>
          <div className="text-sm font-medium">Automatically download updates</div>
          <div className="mt-0.5 text-xs text-muted">
            When off, TidyDesk only tells you a new version exists and waits for you to download it.
          </div>
        </div>
        <Toggle
          label="Automatically download updates"
          checked={settings.autoDownloadUpdates}
          onChange={(v) => void update({ autoDownloadUpdates: v })}
        />
      </div>
      <p className="mt-3 text-xs text-muted">MIT License · Versions follow Semantic Versioning (MAJOR.MINOR.PATCH).</p>
    </Card>
  )
}
