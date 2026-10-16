import { FlaskConical, Minus, Square, X } from 'lucide-react'
import { tidy, useSettings } from '../api'

export function TitleBar(): JSX.Element {
  const { settings } = useSettings()
  const btn = 'no-drag flex h-9 w-11 items-center justify-center text-muted transition hover:bg-raised hover:text-fg'
  return (
    <div className="drag flex h-9 shrink-0 items-center justify-between border-b border-line/60 bg-surface/60 pl-4">
      <div className="flex items-center gap-2 text-xs text-muted">
        <span className="font-medium">TidyDesk</span>
        {settings.dryRun && (
          <span className="flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-amber-600 dark:text-amber-300">
            <FlaskConical className="h-3 w-3" /> DRY RUN
          </span>
        )}
      </div>
      <div className="flex">
        <button aria-label="Minimize" className={btn} onClick={() => tidy.win.minimize()}>
          <Minus className="h-4 w-4" />
        </button>
        <button aria-label="Maximize" className={btn} onClick={() => tidy.win.maximize()}>
          <Square className="h-3.5 w-3.5" />
        </button>
        <button
          aria-label="Close"
          className="no-drag flex h-9 w-11 items-center justify-center text-muted transition hover:bg-rose-500 hover:text-white"
          onClick={() => tidy.win.close()}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
