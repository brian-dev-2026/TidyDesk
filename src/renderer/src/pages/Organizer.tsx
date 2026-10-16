import { useEffect, useState } from 'react'
import { CheckCircle2, FlaskConical, SlidersHorizontal, Undo2, Wand2 } from 'lucide-react'
import type { HistoryEntry } from '@shared/types'
import { call, tidy, toast, useSettings } from '../api'
import { Button, Card, cx, Empty, PageHeader } from '../components/ui'
import { CategoryEditor } from '../components/CategoryEditor'
import { DropZone } from '../components/DropZone'
import { FolderList } from '../components/FolderList'

const files = (n: number): string => `${n.toLocaleString()} file${n === 1 ? '' : 's'}`

function basename(p: string): string {
  return p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p
}

export function OrganizerPage(): JSX.Element {
  const { settings, update } = useSettings()
  const [editing, setEditing] = useState(false)
  const [defaults, setDefaults] = useState<string[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [results, setResults] = useState<HistoryEntry[] | null>(null)

  useEffect(() => {
    void call(tidy.autoFolders()).then((f) => f && setDefaults(f.organize))
  }, [settings.organizeFolders])

  const folders = settings.organizeFolders ?? defaults
  const label = folders.length === 1 ? `Organize ${basename(folders[0])}` : `Organize ${folders.length} folders`

  const run = async (dirs?: string[]): Promise<void> => {
    setBusy('run')
    setResults(null)
    const r = await call(tidy.organizeAuto(dirs))
    setBusy(null)
    if (!r) return
    setResults(r.entries)
    for (const e of r.errors) toast.error(`${basename(e.dir)}: ${e.error}`)
    const moved = r.entries.reduce((n, e) => n + e.count, 0)
    if (moved && !r.entries[0].dryRun) toast.success(`Organized ${files(moved)}`)
  }

  const undo = async (id: string): Promise<void> => {
    setBusy(id)
    const e = await call(tidy.organizeUndo(id))
    setBusy(null)
    if (e) {
      setResults((rs) => (rs ?? []).map((x) => (x.id === e.id ? e : x)))
      toast.success('Every file is back where it was')
    }
  }

  return (
    <DropZone onFolder={(d) => void run([d])}>
      <PageHeader
        title="Organizer"
        subtitle="One click sorts the loose files in your folders into Images, Documents, Videos and more. Shortcuts and subfolders stay where they are."
      />

      <Card className="mb-5">
        <div className="flex flex-wrap items-center gap-4">
          <div className="min-w-0 flex-1">
            <div className="mb-2 text-sm font-medium">Folders to organize</div>
            <FolderList
              folders={folders}
              custom={settings.organizeFolders !== undefined}
              disabled={busy !== null}
              onChange={(f) => void update({ organizeFolders: f as string[] })}
            />
          </div>
          <Button
            variant="primary"
            className="h-11 px-6 text-base"
            icon={<Wand2 className="h-5 w-5" />}
            loading={busy === 'run'}
            disabled={!folders.length || (busy !== null && busy !== 'run')}
            onClick={() => void run()}
          >
            {settings.dryRun ? `Simulate: ${label}` : label}
          </Button>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <span className="text-sm text-muted">Sort by</span>
          <div className="flex items-center gap-1 rounded-xl border border-line bg-raised p-1" role="radiogroup" aria-label="Sort by">
            {(
              [
                ['type', 'Type'],
                ['date', 'Date (year / month)']
              ] as const
            ).map(([m, text]) => (
              <button
                key={m}
                role="radio"
                aria-checked={settings.organizeMode === m}
                onClick={() => void update({ organizeMode: m })}
                className={cx(
                  'h-8 rounded-lg px-3 text-xs font-medium transition',
                  settings.organizeMode === m ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg'
                )}
              >
                {text}
              </button>
            ))}
          </div>
          {settings.organizeMode === 'type' && (
            <Button className="h-8 px-3 text-xs" icon={<SlidersHorizontal className="h-3.5 w-3.5" />} onClick={() => setEditing(true)}>
              Customize categories
            </Button>
          )}
          <span className="text-xs text-muted">Tip: drop any folder here to organize it once.</span>
        </div>
      </Card>
      <CategoryEditor open={editing} onClose={() => setEditing(false)} />

      {results && results.length === 0 && (
        <Card>
          <Empty icon={<CheckCircle2 className="h-5 w-5" />} title="Already tidy">
            There were no loose files to sort.
          </Empty>
        </Card>
      )}

      {results?.map((r) => (
        <Card key={r.id} className={r.dryRun ? 'mb-3 border-amber-500/30 bg-amber-500/5' : 'mb-3'}>
          <div className="flex items-center gap-4">
            <div
              className={
                r.dryRun
                  ? 'flex h-11 w-11 items-center justify-center rounded-xl bg-amber-500/15 text-amber-500'
                  : 'flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-500'
              }
            >
              {r.dryRun ? <FlaskConical className="h-5 w-5" /> : <CheckCircle2 className="h-5 w-5" />}
            </div>
            <div className="flex-1">
              <div className="font-semibold">
                {r.dryRun
                  ? `${r.title.replace(/^Organized /, '')}: ${files(r.count)} would be moved. Nothing was changed.`
                  : r.status === 'undone'
                    ? `${r.title.replace(/^Organized /, '')}: undone — every file is back in its place`
                    : `${r.title} — moved ${files(r.count)}`}
              </div>
              {!r.dryRun && r.skipped > 0 && (
                <div className="text-sm text-muted">{files(r.skipped)} could not be moved (in use) and were left in place.</div>
              )}
              {!r.dryRun && r.status === 'applied' && <div className="text-sm text-muted">You can also undo this later from the Dashboard.</div>}
            </div>
            {!r.dryRun && r.status === 'applied' && (
              <Button
                icon={<Undo2 className="h-4 w-4" />}
                loading={busy === r.id}
                onClick={() => void undo(r.id)}
                disabled={settings.dryRun}
                title={settings.dryRun ? 'Turn off Dry run to change files' : undefined}
              >
                Undo
              </Button>
            )}
          </div>
        </Card>
      ))}
    </DropZone>
  )
}
