import { useEffect, useState } from 'react'
import { Recycle, ScanSearch, Sparkles, Trash2 } from 'lucide-react'
import type { HistoryEntry, JunkCategory, RecycleInfo } from '@shared/types'
import { formatBytes } from '@shared/format'
import { call, tidy, toast, useSettings } from '../api'
import { lastJunkScan, useProgress } from '../store'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { SafeBinResult } from '../components/SafeBinResult'
import { Badge, Button, Card, Checkbox, cx, PageHeader, ProgressBar } from '../components/ui'

const RECYCLE_ID = 'recycle-bin'

export function JunkPage(): JSX.Element {
  const { settings } = useSettings()
  const scan = lastJunkScan.use()
  const progress = useProgress('junk')
  const [phase, setPhase] = useState<'idle' | 'scanning' | 'cleaning'>('idle')
  const [recycle, setRecycle] = useState<RecycleInfo | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirm, setConfirm] = useState<'clean' | 'recycle' | null>(null)
  const [result, setResult] = useState<HistoryEntry | null>(null)
  const [recycleResult, setRecycleResult] = useState<string | null>(null)

  const cats = scan?.categories ?? []
  useEffect(() => {
    setSelected(new Set(cats.filter((c) => c.bytes > 0).map((c) => c.id)))
  }, [scan])

  const startScan = async (): Promise<void> => {
    setPhase('scanning')
    setResult(null)
    setRecycleResult(null)
    const [c, r] = await Promise.all([call(tidy.junkScan()), call(tidy.recycleInfo())])
    setPhase('idle')
    if (c) lastJunkScan.set({ categories: c, at: Date.now() })
    if (r) setRecycle(r)
  }

  const toggle = (id: string, on: boolean): void =>
    setSelected((s) => {
      const n = new Set(s)
      if (on) n.add(id)
      else n.delete(id)
      return n
    })

  const junkIds = [...selected].filter((id) => id !== RECYCLE_ID)
  const junkBytes = cats.filter((c) => selected.has(c.id)).reduce((n, c) => n + c.bytes, 0)
  const recycleSelected = selected.has(RECYCLE_ID) && (recycle?.count ?? 0) > 0
  const totalBytes = junkBytes + (recycleSelected ? recycle!.bytes : 0)

  const clean = async (): Promise<void> => {
    setConfirm(null)
    setPhase('cleaning')
    if (junkIds.length) {
      const e = await call(tidy.junkClean(junkIds))
      if (e) {
        setResult(e)
        lastJunkScan.set(null)
      }
    }
    setPhase('idle')
    if (recycleSelected) setConfirm('recycle')
  }

  const emptyRecycle = async (): Promise<void> => {
    setConfirm(null)
    const r = await call(tidy.emptyRecycleBin())
    if (r) {
      setRecycleResult(
        settings.dryRun
          ? `Dry run — ${r.count.toLocaleString()} Recycle Bin items (${formatBytes(r.bytes)}) would be permanently deleted.`
          : `Windows Recycle Bin emptied — ${formatBytes(r.bytes)} freed.`
      )
      setRecycle(await call(tidy.recycleInfo()) ?? null)
      toast.success(settings.dryRun ? 'Dry run complete — nothing was deleted' : 'Recycle Bin emptied')
    }
  }

  const busy = phase !== 'idle'
  const rows: (JunkCategory & { recycle?: boolean })[] = scan
    ? [
        ...cats,
        ...(recycle
          ? [
              {
                id: RECYCLE_ID,
                label: 'Windows Recycle Bin',
                description: 'Empties the Recycle Bin permanently. Not held in the Safe Bin and cannot be undone.',
                bytes: recycle.bytes,
                fileCount: recycle.count,
                recycle: true
              }
            ]
          : [])
      ]
    : []

  return (
    <>
      <PageHeader
        title="Junk Cleaner"
        subtitle="Temp files, caches and crash dumps. Cleaned files wait in the Safe Bin before they are gone for good."
        actions={
          scan && (
            <Button icon={<ScanSearch className="h-4 w-4" />} onClick={startScan} disabled={busy}>
              Rescan
            </Button>
          )
        }
      />

      {result && (
        <div className="mb-5">
          <SafeBinResult entry={result} noun="files" onChange={setResult} />
        </div>
      )}
      {recycleResult && (
        <Card className="mb-5">
          <div className="flex items-center gap-3 text-sm">
            <Recycle className="h-5 w-5 text-indigo-500" />
            {recycleResult}
          </div>
        </Card>
      )}

      {busy && (
        <Card className="mb-5">
          <div className="mb-2 flex justify-between text-sm">
            <span className="font-medium">{phase === 'scanning'
                ? 'Scanning your PC for junk…'
                : settings.dryRun
                  ? 'Simulating clean — nothing is being moved…'
                  : 'Moving files to the Safe Bin…'}</span>
            <span className="tabular-nums text-muted">
              {phase === 'cleaning' && progress?.total
                ? `${progress.done.toLocaleString()} / ${progress.total.toLocaleString()}`
                : progress?.phase}
            </span>
          </div>
          <ProgressBar
            indeterminate={!progress || !progress.total}
            value={progress?.total ? progress.done / progress.total : 0}
          />
        </Card>
      )}

      {!scan && !busy && (
        <Card className="relative overflow-hidden">
          <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-gradient-to-br from-indigo-500/25 to-violet-500/25 blur-3xl" />
          <div className="relative flex items-center gap-6 py-6">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 text-white shadow-glow">
              <Sparkles className="h-8 w-8" />
            </div>
            <div className="flex-1">
              <h2 className="text-lg font-semibold">Find out how much space you can free</h2>
              <p className="mt-1 text-sm text-muted">
                Scanning only reads your disk. Files changed in the last hour are always left alone.
              </p>
            </div>
            <Button variant="primary" className="h-11 px-6" icon={<ScanSearch className="h-4 w-4" />} onClick={startScan}>
              Scan
            </Button>
          </div>
        </Card>
      )}

      {scan && (
        <Card
          title={
            <span>
              <span className="text-gradient text-2xl font-bold">{formatBytes(totalBytes)}</span>
              <span className="ml-2 text-sm font-normal text-muted">selected</span>
            </span>
          }
          actions={
            <Button
              variant="primary"
              icon={<Trash2 className="h-4 w-4" />}
              disabled={busy || (!junkIds.length && !recycleSelected)}
              onClick={() => setConfirm(junkIds.length ? 'clean' : 'recycle')}
            >
              {settings.dryRun ? 'Simulate clean' : 'Clean'}
            </Button>
          }
        >
          <ul className="divide-y divide-line">
            {rows.map((c) => (
              <li key={c.id} className={cx('flex items-center gap-4 py-3', c.bytes === 0 && 'opacity-60')}>
                <Checkbox
                  label={c.label}
                  checked={selected.has(c.id)}
                  onChange={(v) => toggle(c.id, v)}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {c.label}
                    {c.recycle && <Badge tone="danger">Permanent</Badge>}
                    {c.note && <Badge tone="warning">{c.note}</Badge>}
                  </div>
                  <div className="text-xs text-muted">{c.description}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold tabular-nums">{formatBytes(c.bytes)}</div>
                  <div className="text-xs text-muted">{c.fileCount.toLocaleString()} {c.recycle ? 'items' : 'files'}</div>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <ConfirmDialog
        open={confirm === 'clean'}
        title={settings.dryRun ? 'Simulate cleaning?' : 'Clean selected junk?'}
        body={
          settings.dryRun
            ? `Dry run is on. TidyDesk will list ${formatBytes(junkBytes)} of junk without moving anything.`
            : `${formatBytes(junkBytes)} will move to the Safe Bin. You can restore it from the Dashboard for ${settings.holdHours} hours; after that it is deleted permanently.`
        }
        confirmLabel={settings.dryRun ? 'Simulate' : 'Clean'}
        onCancel={() => setConfirm(null)}
        onConfirm={() => void clean()}
      />
      <ConfirmDialog
        open={confirm === 'recycle'}
        danger={!settings.dryRun}
        title={settings.dryRun ? 'Simulate emptying the Recycle Bin?' : 'Empty the Windows Recycle Bin?'}
        body={
          settings.dryRun
            ? `Dry run is on. Nothing will be deleted.`
            : `Permanently delete ${recycle?.count.toLocaleString()} items (${formatBytes(recycle?.bytes ?? 0)}) from the Windows Recycle Bin? This cannot be undone.`
        }
        confirmLabel={settings.dryRun ? 'Simulate' : 'Delete permanently'}
        onCancel={() => setConfirm(null)}
        onConfirm={() => void emptyRecycle()}
      />
    </>
  )
}
