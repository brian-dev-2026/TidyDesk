import { Folder, FolderPlus, RotateCcw, X } from 'lucide-react'
import { call, tidy } from '../api'
import { Button } from './ui'

function basename(p: string): string {
  return p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p
}

/** The folders a one-click action works on, with add / remove / reset. */
export function FolderList({
  folders,
  custom,
  disabled,
  onChange
}: {
  folders: string[]
  /** true when the user changed the list (so "Use defaults" is offered) */
  custom: boolean
  disabled?: boolean
  /** null resets to the defaults */
  onChange: (folders: string[] | null) => void
}): JSX.Element {
  const add = async (): Promise<void> => {
    const d = await call(tidy.pickFolder())
    if (d && !folders.some((f) => f.toLowerCase() === d.toLowerCase())) onChange([...folders, d])
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {folders.map((f) => (
        <span key={f} title={f} className="flex h-8 items-center gap-1.5 rounded-lg border border-line bg-raised pl-2.5 pr-1 text-xs font-medium">
          <Folder className="h-3.5 w-3.5 text-muted" />
          {basename(f)}
          <button
            aria-label={`Remove ${basename(f)}`}
            disabled={disabled}
            className="rounded-md p-1 text-muted hover:bg-surface hover:text-fg disabled:opacity-50"
            onClick={() => onChange(folders.filter((x) => x !== f))}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <Button className="h-8 px-3 text-xs" icon={<FolderPlus className="h-3.5 w-3.5" />} disabled={disabled} onClick={() => void add()}>
        Add folder
      </Button>
      {custom && (
        <Button variant="ghost" className="h-8 px-3 text-xs" icon={<RotateCcw className="h-3.5 w-3.5" />} disabled={disabled} onClick={() => onChange(null)}>
          Use defaults
        </Button>
      )}
    </div>
  )
}
