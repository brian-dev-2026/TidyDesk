import type { Settings } from '@shared/types'
import { useSettings } from '../api'
import { Card, Checkbox, cx } from './ui'

const CATEGORIES: { id: string; label: string }[] = [
  { id: 'user-temp', label: 'User temp files' },
  { id: 'windows-temp', label: 'Windows temp files' },
  { id: 'browser-cache', label: 'Browser cache' },
  { id: 'thumbnails', label: 'Thumbnail cache' },
  { id: 'crash-dumps', label: 'Crash dumps & error reports' }
]

/** Settings card for the scheduled junk clean. */
export function AutoCleanCard(): JSX.Element {
  const { settings, update } = useSettings()
  const freq: [Settings['autoClean'], string][] = [
    ['off', 'Off'],
    ['daily', 'Daily'],
    ['weekly', 'Weekly']
  ]
  const toggle = (id: string, on: boolean): void => {
    const next = on ? [...settings.autoCleanCategories, id] : settings.autoCleanCategories.filter((c) => c !== id)
    void update({ autoCleanCategories: next })
  }
  return (
    <Card
      title="Scheduled clean"
      subtitle="Cleans junk by itself in the background. Everything goes to the Safe Bin first and you get a notification."
      className="mb-5"
      actions={
        <div className="flex items-center gap-1 rounded-xl border border-line bg-raised p-1" role="radiogroup" aria-label="Scheduled clean frequency">
          {freq.map(([f, label]) => (
            <button
              key={f}
              role="radio"
              aria-checked={settings.autoClean === f}
              onClick={() => void update({ autoClean: f })}
              className={cx(
                'h-8 rounded-lg px-3 text-xs font-medium transition',
                settings.autoClean === f ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg'
              )}
            >
              {label}
            </button>
          ))}
        </div>
      }
    >
      <div className={cx('grid grid-cols-2 gap-2', settings.autoClean === 'off' && 'opacity-50')}>
        {CATEGORIES.map((c) => (
          <label key={c.id} className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox label={c.label} checked={settings.autoCleanCategories.includes(c.id)} onChange={(v) => toggle(c.id, v)} />
            {c.label}
          </label>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted">
        {settings.lastAutoClean ? `Last run: ${new Date(settings.lastAutoClean).toLocaleString()}` : 'Has not run yet.'}
        {settings.autoClean !== 'off' && ' · Paused while Dry run is on.'}
      </p>
    </Card>
  )
}
