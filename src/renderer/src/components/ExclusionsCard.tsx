import { File, FolderOpen, FolderPlus, FilePlus, Lock, X } from 'lucide-react'
import { call, tidy, toast, useSettings } from '../api'
import { Button, Card } from './ui'

const BUILT_IN = ['Windows folder', 'Program Files', 'Program Files (x86)', 'ProgramData', 'Drive roots (e.g. C:\\)', 'TidyDesk Safe Bin']

/** Settings card for paths TidyDesk must never touch. */
export function ExclusionsCard(): JSX.Element {
  const { settings, update } = useSettings()
  const list = settings.exclusions

  const add = async (kind: 'folder' | 'file'): Promise<void> => {
    const p = await call(kind === 'folder' ? tidy.pickFolder() : tidy.pickFile())
    if (!p) return
    if (list.some((e) => e.toLowerCase() === p.toLowerCase())) return toast.info('Already excluded')
    await update({ exclusions: [...list, p] })
    toast.success(`TidyDesk will never touch ${p}`)
  }

  return (
    <Card
      title="Exclusions"
      subtitle="Folders and files TidyDesk never lists, moves or deletes — in every feature, including automatic ones."
      className="mb-5"
      actions={
        <>
          <Button className="h-8 px-3 text-xs" icon={<FolderPlus className="h-3.5 w-3.5" />} onClick={() => void add('folder')}>
            Add folder…
          </Button>
          <Button className="h-8 px-3 text-xs" icon={<FilePlus className="h-3.5 w-3.5" />} onClick={() => void add('file')}>
            Add file…
          </Button>
        </>
      }
    >
      <ul className="flex flex-col gap-1 text-sm">
        {list.length === 0 && <li className="py-1 text-xs text-muted">No exclusions yet.</li>}
        {list.map((p) => (
          <li key={p} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-raised/60">
            {/\.[^\\/]+$/.test(p) ? <File className="h-4 w-4 text-muted" /> : <FolderOpen className="h-4 w-4 text-muted" />}
            <span className="selectable min-w-0 flex-1 truncate" title={p}>
              {p}
            </span>
            <button
              aria-label={`Remove exclusion ${p}`}
              className="rounded-md p-1 text-muted hover:bg-raised hover:text-fg"
              onClick={() => void update({ exclusions: list.filter((e) => e !== p) })}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-3 border-t border-line pt-3">
        <div className="mb-1.5 text-xs font-medium text-muted">Always protected (built in)</div>
        <div className="flex flex-wrap gap-1.5">
          {BUILT_IN.map((b) => (
            <span key={b} className="inline-flex items-center gap-1 rounded-full border border-line bg-raised px-2 py-0.5 text-[11px] text-muted">
              <Lock className="h-3 w-3" /> {b}
            </span>
          ))}
        </div>
      </div>
    </Card>
  )
}
