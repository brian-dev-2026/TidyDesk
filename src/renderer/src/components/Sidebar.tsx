import { Copy, FlaskConical, FolderTree, FolderX, HardDrive, LayoutDashboard, Settings, Sparkles, Trash2 } from 'lucide-react'
import { useSettings } from '../api'
import { cx, Toggle } from './ui'

export type Page = 'dashboard' | 'junk' | 'organizer' | 'duplicates' | 'large' | 'empty' | 'settings'

const NAV: { id: Page; label: string; icon: typeof Copy }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'junk', label: 'Junk Cleaner', icon: Trash2 },
  { id: 'organizer', label: 'Organizer', icon: FolderTree },
  { id: 'duplicates', label: 'Duplicates', icon: Copy },
  { id: 'large', label: 'Large Files', icon: HardDrive },
  { id: 'settings', label: 'Settings', icon: Settings }
]

export function Sidebar({ page, onNavigate }: { page: Page; onNavigate: (p: Page) => void }): JSX.Element {
  const { settings, update } = useSettings()
  return (
    <aside className="flex w-[232px] shrink-0 flex-col border-r border-line/60 bg-surface/50 p-4">
      <div className="mb-8 flex items-center gap-3 px-2 pt-1">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 text-white shadow-glow">
          <Sparkles className="h-5 w-5" />
        </div>
        <div>
          <div className="font-semibold leading-tight">TidyDesk</div>
          <div className="text-[11px] text-muted">Keep your PC tidy</div>
        </div>
      </div>

      <nav className="flex flex-col gap-1" aria-label="Main">
        {NAV.map(({ id, label, icon: Icon }) => {
          const active = id === page
          return (
            <button
              key={id}
              onClick={() => onNavigate(id)}
              aria-current={active ? 'page' : undefined}
              className={cx(
                'flex h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium transition',
                active
                  ? 'bg-gradient-to-r from-indigo-500 to-violet-500 text-white shadow-glow'
                  : 'text-muted hover:bg-raised hover:text-fg'
              )}
            >
              <Icon className="h-[18px] w-[18px]" />
              {label}
            </button>
          )
        })}
      </nav>

      <div className="mt-auto rounded-xl border border-line bg-raised/60 p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <FlaskConical className={cx('h-4 w-4', settings.dryRun ? 'text-amber-500' : 'text-muted')} />
            Dry run
          </div>
          <Toggle label="Dry run" checked={settings.dryRun} onChange={(v) => void update({ dryRun: v })} />
        </div>
        <p className="mt-1.5 text-[11px] leading-snug text-muted">
          {settings.dryRun ? 'Simulating — nothing on disk will change.' : 'Off — actions really move files.'}
        </p>
      </div>
    </aside>
  )
}
