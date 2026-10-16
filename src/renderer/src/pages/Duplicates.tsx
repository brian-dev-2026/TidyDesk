import { useEffect, useMemo, useState } from 'react'
import { Copy, File, FolderOpen, ScanSearch, Trash2, X } from 'lucide-react'
import type { DupGroup, HistoryEntry } from '@shared/types'
import { formatBytes } from '@shared/format'
import { call, tidy, useSettings } from '../api'
import { useProgress } from '../store'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { SafeBinResult } from '../components/SafeBinResult'
import { Badge, Button, Card, cx, Empty, PageHeader, ProgressBar } from '../components/ui'

type Rule = 'oldest' | 'newest' | 'shortest'
const IMAGE = /\.(jpe?g|png|gif|bmp|webp|heic|tiff?|ico)$/i

function pickKeep(g: DupGroup, rule: Rule): string {
  const files = [...g.files]
  if (rule === 'newest') files.sort((a, b) => b.mtimeMs - a.mtimeMs)
  else if (rule === 'shortest') files.sort((a, b) => a.path.length - b.path.length || a.mtimeMs - b.mtimeMs)
  else files.sort((a, b) => a.mtimeMs - b.mtimeMs)
  return files[0].path
}

function Thumb({ path }: { path: string }): JSX.Element {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    if (IMAGE.test(path)) void call(tidy.thumbnail(path)).then((s) => s && setSrc(s))
  }, [path])
  return (
    <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-raised text-muted">
      {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : <File className="h-6 w-6" />}
    </div>
  )
}

