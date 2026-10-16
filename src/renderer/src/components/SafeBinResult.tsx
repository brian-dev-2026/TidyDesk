import { useState } from 'react'
import { CheckCircle2, FlaskConical, RotateCcw, Trash2 } from 'lucide-react'
import type { HistoryEntry } from '@shared/types'
import { formatBytes } from '@shared/format'
import { call, tidy, toast } from '../api'
import { ConfirmDialog } from './ConfirmDialog'
import { Button, Card, Countdown } from './ui'

/** Result card shown after a junk clean or duplicate removal. */
export function SafeBinResult({
  entry,
  noun,
  onChange
}: {
  entry: HistoryEntry
  noun: string
  onChange: (e: HistoryEntry) => void
}): JSX.Element {
  const [busy, setBusy] = useState<'restore' | 'purge' | null>(null)
  const [confirmPurge, setConfirmPurge] = useState(false)

  if (entry.status === 'simulated') {
    return (
      <Card className="border-amber-500/30 bg-amber-500/5">
        <div className="flex items-start gap-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-500/15 text-amber-500">
            <FlaskConical className="h-5 w-5" />
          </div>
          <div>
            <div className="font-semibold">
              Dry run — {formatBytes(entry.bytes)} would be freed ({entry.count.toLocaleString()} {noun})
            </div>
            <p className="mt-1 text-sm text-muted">
              Nothing was changed. The full list is on the Dashboard under Recent Activity.
              {entry.skipped > 0 && ` ${entry.skipped.toLocaleString()} files could not be read and would be skipped.`}
            </p>
          </div>
        </div>
      </Card>
    )
  }

  const run = async (kind: 'restore' | 'purge'): Promise<void> => {
    setBusy(kind)
    const r = await call(kind === 'restore' ? tidy.restore(entry.id) : tidy.purgeNow(entry.id))
    setBusy(null)
    if (r) {
      onChange(r)
      toast.success(kind === 'restore' ? 'Files restored to their original folders' : 'Space freed permanently')
    }
  }

  const held = entry.status === 'held' || entry.status === 'partial'
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-500">
          <CheckCircle2 className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          {held ? (
            <>
              <div className="font-semibold">
                {formatBytes(entry.bytes)} moved to Safe Bin ({entry.count.toLocaleString()} {noun})
              </div>
              <p className="text-sm text-muted">
                Freed automatically in {entry.expiresAt ? <Countdown until={entry.expiresAt} /> : '—'} · restore any
                time before then
                {entry.skipped > 0 && ` · ${entry.skipped.toLocaleString()} files in use were skipped`}
              </p>
            </>
          ) : (
            <div className="font-semibold">
              {entry.status === 'restored' ? 'Everything was restored' : `${formatBytes(entry.freedBytes ?? entry.bytes)} freed`}
            </div>
          )}
        </div>
        {held && (
          <div className="flex gap-2">
            <Button icon={<RotateCcw className="h-4 w-4" />} loading={busy === 'restore'} onClick={() => run('restore')}>
              Restore
            </Button>
            <Button
              variant="primary"
              icon={<Trash2 className="h-4 w-4" />}
              loading={busy === 'purge'}
              onClick={() => setConfirmPurge(true)}
            >
              Free now
            </Button>
          </div>
        )}
      </div>
      <ConfirmDialog
        open={confirmPurge}
        danger
        title="Free space now?"
        body={`${formatBytes(entry.bytes - (entry.restoredBytes ?? 0))} will be permanently deleted. This cannot be undone.`}
        confirmLabel="Delete permanently"
        onCancel={() => setConfirmPurge(false)}
        onConfirm={() => {
          setConfirmPurge(false)
          void run('purge')
        }}
      />
    </Card>
  )
}
