import { useEffect, useMemo, useState } from 'react'
import { FolderOpen, HardDrive, ScanSearch, Trash2, X } from 'lucide-react'
import type { DriveInfo, FileInfo, HistoryEntry } from '@shared/types'
import { formatBytes } from '@shared/format'
import { call, tidy, useSettings } from '../api'
import { useProgress } from '../store'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { SafeBinResult } from '../components/SafeBinResult'
import { DropZone } from '../components/DropZone'
import { Button, Card, Checkbox, Empty, PageHeader, ProgressBar } from '../components/ui'

function split(p: string): { name: string; folder: string } {
  const i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'))
  return { name: p.slice(i + 1), folder: p.slice(0, i) }
}

export function LargeFilesPage(): JSX.Element {
  const { settings } = useSettings()
  const progress = useProgress('large')
  const [drives, setDrives] = useState<DriveInfo[]>([])
  const [dir, setDir] = useState<string | null>(null)
  const [files, setFiles] = useState<FileInfo[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [phase, setPhase] = useState<'idle' | 'scanning' | 'removing'>('idle')
  const [confirm, setConfirm] = useState(false)
  const [result, setResult] = useState<HistoryEntry | null>(null)

  useEffect(() => {
    void call(tidy.disk()).then((d) => d && setDrives(d))
  }, [])

  const scan = async (d: string): Promise<void> => {
    setDir(d)
    setPhase('scanning')
    setFiles(null)
    setResult(null)
    setSelected(new Set())
    const r = await call(tidy.largeScan(d))
    setPhase('idle')
    if (r) setFiles(r)
  }

  const choose = async (): Promise<void> => {
    const d = await call(tidy.pickFolder())
    if (d) void scan(d)
  }

  const chosen = useMemo(() => (files ?? []).filter((f) => selected.has(f.path)), [files, selected])
  const chosenBytes = chosen.reduce((n, f) => n + f.size, 0)
  const max = files?.[0]?.size ?? 1

  const remove = async (): Promise<void> => {
    setConfirm(false)
    setPhase('removing')
    const e = await call(tidy.largeRemove(chosen.map((f) => f.path)))
    setPhase('idle')
    if (e) {
      setResult(e)
      if (!e.dryRun) {
        setFiles((fs) => (fs ?? []).filter((f) => !selected.has(f.path)))
        setSelected(new Set())
      }
    }
  }

  const toggle = (p: string, on: boolean): void =>
    setSelected((s) => {
      const n = new Set(s)
      if (on) n.add(p)
      else n.delete(p)
      return n
    })

  return (
    <DropZone onFolder={(d) => void scan(d)}>
      <PageHeader
        title="Large Files"
        subtitle="The biggest files (over 50 MB) on a drive or in a folder. Pick what you no longer need — it goes to the Safe Bin first."
        actions={
          <Button icon={<FolderOpen className="h-4 w-4" />} onClick={choose} disabled={phase !== 'idle'}>
            Choose folder
          </Button>
        }
      />

      {result && (
        <div className="mb-5">
          <SafeBinResult entry={result} noun="files" onChange={setResult} />
        </div>
      )}

      <div className="mb-5 flex flex-wrap gap-2">
        {drives.map((d) => (
          <Button key={d.root} icon={<HardDrive className="h-4 w-4" />} disabled={phase !== 'idle'} onClick={() => void scan(d.root)}>
            Scan {d.root.replace('\\', '')} <span className="text-muted">· {formatBytes(d.free)} free</span>
          </Button>
        ))}
      </div>

      {phase === 'scanning' && (
        <Card className="mb-5">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-medium">Looking for large files in {dir}…</span>
            <div className="flex items-center gap-3">
              <span className="tabular-nums text-muted">{progress?.phase}</span>
              <Button variant="ghost" className="h-8 px-3 text-xs" icon={<X className="h-3.5 w-3.5" />} onClick={() => void call(tidy.largeCancel())}>
                Cancel
              </Button>
            </div>
          </div>
          <ProgressBar indeterminate />
        </Card>
      )}

      {!files && phase === 'idle' && (
        <Card>
          <Empty icon={<ScanSearch className="h-5 w-5" />} title="Find what is taking up space">
            Scan a whole drive or pick a folder. System folders are always skipped.
          </Empty>
        </Card>
      )}

      {files && files.length === 0 && (
        <Card>
          <Empty icon={<HardDrive className="h-5 w-5" />} title="No files over 50 MB here">
            Try another folder or a whole drive.
          </Empty>
        </Card>
      )}

      {files && files.length > 0 && (
        <Card
          title={<span className="selectable">{dir}</span>}
          subtitle={`${files.length} largest files · ${formatBytes(files.reduce((n, f) => n + f.size, 0))} in total`}
          actions={
            <Button
              variant="primary"
              icon={<Trash2 className="h-4 w-4" />}
              disabled={!chosen.length}
              loading={phase === 'removing'}
              onClick={() => setConfirm(true)}
            >
              {settings.dryRun ? 'Simulate' : 'Move to Safe Bin'}
              {chosen.length > 0 && ` (${formatBytes(chosenBytes)})`}
            </Button>
          }
        >
          <ul className="flex flex-col">
            {files.map((f) => {
              const { name, folder } = split(f.path)
              return (
                <li key={f.path} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-raised/60">
                  <Checkbox label={name} checked={selected.has(f.path)} onChange={(v) => toggle(f.path, v)} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium" title={f.path}>
                      {name}
                    </div>
                    <div className="truncate text-xs text-muted" title={folder}>
                      {folder}
                    </div>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-raised">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500"
                        style={{ width: `${Math.max(2, (f.size / max) * 100)}%` }}
                      />
                    </div>
                  </div>
                  <div className="w-24 shrink-0 text-right">
                    <div className="text-sm font-semibold tabular-nums">{formatBytes(f.size)}</div>
                    <div className="text-xs text-muted">{new Date(f.mtimeMs).toLocaleDateString()}</div>
                  </div>
                  <button
                    aria-label="Show in folder"
                    title="Show in folder"
                    className="shrink-0 rounded-md p-1 text-muted hover:bg-raised hover:text-fg"
                    onClick={() => void call(tidy.showInFolder(f.path))}
                  >
                    <FolderOpen className="h-4 w-4" />
                  </button>
                </li>
              )
            })}
          </ul>
        </Card>
      )}

      <ConfirmDialog
        open={confirm}
        title={settings.dryRun ? 'Simulate moving these files?' : 'Move to the Safe Bin?'}
        body={
          settings.dryRun
            ? `Dry run is on. ${chosen.length} files (${formatBytes(chosenBytes)}) will be listed but not touched.`
            : `${chosen.length} files (${formatBytes(chosenBytes)}) will move to the Safe Bin. You can restore them for ${settings.holdHours} hours; after that they are deleted permanently.`
        }
        confirmLabel={settings.dryRun ? 'Simulate' : 'Move to Safe Bin'}
        onCancel={() => setConfirm(false)}
        onConfirm={() => void remove()}
      />
    </DropZone>
  )
}
