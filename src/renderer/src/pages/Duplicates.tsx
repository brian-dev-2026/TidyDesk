import { useEffect, useState } from 'react'
import { Copy, Trash2, X } from 'lucide-react'
import type { HistoryEntry } from '@shared/types'
import { call, tidy, toast, useSettings } from '../api'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { useProgress } from '../store'
import { SafeBinResult } from '../components/SafeBinResult'
import { DropZone } from '../components/DropZone'
import { FolderList } from '../components/FolderList'
import { Button, Card, Empty, PageHeader, ProgressBar } from '../components/ui'

export function DuplicatesPage(): JSX.Element {
  const { settings, update } = useSettings()
  const progress = useProgress('dup')
  const [defaults, setDefaults] = useState<string[]>([])
  const [running, setRunning] = useState(false)
  const [dropped, setDropped] = useState<string | null>(null)
  // undefined: not run yet; null: ran and found nothing
  const [result, setResult] = useState<HistoryEntry | null | undefined>(undefined)

  useEffect(() => {
    void call(tidy.autoFolders()).then((f) => f && setDefaults(f.duplicates))
  }, [settings.duplicateFolders])

  const folders = settings.duplicateFolders ?? defaults

  const run = async (dirs?: string[]): Promise<void> => {
    setRunning(true)
    setResult(undefined)
    const r = await call(tidy.dupAuto(dirs))
    setRunning(false)
    if (!r) return
    setResult(r.entry)
    for (const s of r.skipped) toast.info(`Skipped ${s.dir}: ${s.error}`)
  }

  return (
    <DropZone onFolder={setDropped} disabled={running}>
      <PageHeader
        title="Duplicates"
        subtitle="One click finds files with byte-for-byte identical content, whatever their names, keeps the oldest copy and moves the rest to the Safe Bin."
      />

      <Card className="mb-5">
        <div className="flex flex-wrap items-center gap-4">
          <div className="min-w-0 flex-1">
            <div className="mb-2 text-sm font-medium">Folders to check</div>
            <FolderList
              folders={folders}
              custom={settings.duplicateFolders !== undefined}
              disabled={running}
              onChange={(f) => void update({ duplicateFolders: f as string[] })}
            />
          </div>
          <Button
            variant="primary"
            className="h-11 px-6 text-base"
            icon={<Trash2 className="h-5 w-5" />}
            loading={running}
            disabled={!folders.length}
            onClick={() => void run()}
          >
            {settings.dryRun ? 'Simulate removing duplicates' : 'Remove duplicates'}
          </Button>
        </div>
        <p className="mt-4 border-t border-line pt-4 text-xs text-muted">
          Photos, documents, music, videos and archives are compared; program, game and project folders are skipped. Removed copies stay in the
          Safe Bin for {settings.holdHours} hours so you can restore them. Tip: drop any folder here to remove duplicates in just that one.
        </p>
      </Card>

      {running && (
        <Card className="mb-5">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-medium">
              {progress?.phase === 'Moving'
                ? 'Moving copies to the Safe Bin…'
                : progress?.phase === 'hashing'
                  ? 'Comparing file contents…'
                  : 'Listing files…'}
            </span>
            <div className="flex items-center gap-3">
              <span className="tabular-nums text-muted">
                {progress?.total
                  ? `${progress.done.toLocaleString()} / ${progress.total.toLocaleString()}`
                  : progress
                    ? `${progress.done.toLocaleString()} files`
                    : ''}
              </span>
              {progress?.phase !== 'Moving' && (
                <Button variant="ghost" className="h-8 px-3 text-xs" icon={<X className="h-3.5 w-3.5" />} onClick={() => void call(tidy.dupCancel())}>
                  Cancel
                </Button>
              )}
            </div>
          </div>
          <ProgressBar indeterminate={!progress?.total} value={progress?.total ? progress.done / progress.total : 0} />
        </Card>
      )}

      {result === null && (
        <Card>
          <Empty icon={<Copy className="h-5 w-5" />} title="No duplicates found">
            Every file in these folders is unique.
          </Empty>
        </Card>
      )}

      {result && <SafeBinResult entry={result} noun="duplicates" onChange={setResult} />}

      <ConfirmDialog
        open={dropped !== null}
        title="Remove duplicates in this folder?"
        body={
          <>
            <span className="selectable block break-all font-medium text-fg">{dropped}</span>
            <span className="mt-2 block">The oldest copy of each file is kept; the others move to the Safe Bin for {settings.holdHours} hours.</span>
          </>
        }
        confirmLabel="Remove duplicates"
        onCancel={() => setDropped(null)}
        onConfirm={() => {
          const d = dropped
          setDropped(null)
          if (d) void run([d])
        }}
      />
    </DropZone>
  )
}