export function DuplicatesPage(): JSX.Element {
  const { settings } = useSettings()
  const progress = useProgress('dup')
  const [dir, setDir] = useState<string | null>(null)
  const [groups, setGroups] = useState<DupGroup[] | null>(null)
  const [keep, setKeep] = useState<Record<string, string>>({})
  const [rule, setRule] = useState<Rule>('oldest')
  const [phase, setPhase] = useState<'idle' | 'scanning' | 'removing'>('idle')
  const [confirm, setConfirm] = useState(false)
  const [result, setResult] = useState<HistoryEntry | null>(null)

  const applyRule = (gs: DupGroup[], r: Rule): void => {
    setRule(r)
    setKeep(Object.fromEntries(gs.map((g) => [g.hash, pickKeep(g, r)])))
  }

  const scan = async (d: string): Promise<void> => {
    setPhase('scanning')
    setResult(null)
    setGroups(null)
    const gs = await call(tidy.dupScan(d))
    setPhase('idle')
    if (gs) {
      setGroups(gs)
      applyRule(gs, rule)
    }
  }

  const choose = async (): Promise<void> => {
    const d = await call(tidy.pickFolder())
    if (!d) return
    setDir(d)
    void scan(d)
  }

  const toRemove = useMemo(
    () => (groups ?? []).flatMap((g) => g.files.filter((f) => f.path !== keep[g.hash])),
    [groups, keep]
  )
  const reclaim = toRemove.reduce((n, f) => n + f.size, 0)

  const remove = async (): Promise<void> => {
    setConfirm(false)
    setPhase('removing')
    const e = await call(tidy.dupRemove(toRemove.map((f) => f.path)))
    setPhase('idle')
    if (e) {
      setResult(e)
      if (!e.dryRun) setGroups(null)
    }
  }

  return (
    <>
      <PageHeader
        title="Duplicates"
        subtitle="Finds files with byte-for-byte identical content, whatever their names. One copy of each is always kept."
        actions={
          <>
            {dir && phase === 'idle' && (
              <Button icon={<ScanSearch className="h-4 w-4" />} onClick={() => void scan(dir)}>
                Rescan
              </Button>
            )}
            <Button icon={<FolderOpen className="h-4 w-4" />} onClick={choose} disabled={phase !== 'idle'}>
              {dir ? 'Choose another folder' : 'Choose folder'}
            </Button>
          </>
        }
      />

      {result && (
        <div className="mb-5">
          <SafeBinResult entry={result} noun="duplicates" onChange={setResult} />
        </div>
      )}

      {phase === 'scanning' && (
        <Card className="mb-5">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-medium">
              {progress?.phase === 'hashing' ? 'Comparing file contents…' : 'Listing files…'}
            </span>
            <div className="flex items-center gap-3">
              <span className="tabular-nums text-muted">
                {progress?.phase === 'hashing' && progress.total
                  ? `${progress.done.toLocaleString()} / ${progress.total.toLocaleString()}`
                  : progress
                    ? `${progress.done.toLocaleString()} files`
                    : ''}
              </span>
              <Button variant="ghost" className="h-8 px-3 text-xs" icon={<X className="h-3.5 w-3.5" />} onClick={() => void call(tidy.dupCancel())}>
                Cancel
              </Button>
            </div>
          </div>
          <ProgressBar
            indeterminate={progress?.phase !== 'hashing' || !progress.total}
            value={progress?.total ? progress.done / progress.total : 0}
          />
        </Card>
      )}

      {!dir && (
        <Card>
          <Empty icon={<Copy className="h-5 w-5" />} title="Pick a folder to check">
            Subfolders are included. Matching is by content (SHA-256), so renamed copies are found too.
          </Empty>
        </Card>
      )}

      {groups && groups.length === 0 && phase === 'idle' && (
        <Card>
          <Empty icon={<Copy className="h-5 w-5" />} title="No duplicates found">
            Files smaller than {formatBytes(settings.minDuplicateSize)} are ignored (change this in Settings).
          </Empty>
        </Card>
      )}

      {groups && groups.length > 0 && (
        <>
          <Card className="mb-4">
            <div className="flex flex-wrap items-center gap-4">
              <div className="min-w-[180px] flex-1">
                <div className="whitespace-nowrap text-2xl font-bold">
                  <span className="text-gradient">{formatBytes(reclaim)}</span>
                  <span className="ml-2 text-sm font-normal text-muted">reclaimable</span>
                </div>
                <div className="text-sm text-muted">
                  {groups.length.toLocaleString()} groups · {toRemove.length.toLocaleString()} extra copies
                </div>
              </div>
              <div className="flex items-center gap-1 rounded-xl border border-line bg-raised p-1" role="radiogroup" aria-label="Keep rule">
                {(
                  [
                    ['oldest', 'Keep oldest'],
                    ['newest', 'Keep newest'],
                    ['shortest', 'Keep shortest path']
                  ] as [Rule, string][]
                ).map(([r, label]) => (
                  <button
                    key={r}
                    role="radio"
                    aria-checked={rule === r}
                    onClick={() => applyRule(groups, r)}
                    className={cx(
                      'h-8 rounded-lg px-3 text-xs font-medium transition',
                      rule === r ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg'
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <Button
                variant="primary"
                icon={<Trash2 className="h-4 w-4" />}
                loading={phase === 'removing'}
                disabled={!toRemove.length}
                onClick={() => setConfirm(true)}
              >
                {settings.dryRun ? 'Simulate removal' : 'Move duplicates to Safe Bin'}
              </Button>
            </div>
          </Card>

          <div className="flex flex-col gap-3">
            {groups.slice(0, 300).map((g) => (
              <Card key={g.hash} className="p-4">
                <div className="flex gap-4">
                  <Thumb path={keep[g.hash] ?? g.files[0].path} />
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex items-center gap-2 text-sm">
                      <span className="font-semibold">{g.files.length} identical files</span>
                      <span className="text-muted">· {formatBytes(g.size)} each</span>
                      <Badge tone="accent">{formatBytes(g.size * (g.files.length - 1))} extra</Badge>
                    </div>
                    <ul className="flex flex-col gap-1">
                      {g.files.map((f) => {
                        const kept = keep[g.hash] === f.path
                        return (
                          <li key={f.path} className={cx('flex items-center gap-3 rounded-lg px-2 py-1.5 text-xs', kept ? 'bg-emerald-500/10' : 'hover:bg-raised/60')}>
                            <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                              <input
                                type="radio"
                                name={g.hash}
                                checked={kept}
                                onChange={() => setKeep((k) => ({ ...k, [g.hash]: f.path }))}
                                className="accent-emerald-500"
                                aria-label={`Keep ${f.path}`}
                              />
                              <span className="selectable truncate" title={f.path}>
                                {f.path}
                              </span>
                            </label>
                            {kept ? <Badge tone="success">Keep</Badge> : <Badge tone="danger">Remove</Badge>}
                            <span className="w-28 shrink-0 text-right text-muted">{new Date(f.mtimeMs).toLocaleDateString()}</span>
                            <button
                              aria-label="Show in folder"
                              title="Show in folder"
                              className="shrink-0 rounded-md p-1 text-muted hover:bg-raised hover:text-fg"
                              onClick={() => void call(tidy.showInFolder(f.path))}
                            >
                              <FolderOpen className="h-3.5 w-3.5" />
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                </div>
              </Card>
            ))}
            {groups.length > 300 && (
              <div className="text-center text-xs text-muted">
                Showing the 300 largest groups; the rest will be removed using the “{rule}” rule too.
              </div>
            )}
          </div>
        </>
      )}

      <ConfirmDialog
        open={confirm}
        title={settings.dryRun ? 'Simulate removing duplicates?' : 'Move duplicates to the Safe Bin?'}
        body={
          settings.dryRun
            ? `Dry run is on. ${toRemove.length.toLocaleString()} copies (${formatBytes(reclaim)}) will be listed but not touched.`
            : `${toRemove.length.toLocaleString()} copies (${formatBytes(reclaim)}) will move to the Safe Bin. One file in every group is kept. You can restore them for ${settings.holdHours} hours.`
        }
        confirmLabel={settings.dryRun ? 'Simulate' : 'Move to Safe Bin'}
        onCancel={() => setConfirm(false)}
        onConfirm={() => void remove()}
      />
    </>
  )
}
