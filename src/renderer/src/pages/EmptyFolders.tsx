import { useMemo, useState } from 'react'
import { CheckCircle2, FlaskConical, FolderOpen, FolderX, Undo2 } from 'lucide-react'
import type { HistoryEntry } from '@shared/types'
import { call, tidy, toast, useSettings } from '../api'
import { DropZone } from '../components/DropZone'
import { Button, Card, Checkbox, Empty, PageHeader } from '../components/ui'

export function EmptyFoldersPage(): JSX.Element {
  const { settings } = useSettings()
  const [dir, setDir] = useState<string | null>(null)
  const [found, setFound] = useState<string[] | null>(null)
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<'scan' | 'remove' | 'restore' | null>(null)
  const [result, setResult] = useState<HistoryEntry | null>(null)

  const scan = async (d: string): Promise<void> => {
    setDir(d)
    setResult(null)
    setBusy('scan')
    const r = await call(tidy.emptyScan(d))
    setBusy(null)
    setFound(r ?? null)
    setExcluded(new Set())
  }

  const choose = async (): Promise<void> => {
    const d = await call(tidy.pickFolder())
    if (d) void scan(d)
  }

  const chosen = useMemo(() => (found ?? []).filter((p) => !excluded.has(p)), [found, excluded])

  const remove = async (): Promise<void> => {
    setBusy('remove')
    const e = await call(tidy.emptyRemove(chosen))
    setBusy(null)
    if (!e) return
    setResult(e)
    if (!e.dryRun) setFound(null)
    if (!e.dryRun && e.skipped) toast.info(`${e.skipped} folders were skipped (no longer empty or excluded)`)
  }

  const restore = async (): Promise<void> => {
    if (!result) return
    setBusy('restore')
    const e = await call(tidy.emptyRestore(result.id))
    setBusy(null)
    if (e) {
      setResult(e)
      toast.success(`Recreated ${e.count} folders`)
    }
  }

  const depth = (p: string): number => (dir ? p.slice(dir.length).split(/[\\/]/).filter(Boolean).length - 1 : 0)
  const display = [...(found ?? [])].sort((a, b) => a.localeCompare(b))

  return (
    <DropZone onFolder={(d) => void scan(d)}>
      <PageHeader
        title="Empty Folders"
        subtitle="Folders with nothing inside — not even in their subfolders. Hidden, system and .git folders are never touched."
        actions={
          <Button icon={<FolderOpen className="h-4 w-4" />} onClick={choose} loading={busy === 'scan'}>
            {dir ? 'Choose another folder' : 'Choose folder'}
          </Button>
        }
      />

      {result && (
        <Card className={result.dryRun ? 'mb-5 border-amber-500/30 bg-amber-500/5' : 'mb-5'}>
          <div className="flex items-center gap-4">
            <div
              className={
                result.dryRun
                  ? 'flex h-11 w-11 items-center justify-center rounded-xl bg-amber-500/15 text-amber-500'
                  : 'flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-500'
              }
            >
              {result.dryRun ? <FlaskConical className="h-5 w-5" /> : <CheckCircle2 className="h-5 w-5" />}
            </div>
            <div className="flex-1 font-semibold">
              {result.dryRun
                ? `Dry run — ${result.count} empty folders would be removed. Nothing was changed.`
                : result.status === 'restored'
                  ? `Recreated ${result.count} folders`
                  : `Removed ${result.count} empty folders`}
            </div>
            {!result.dryRun && result.status === 'done' && result.count > 0 && (
              <Button
                icon={<Undo2 className="h-4 w-4" />}
                loading={busy === 'restore'}
                onClick={restore}
                disabled={settings.dryRun}
                title={settings.dryRun ? 'Turn off Dry run to change files' : undefined}
              >
                Restore
              </Button>
            )}
          </div>
        </Card>
      )}

      {!dir && (
        <Card>
          <Empty icon={<FolderX className="h-5 w-5" />} title="Pick a folder to check">
            You will see every empty folder first and choose which ones to remove. They can be recreated later.
          </Empty>
        </Card>
      )}

      {dir && found && found.length === 0 && (
        <Card>
          <Empty icon={<CheckCircle2 className="h-5 w-5" />} title="No empty folders">
            Nothing to tidy in this folder.
          </Empty>
        </Card>
      )}

      {dir && found && found.length > 0 && (
        <Card
          title={<span className="selectable">{dir}</span>}
          subtitle={`${chosen.length} of ${found.length} empty folders selected`}
          actions={
            <Button variant="primary" icon={<FolderX className="h-4 w-4" />} loading={busy === 'remove'} disabled={!chosen.length} onClick={remove}>
              {settings.dryRun ? `Simulate removing ${chosen.length}` : `Remove ${chosen.length} empty folders`}
            </Button>
          }
        >
          <ul className="max-h-[440px] overflow-y-auto">
            {display.map((p) => (
              <li key={p} className="flex items-center gap-3 rounded-lg py-1 pr-2 hover:bg-raised/60" style={{ paddingLeft: 8 + depth(p) * 18 }}>
                <Checkbox
                  label={p}
                  checked={!excluded.has(p)}
                  onChange={(v) =>
                    setExcluded((s) => {
                      const n = new Set(s)
                      if (v) n.delete(p)
                      else n.add(p)
                      return n
                    })
                  }
                />
                <FolderX className="h-4 w-4 shrink-0 text-muted" />
                <span className="selectable truncate text-sm" title={p}>
                  {p.slice(dir.length).replace(/^[\\/]/, '')}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </DropZone>
  )
}
