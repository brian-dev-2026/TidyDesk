import { useEffect, useState } from 'react'
import {
  ChevronDown,
  Copy,
  FolderX,
  HardDrive,
  FolderOpen,
  FolderTree,
  History,
  Recycle,
  RotateCcw,
  Trash2,
  Undo2
} from 'lucide-react'
import type { BinItem, HistoryEntry, Move } from '@shared/types'
import { formatBytes } from '@shared/format'
import { call, tidy, toast, useSettings } from '../api'
import { ConfirmDialog } from './ConfirmDialog'
import { announcePurge, announceRestore, reasonText } from '../messages'
import { Badge, Button, Countdown, cx, Empty, type Tone } from './ui'

const ICONS = {
  junk: Trash2,
  duplicates: Copy,
  organize: FolderTree,
  'recycle-sweep': Recycle,
  'large-files': HardDrive,
  'empty-folders': FolderX
}
const SHOWN = 200

function relTime(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000)
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function statusBadge(e: HistoryEntry): { tone: Tone; label: string } {
  switch (e.status) {
    case 'simulated':
      return { tone: 'warning', label: 'Dry run' }
    case 'held':
      return { tone: 'accent', label: 'In Safe Bin' }
    case 'partial':
      return { tone: 'accent', label: 'Partly restored' }
    case 'restored':
      return { tone: 'success', label: 'Restored' }
    case 'purged':
      return { tone: 'neutral', label: 'Deleted' }
    case 'applied':
      return { tone: 'success', label: 'Organized' }
    case 'undone':
      return { tone: 'neutral', label: 'Undone' }
    case 'skipped':
      return { tone: 'warning', label: 'Nothing moved' }
    default:
      return { tone: 'neutral', label: 'Done' }
  }
}

const ITEM_STATE: Record<BinItem['state'], { tone: Tone; label: string }> = {
  held: { tone: 'accent', label: 'In Safe Bin' },
  restored: { tone: 'success', label: 'Restored' },
  purged: { tone: 'neutral', label: 'Deleted' },
  skipped: { tone: 'danger', label: 'Skipped' },
  'would-remove': { tone: 'warning', label: 'Would remove' }
}

export function ActivityTimeline({ entries }: { entries: HistoryEntry[] }): JSX.Element {
  if (!entries.length) {
    return (
      <Empty icon={<History className="h-5 w-5" />} title="No activity yet">
        Everything TidyDesk cleans, moves or deletes shows up here, with a way to restore it.
      </Empty>
    )
  }
  return (
    <ol className="flex flex-col gap-2">
      {entries.map((e) => (
        <TimelineRow key={e.id} entry={e} />
      ))}
    </ol>
  )
}

function TimelineRow({ entry: e }: { entry: HistoryEntry }): JSX.Element {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirm, setConfirm] = useState(false)
  const { dryRun } = useSettings().settings
  const lock = dryRun ? { disabled: true, title: 'Turn off Dry run to change files' } : {}
  const Icon = ICONS[e.type]
  const badge = statusBadge(e)
  const held = e.status === 'held' || e.status === 'partial'

  const act = async (kind: 'restore' | 'purge' | 'undo'): Promise<void> => {
    setBusy(kind)
    const r = await call(
      kind === 'restore' ? tidy.restore(e.id) : kind === 'purge' ? tidy.purgeNow(e.id) : tidy.organizeUndo(e.id)
    )
    setBusy(null)
    if (!r) return
    if (kind === 'restore') announceRestore(r)
    else if (kind === 'purge') announcePurge(r)
    else toast.success('Organize undone — every file is back where it was')
  }

  const summary =
    e.type === 'organize'
      ? `${e.count.toLocaleString()} file${e.count === 1 ? '' : 's'} ${e.status === 'simulated' ? 'would move' : 'moved'}`
      : `${e.count.toLocaleString()} item${e.count === 1 ? '' : 's'} · ${formatBytes(e.bytes)}`

  return (
    <li className="rounded-xl border border-line bg-surface/70 transition hover:border-indigo-500/30">
      <div className="flex items-center gap-3 p-3">
        <div
          className={cx(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
            e.dryRun ? 'bg-amber-500/15 text-amber-500' : 'bg-indigo-500/10 text-indigo-500 dark:text-indigo-300'
          )}
        >
          <Icon className="h-4 w-4" />
        </div>
        <button
          className="min-w-0 flex-1 text-left"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          disabled={e.type === 'recycle-sweep'}
        >
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{e.title}</span>
            <Badge tone={badge.tone}>{badge.label}</Badge>
          </div>
          <div className="mt-0.5 text-xs text-muted">
            {relTime(e.createdAt)} · {summary}
            {e.skipped > 0 && ` · ${e.skipped.toLocaleString()} skipped`}
            {held && e.expiresAt && (
              <>
                {' · '}
                <span className="text-indigo-500 dark:text-indigo-300">
                  Restorable for <Countdown until={e.expiresAt} />
                </span>
              </>
            )}
            {e.status === 'purged' && e.purgedAt && ` · Permanently deleted ${new Date(e.purgedAt).toLocaleString()}`}
          </div>
        </button>
        <div className="flex shrink-0 items-center gap-1.5">
          {held && (
            <>
              <Button {...lock} icon={<RotateCcw className="h-3.5 w-3.5" />} loading={busy === 'restore'} onClick={() => act('restore')} className="h-8 px-3 text-xs">
                Restore all
              </Button>
              <Button {...lock} variant="ghost" icon={<Trash2 className="h-3.5 w-3.5" />} loading={busy === 'purge'} onClick={() => setConfirm(true)} className="h-8 px-3 text-xs">
                Delete now
              </Button>
            </>
          )}
          {e.type === 'organize' && e.status === 'applied' && (
            <Button {...lock} icon={<Undo2 className="h-3.5 w-3.5" />} loading={busy === 'undo'} onClick={() => act('undo')} className="h-8 px-3 text-xs">
              Undo
            </Button>
          )}
          {e.type !== 'recycle-sweep' && (
            <button
              aria-label={open ? 'Hide details' : 'Show details'}
              onClick={() => setOpen((o) => !o)}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-raised hover:text-fg"
            >
              <ChevronDown className={cx('h-4 w-4 transition', open && 'rotate-180')} />
            </button>
          )}
        </div>
      </div>
      {open && <EntryDetails id={e.id} version={`${e.status}-${e.restoredBytes ?? 0}`} />}
      <ConfirmDialog
        open={confirm}
        danger
        title="Delete permanently?"
        body={`${formatBytes(e.bytes - (e.restoredBytes ?? 0) - (e.freedBytes ?? 0))} in this batch will be deleted for good. This cannot be undone.`}
        confirmLabel="Delete permanently"
        onCancel={() => setConfirm(false)}
        onConfirm={() => {
          setConfirm(false)
          void act('purge')
        }}
      />
    </li>
  )
}

