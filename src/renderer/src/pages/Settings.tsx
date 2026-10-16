import { useEffect, useState, type ReactNode } from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'
import type { Settings } from '@shared/types'
import { call, tidy, useSettings } from '../api'
import { Card, cx, PageHeader, Toggle } from '../components/ui'
import { ExclusionsCard } from '../components/ExclusionsCard'

function Row({ title, description, children }: { title: string; description: ReactNode; children: ReactNode }): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-6 py-4">
      <div className="min-w-0">
        <div className="text-sm font-medium">{title}</div>
        <div className="mt-0.5 text-xs text-muted">{description}</div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function NumberInput({
  value,
  min,
  max,
  suffix,
  label,
  onCommit
}: {
  value: number
  min: number
  max: number
  suffix: string
  label: string
  onCommit: (v: number) => void
}): JSX.Element {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  const commit = (): void => {
    const n = Math.round(Number(text))
    if (!Number.isFinite(n)) return setText(String(value))
    const clamped = Math.min(max, Math.max(min, n))
    setText(String(clamped))
    if (clamped !== value) onCommit(clamped)
  }
  return (
    <div className="flex items-center gap-2">
      <input
        aria-label={label}
        type="number"
        min={min}
        max={max}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
        className="h-9 w-20 rounded-xl border border-line bg-raised px-3 text-right text-sm tabular-nums"
      />
      <span className="text-sm text-muted">{suffix}</span>
    </div>
  )
}

export function SettingsPage(): JSX.Element {
  const { settings, update } = useSettings()
  const [version, setVersion] = useState('')
  useEffect(() => {
    void call(tidy.appVersion()).then((v) => v && setVersion(v))
  }, [])

  const themes: [Settings['theme'], string, typeof Sun][] = [
    ['system', 'System', Monitor],
    ['light', 'Light', Sun],
    ['dark', 'Dark', Moon]
  ]

  return (
    <>
      <PageHeader title="Settings" subtitle="How TidyDesk looks and how long it keeps things you can restore." />

      <Card title="Appearance" className="mb-5">
        <Row title="Theme" description="Follow Windows, or pick light or dark.">
          <div className="flex items-center gap-1 rounded-xl border border-line bg-raised p-1" role="radiogroup" aria-label="Theme">
            {themes.map(([t, label, Icon]) => (
              <button
                key={t}
                role="radio"
                aria-checked={settings.theme === t}
                onClick={() => void update({ theme: t })}
                className={cx(
                  'flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition',
                  settings.theme === t ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg'
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>
        </Row>
      </Card>

      <Card title="Safety" className="mb-5">
        <div className="divide-y divide-line">
          <Row
            title="Dry run"
            description="Simulate every action. Nothing is moved or deleted; results are logged on the Dashboard."
          >
            <Toggle label="Dry run" checked={settings.dryRun} onChange={(v) => void update({ dryRun: v })} />
          </Row>
          <Row
            title="Hold time"
            description="How long cleaned and removed files stay restorable in the Safe Bin before they are deleted permanently."
          >
            <NumberInput label="Hold time in hours" value={settings.holdHours} min={1} max={168} suffix="hours" onCommit={(v) => void update({ holdHours: v })} />
          </Row>
          <Row
            title="Windows Recycle Bin auto-sweep"
            description="Permanently deletes anything that has been in the Windows Recycle Bin longer than the hold time — including files you deleted outside TidyDesk."
          >
            <Toggle
              label="Windows Recycle Bin auto-sweep"
              checked={settings.sweepWindowsRecycleBin}
              onChange={(v) => void update({ sweepWindowsRecycleBin: v })}
            />
          </Row>
        </div>
      </Card>

      <ExclusionsCard />

      <Card title="Scanning & startup" className="mb-5">
        <div className="divide-y divide-line">
          <Row title="Minimum duplicate size" description="Smaller files are ignored when looking for duplicates.">
            <NumberInput
              label="Minimum duplicate size in KB"
              value={Math.round(settings.minDuplicateSize / 1024)}
              min={0}
              max={1048576}
              suffix="KB"
              onCommit={(v) => void update({ minDuplicateSize: v * 1024 })}
            />
          </Row>
          <Row title="Close to tray" description="Closing the window keeps TidyDesk running in the tray so timed clean-ups still happen.">
            <Toggle label="Close to tray" checked={settings.closeToTray} onChange={(v) => void update({ closeToTray: v })} />
          </Row>
          <Row title="Start with Windows" description="Starts minimised to the tray when you sign in.">
            <Toggle label="Start with Windows" checked={settings.startWithWindows} onChange={(v) => void update({ startWithWindows: v })} />
          </Row>
        </div>
      </Card>

      <p className="text-center text-xs text-muted">TidyDesk {version} · MIT License</p>
    </>
  )
}
