import { useMemo, useState } from 'react'
import { CheckCircle2, FlaskConical, FolderOpen, FolderTree, Undo2, Wand2 } from 'lucide-react'
import type { HistoryEntry, Move } from '@shared/types'
import { call, tidy, toast, useSettings } from '../api'
import { Badge, Button, Card, Checkbox, Empty, PageHeader } from '../components/ui'

function relativeTo(dir: string, p: string): string {
  return p.toLowerCase().startsWith(dir.toLowerCase()) ? p.slice(dir.length).replace(/^[\\/]/, '') : p
}

function basename(p: string): string {
  return p.split(/[\\/]/).pop() ?? p
}

export function OrganizerPage(): JSX.Element {
  const { settings } = useSettings()
  const [dir, setDir] = useState<string | null>(null)
  const [plan, setPlan] = useState<Move[] | null>(null)
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<'plan' | 'apply' | 'undo' | null>(null)
  const [result, setResult] = useState<HistoryEntry | null>(null)

  const choose = async (): Promise<void> => {
    const d = await call(tidy.pickFolder())
    if (!d) return
    setDir(d)
    setResult(null)
    setBusy('plan')
    const p = await call(tidy.organizePlan(d))
    setBusy(null)
    setPlan(p ?? null)
    setExcluded(new Set())
  }

  const chosen = useMemo(() => (plan ?? []).filter((m) => !excluded.has(m.from)), [plan, excluded])
  const counts = useMemo(() => {
    const c = new Map<string, number>()
    for (const m of chosen) c.set(m.category, (c.get(m.category) ?? 0) + 1)
    return [...c].sort((a, b) => b[1] - a[1])
  }, [chosen])

  const apply = async (): Promise<void> => {
    if (!dir) return
    setBusy('apply')
    const e = await call(tidy.organizeApply(dir, chosen))
    setBusy(null)
    if (e) {
      setResult(e)
      if (!e.dryRun) setPlan(null) // after a dry run the preview stays, ready to run for real
      if (!e.dryRun) toast.success(`Organized ${e.count} files`)
    }
  }

  const undo = async (): Promise<void> => {
    if (!result) return
    setBusy('undo')
    const e = await call(tidy.organizeUndo(result.id))
    setBusy(null)
    if (e) {
      setResult(e)
      toast.success('Every file is back where it was')
    }
  }

  return (
    <>
      <PageHeader
        title="Organizer"
        subtitle="Sorts the files in a folder into Images, Documents, Videos and more. Subfolders are left alone."
        actions={
          <Button icon={<FolderOpen className="h-4 w-4" />} onClick={choose} loading={busy === 'plan'}>
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
            <div className="flex-1">
              <div className="font-semibold">
                {result.dryRun
                  ? `Dry run — ${result.count} files would be moved. Nothing was changed.`
                  : result.status === 'undone'
                    ? 'Undone — every file is back in its original place'
                    : `Moved ${result.count} files`}
              </div>
              {!result.dryRun && result.skipped > 0 && (
                <div className="text-sm text-muted">{result.skipped} files could not be moved (in use) and were left in place.</div>
              )}
              {!result.dryRun && result.status === 'applied' && (
                <div className="text-sm text-muted">You can also undo this later from the Dashboard.</div>
              )}
            </div>
            {!result.dryRun && result.status === 'applied' && (
              <Button
                icon={<Undo2 className="h-4 w-4" />}
                loading={busy === 'undo'}
                onClick={undo}
                disabled={settings.dryRun}
                title={settings.dryRun ? 'Turn off Dry run to change files' : undefined}
              >
                Undo
              </Button>
            )}
          </div>
        </Card>
      )}

      {!dir && (
        <Card>
          <Empty icon={<FolderTree className="h-5 w-5" />} title="Pick a folder to tidy">
            Downloads and Desktop are good places to start. You will see a preview before anything moves.
          </Empty>
        </Card>
      )}

      {dir && plan && (
        <Card
          title={<span className="selectable">{dir}</span>}
          subtitle={plan.length ? `${chosen.length} of ${plan.length} files selected` : undefined}
          actions={
            plan.length > 0 && (
              <Button variant="primary" icon={<Wand2 className="h-4 w-4" />} loading={busy === 'apply'} disabled={!chosen.length} onClick={apply}>
                {settings.dryRun ? `Simulate organizing ${chosen.length} files` : `Organize ${chosen.length} files`}
              </Button>
            )
          }
        >
          {plan.length === 0 ? (
            <Empty icon={<CheckCircle2 className="h-5 w-5" />} title="Already tidy">
              There are no loose files at the top of this folder.
            </Empty>
          ) : (
            <>
              <div className="mb-4 flex flex-wrap gap-2">
                {counts.map(([cat, n]) => (
                  <Badge key={cat} tone="accent">
                    {cat} · {n}
                  </Badge>
                ))}
              </div>
              <div className="max-h-[420px] overflow-y-auto rounded-xl border border-line">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-raised text-left text-xs text-muted">
                    <tr>
                      <th className="w-10 px-3 py-2">
                        <Checkbox
                          label="Select all"
                          checked={excluded.size === 0}
                          onChange={(v) => setExcluded(v ? new Set() : new Set(plan.map((m) => m.from)))}
                        />
                      </th>
                      <th className="px-3 py-2 font-medium">File</th>
                      <th className="px-3 py-2 font-medium">Category</th>
                      <th className="px-3 py-2 font-medium">Moves to</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {plan.map((m) => (
                      <tr key={m.from} className={excluded.has(m.from) ? 'opacity-50' : ''}>
                        <td className="px-3 py-2">
                          <Checkbox
                            label={basename(m.from)}
                            checked={!excluded.has(m.from)}
                            onChange={(v) =>
                              setExcluded((s) => {
                                const n = new Set(s)
                                if (v) n.delete(m.from)
                                else n.add(m.from)
                                return n
                              })
                            }
                          />
                        </td>
                        <td className="max-w-[260px] truncate px-3 py-2" title={m.from}>
                          {basename(m.from)}
                        </td>
                        <td className="px-3 py-2 text-muted">{m.category}</td>
                        <td className="max-w-[260px] truncate px-3 py-2 text-muted" title={m.to}>
                          {relativeTo(dir, m.to)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Card>
      )}
    </>
  )
}
