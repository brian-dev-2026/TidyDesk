import type { RecycleInfo, Settings } from '@shared/types'
import type { HistoryStore } from './history'
import { getLog } from './logger'

export interface SchedulerDeps {
  safeBin: { purgeExpired(): Promise<number> }
  settings: { get(): Promise<Settings> }
  sweep: (hours: number) => Promise<RecycleInfo>
  /** Runs a scheduled junk clean when one is due (it decides itself). */
  autoClean?: () => Promise<void>
  history: HistoryStore
  onChange: () => void
  intervalMs?: number
  runImmediately?: boolean
}

/** Purges expired Safe Bin batches and sweeps the Windows Recycle Bin on startup and every few minutes. */
export function startScheduler(deps: SchedulerDeps): { stop(): void; tick(): Promise<void> } {
  let running = false

  async function tick(): Promise<void> {
    if (running) return
    running = true
    let changed = false
    try {
      const s = await deps.settings.get()
      // nothing runs in dry run, or before the user has seen the notice explaining the sweep
      if (s.dryRun || !s.firstRunNoticeSeen) return
      try {
        changed = (await deps.safeBin.purgeExpired()) > 0
      } catch (e) {
        getLog().error('Safe Bin purge failed', e)
      }
      if (deps.autoClean && !(await deps.settings.get()).dryRun) {
        try {
          await deps.autoClean()
        } catch (e) {
          getLog().error('Automatic junk clean failed', e)
        }
      }
      // the purge can take a while; respect dry run if it was switched on meanwhile
      if (s.sweepWindowsRecycleBin && !(await deps.settings.get()).dryRun) {
        try {
          const r = await deps.sweep(s.holdHours)
          if (r.count > 0) {
            await deps.history.add({
              id: deps.history.newId(),
              type: 'recycle-sweep',
              title: `Recycle Bin: ${r.count} items older than ${s.holdHours}h permanently deleted`,
              createdAt: Date.now(),
              status: 'done',
              count: r.count,
              bytes: r.bytes,
              skipped: 0
            })
            changed = true
          }
        } catch (e) {
          getLog().error('Recycle Bin sweep failed', e)
        }
      }
    } catch (e) {
      getLog().error('Scheduler tick failed', e)
    } finally {
      running = false
      if (changed) deps.onChange()
    }
  }

  if (deps.runImmediately !== false) void tick()
  const timer = setInterval(() => void tick(), deps.intervalMs ?? 300000)
  return { stop: () => clearInterval(timer), tick }
}
