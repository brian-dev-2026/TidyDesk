import { Recycle, ShieldCheck, Sparkles } from 'lucide-react'
import { useSettings } from '../api'
import { Button } from './ui'

/** One-time explanation of the Safe Bin and the Recycle Bin auto-sweep. */
export function FirstRunNotice(): JSX.Element | null {
  const { settings, update } = useSettings()
  if (settings.firstRunNoticeSeen) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-6 backdrop-blur-sm animate-fade-in">
      <div role="dialog" aria-modal="true" aria-label="Welcome to TidyDesk" className="w-full max-w-lg rounded-2xl border border-line bg-surface p-7 shadow-2xl">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 text-white shadow-glow">
            <Sparkles className="h-5 w-5" />
          </div>
          <h2 className="text-lg font-semibold">Welcome to TidyDesk</h2>
        </div>
        <div className="flex flex-col gap-4 text-sm">
          <div className="flex gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
            <p>
              <span className="font-medium">Nothing is deleted straight away.</span>{' '}
              <span className="text-muted">
                Cleaned junk and removed duplicates go to TidyDesk's Safe Bin and can be restored from the Dashboard for{' '}
                {settings.holdHours} hours. After that they are deleted permanently and the space is freed.
              </span>
            </p>
          </div>
          <div className="flex gap-3">
            <Recycle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
            <p>
              <span className="font-medium">Windows Recycle Bin auto-sweep is on.</span>{' '}
              <span className="text-muted">
                Anything that has been in the Windows Recycle Bin for more than {settings.holdHours} hours is deleted
                permanently — including files you deleted yourself in Explorer. You can turn this off now or later in
                Settings.
              </span>
            </p>
          </div>
        </div>
        <div className="mt-7 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => void update({ firstRunNoticeSeen: true, sweepWindowsRecycleBin: false })}>
            Turn off sweep
          </Button>
          <Button variant="primary" onClick={() => void update({ firstRunNoticeSeen: true })}>
            OK, got it
          </Button>
        </div>
      </div>
    </div>
  )
}
