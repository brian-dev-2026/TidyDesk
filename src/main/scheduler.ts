import type { RecycleInfo, Settings } from '@shared/types'
import type { HistoryStore } from './history'

export interface SchedulerDeps {
  safeBin: { purgeExpired(): Promise<number> }
  settings: { get(): Promise<Settings> }
  sweep: (hours: number) => Promise<RecycleInfo>
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
        console.error('Safe Bin purge failed', e)
      }
      if (s.sweepWindowsRecycleBin) {
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
          console.error('Recycle Bin sweep failed', e)
        }
      }
    } catch (e) {
      console.error('Scheduler tick failed', e)
    } finally {
      running = false
      if (changed) deps.onChange()
    }
  }

  if (deps.runImmediately !== false) void tick()
  const timer = setInterval(() => void tick(), deps.intervalMs ?? 300000)
  return { stop: () => clearInterval(timer), tick }
}
