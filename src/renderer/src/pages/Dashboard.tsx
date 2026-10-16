import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, FolderOpen, HardDrive, Recycle, ShieldCheck, Sparkles, Trash2 } from 'lucide-react'
import type { DriveInfo, HistoryEntry, Orphan, Stats } from '@shared/types'
import { formatBytes } from '@shared/format'
import { call, tidy, toast, useSettings } from '../api'
import { lastJunkScan, useHistoryVersion, useProgress } from '../store'
import { ActivityTimeline } from '../components/ActivityTimeline'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Button, Card, PageHeader, ProgressBar, ProgressRing } from '../components/ui'
import type { Page } from '../components/Sidebar'

function StatCard({
  icon,
  label,
  value,
  hint
}: {
  icon: JSX.Element
  label: string
  value: string
  hint?: JSX.Element | string
}): JSX.Element {
  return (
    <Card className="flex-1 p-4">
      <div className="flex items-center gap-2 text-xs font-medium text-muted">
        {icon}
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </Card>
  )
}

export function DashboardPage({ onNavigate }: { onNavigate: (p: Page) => void }): JSX.Element {
  const version = useHistoryVersion()
  const scan = lastJunkScan.use()
  const { settings } = useSettings()
  const progress = useProgress('junk')
  const [drives, setDrives] = useState<DriveInfo[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [orphans, setOrphans] = useState<Orphan[]>([])
  const [quick, setQuick] = useState<'idle' | 'scanning' | 'confirm' | 'cleaning'>('idle')
  const [orphanToDelete, setOrphanToDelete] = useState<Orphan | null>(null)

  const refresh = useCallback(async () => {
    const [d, s, h, o] = await Promise.all([
      call(tidy.disk()),
      call(tidy.stats()),
      call(tidy.history()),
      call(tidy.orphans())
    ])
    if (d) setDrives(d)
    if (s) setStats(s)
    if (h) setHistory(h)
    if (o) setOrphans(o)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh, version, settings.dryRun])

  const reclaimable = scan ? scan.categories.reduce((n, c) => n + c.bytes, 0) : null
  const quickIds = scan ? scan.categories.filter((c) => c.bytes > 0).map((c) => c.id) : []

  const startQuick = async (): Promise<void> => {
    setQuick('scanning')
    const cats = await call(tidy.junkScan())
    if (!cats) return setQuick('idle')
    lastJunkScan.set({ categories: cats, at: Date.now() })
    setQuick(cats.some((c) => c.bytes > 0) ? 'confirm' : 'idle')
    if (!cats.some((c) => c.bytes > 0)) toast.info('No junk found — you are already tidy')
  }

  const runQuick = async (): Promise<void> => {
    setQuick('cleaning')
    const e = await call(tidy.junkClean(quickIds))
    setQuick('idle')
    if (e) {
      lastJunkScan.set(null)
      toast.success(
        e.dryRun
          ? `Dry run — ${formatBytes(e.bytes)} would be freed. Nothing was changed.`
          : `${formatBytes(e.bytes)} moved to the Safe Bin`
      )
    }
  }

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="Your drives, what TidyDesk is holding, and everything it has done."
        actions={
          <Button
            variant="primary"
            icon={<Sparkles className="h-4 w-4" />}
            loading={quick === 'scanning' || quick === 'cleaning'}
            onClick={startQuick}
          >
            Quick Clean
          </Button>
        }
      />

      {(quick === 'scanning' || quick === 'cleaning') && (
        <Card className="mb-5">
          <div className="mb-2 flex justify-between text-sm">
            <span className="font-medium">{quick === 'scanning' ? 'Scanning for junk…' : 'Cleaning…'}</span>
            <span className="text-muted">{progress?.phase}</span>
          </div>
          <ProgressBar
            indeterminate={!progress || progress.total === 0}
            value={progress && progress.total ? progress.done / progress.total : 0}
          />
        </Card>
      )}

      <div className="mb-5 grid grid-cols-[auto_1fr] gap-5">
        <Card className="flex items-center gap-6 pr-8">
          {drives.slice(0, 3).map((d) => {
            const used = d.total - d.free
            return (
              <div key={d.root} className="flex flex-col items-center gap-2">
                <ProgressRing
                  value={used / d.total}
                  size={drives.length > 1 ? 104 : 128}
                  label={`${Math.round((used / d.total) * 100)}%`}
                  sublabel={d.root.replace('\\', '')}
                />
                <div className="text-xs text-muted">
                  <HardDrive className="mr-1 inline h-3 w-3" />
                  {formatBytes(d.free)} free of {formatBytes(d.total)}
                </div>
              </div>
            )
          })}
        </Card>
        <div className="flex gap-4">
          <StatCard
            icon={<Trash2 className="h-3.5 w-3.5" />}
            label="Reclaimable junk"
            value={reclaimable === null ? '—' : formatBytes(reclaimable)}
            hint={
              reclaimable === null ? (
                <button className="text-indigo-500 hover:underline dark:text-indigo-300" onClick={() => onNavigate('junk')}>
                  Scan now
                </button>
              ) : (
                'from the last scan'
              )
            }
          />
          <StatCard
            icon={<ShieldCheck className="h-3.5 w-3.5" />}
            label="Held in Safe Bin"
            value={stats ? formatBytes(stats.heldBytes) : '—'}
            hint={`restorable for up to ${settings.holdHours}h`}
          />
          <StatCard
            icon={<Recycle className="h-3.5 w-3.5" />}
            label="Freed all-time"
            value={stats ? formatBytes(stats.freedAllTime) : '—'}
            hint="permanently reclaimed"
          />
        </div>
      </div>

      {orphans.length > 0 && (
        <Card
          className="mb-5 border-amber-500/30"
          title={
            <span className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" /> Orphaned items in the Safe Bin
            </span>
          }
          subtitle="These folders are in a Safe Bin but have no history record (for example after the history file was reset). Recover files by hand or delete them."
        >
          <ul className="flex flex-col gap-2">
            {orphans.map((o) => (
              <li key={o.binDir} className="flex items-center gap-3 text-sm">
                <span className="selectable min-w-0 flex-1 truncate">{o.binDir}</span>
                <span className="text-muted">{formatBytes(o.bytes)}</span>
                <Button className="h-8 px-3 text-xs" icon={<FolderOpen className="h-3.5 w-3.5" />} onClick={() => void call(tidy.openOrphan(o.binDir))}>
                  Open folder
                </Button>
                <Button className="h-8 px-3 text-xs" variant="ghost" onClick={() => setOrphanToDelete(o)}>
                  Delete
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Recent activity" subtitle="Click an entry to see every file it touched.">
        <ActivityTimeline entries={history} />
      </Card>

      <ConfirmDialog
        open={quick === 'confirm'}
        title={settings.dryRun ? 'Simulate Quick Clean?' : 'Quick Clean'}
        body={
          settings.dryRun
            ? `Dry run is on: TidyDesk will list ${formatBytes(reclaimable ?? 0)} of junk without touching anything.`
            : `${formatBytes(reclaimable ?? 0)} of junk will move to the Safe Bin. You can restore it for ${settings.holdHours} hours.`
        }
        confirmLabel={settings.dryRun ? 'Simulate' : 'Clean'}
        onCancel={() => setQuick('idle')}
        onConfirm={() => void runQuick()}
      />
      <ConfirmDialog
        open={!!orphanToDelete}
        danger
        title="Delete orphaned folder?"
        body={`${orphanToDelete?.binDir} (${formatBytes(orphanToDelete?.bytes ?? 0)}) will be permanently deleted.`}
        confirmLabel="Delete permanently"
        onCancel={() => setOrphanToDelete(null)}
        onConfirm={async () => {
          const o = orphanToDelete!
          setOrphanToDelete(null)
          if ((await call(tidy.deleteOrphan(o.binDir))) !== undefined) toast.success('Orphaned folder deleted')
          void refresh()
        }}
      />
    </>
  )
}