function EntryDetails({ id, version }: { id: string; version: string }): JSX.Element {
  const [full, setFull] = useState<HistoryEntry | null>(null)
  const [busyPath, setBusyPath] = useState<string | null>(null)
  const { dryRun } = useSettings().settings

  useEffect(() => {
    void call(tidy.historyEntry(id)).then((e) => e && setFull(e))
  }, [id, version])

  if (!full) return <div className="border-t border-line px-4 py-3 text-xs text-muted">Loading…</div>

  const restoreOne = async (p: string): Promise<void> => {
    setBusyPath(p)
    const r = await call(tidy.restore(id, [p]))
    setBusyPath(null)
    if (r) {
      announceRestore(r)
      const again = await call(tidy.historyEntry(id))
      if (again) setFull(again)
    }
  }

  const items = full.items ?? []
  const moves = full.moves ?? []
  const total = items.length || moves.length
  return (
    <div className="border-t border-line px-3 py-2">
      <ul className="selectable max-h-80 overflow-y-auto text-xs">
        {items.slice(0, SHOWN).map((it) => (
          <li key={it.originalPath + it.binPath} className="flex items-center gap-3 rounded-lg px-1 py-1.5 hover:bg-raised/60">
            <Badge tone={ITEM_STATE[it.state].tone}>{ITEM_STATE[it.state].label}</Badge>
            <div className="min-w-0 flex-1">
              <div className="truncate" title={it.originalPath}>
                {it.originalPath}
              </div>
              {it.state === 'held' && (
                <div className="truncate text-muted" title={it.binPath}>
                  → {it.binPath}
                </div>
              )}
              {it.restoredTo && <div className="truncate text-muted">restored as {it.restoredTo}</div>}
              {it.reason && <div className="text-rose-500">{reasonText(it.reason)}</div>}
            </div>
            <span className="shrink-0 tabular-nums text-muted">{formatBytes(it.size)}</span>
            {it.state === 'held' && (
              <Button className="h-7 px-2 text-xs" disabled={dryRun} title={dryRun ? 'Turn off Dry run to change files' : undefined} loading={busyPath === it.originalPath} onClick={() => restoreOne(it.originalPath)}>
                Restore
              </Button>
            )}
            <button
              aria-label="Show in folder"
              title="Show in folder"
              className="shrink-0 rounded-md p-1 text-muted hover:bg-raised hover:text-fg"
              onClick={() => void call(tidy.showInFolder(it.state === 'held' ? it.binPath : it.restoredTo ?? it.originalPath))}
            >
              <FolderOpen className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
        {moves.slice(0, SHOWN).map((m: Move) => (
          <li key={m.from} className="flex items-center gap-3 rounded-lg px-1 py-1.5 hover:bg-raised/60">
            <Badge tone={full.status === 'simulated' ? 'warning' : m.done ? 'success' : 'neutral'}>
              {full.status === 'simulated' ? 'Would move' : m.done ? 'Moved' : full.status === 'undone' ? 'Moved back' : 'Skipped'}
            </Badge>
            <div className="min-w-0 flex-1">
              <div className="truncate" title={m.from}>
                {m.from}
              </div>
              <div className="truncate text-muted" title={m.to}>
                → {m.to}
              </div>
            </div>
            <button
              aria-label="Show in folder"
              title="Show in folder"
              className="shrink-0 rounded-md p-1 text-muted hover:bg-raised hover:text-fg"
              onClick={() => void call(tidy.showInFolder(m.done ? m.to : m.from))}
            >
              <FolderOpen className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
      </ul>
      {total > SHOWN && <div className="px-1 py-1.5 text-xs text-muted">+{(total - SHOWN).toLocaleString()} more</div>}
    </div>
  )
}
