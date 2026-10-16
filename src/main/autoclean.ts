import type { HistoryEntry, Settings } from '@shared/types'
import type { SettingsStore } from './settings'
import type { SafeBin } from './safebin'

const HOUR = 3600000
const INTERVAL: Record<Exclude<Settings['autoClean'], 'off'>, number> = {
  daily: 24 * HOUR,
  weekly: 7 * 24 * HOUR
}

export function isAutoCleanDue(s: Settings, now: number): boolean {
  if (s.autoClean === 'off') return false
  if (s.lastAutoClean === undefined) return true
  return now - s.lastAutoClean >= INTERVAL[s.autoClean]
}

export interface AutoCleanDeps {
  settings: SettingsStore
  safeBin: SafeBin
  /** Returns the junk files of the given categories, with exclusions already applied. */
  scan: (categoryIds: string[], exclusions: string[]) => Promise<string[]>
  notify: (bytes: number, holdHours: number) => void
  now?: () => number
}

/** One automatic junk clean through the Safe Bin. Returns the history entry, or null if nothing was found. */
export async function runAutoClean(deps: AutoCleanDeps): Promise<HistoryEntry | null> {
  const now = deps.now ?? Date.now
  const s = await deps.settings.get()
  const files = await deps.scan(s.autoCleanCategories, s.exclusions)
  // recorded even when nothing was found, so the next attempt waits a full interval
  await deps.settings.set({ lastAutoClean: now() })
  if (!files.length) return null
  // the scan can take a while: use the settings as they are now, not as they were when it started
  const cur = await deps.settings.get()
  const entry = await deps.safeBin.quarantine(files, {
    type: 'junk',
    title: 'Automatic junk clean',
    exclusions: cur.exclusions,
    dryRun: cur.dryRun,
    skipNewerThan: Date.now() - HOUR
  })
  if (entry.count > 0 && !entry.dryRun) deps.notify(entry.bytes, cur.holdHours)
  return entry
}
