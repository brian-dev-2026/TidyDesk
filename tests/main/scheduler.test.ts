import { describe, it, expect } from 'vitest'
import path from 'path'
import { startScheduler } from '../../src/main/scheduler'
import { HistoryStore } from '../../src/main/history'
import { DEFAULT_SETTINGS } from '../../src/main/settings'
import type { Settings } from '../../src/shared/types'
import { tmpDir } from '../helpers/tmp'

async function setup(settings: Partial<Settings>, sweepResult: () => Promise<{ count: number; bytes: number }>) {
  const calls: string[] = []
  const history = new HistoryStore(path.join(await tmpDir(), 'data'))
  let changes = 0
  const sched = startScheduler({
    safeBin: {
      purgeExpired: async () => {
        calls.push('purge')
        return 0
      }
    },
    settings: { get: async () => ({ ...DEFAULT_SETTINGS, firstRunNoticeSeen: true, ...settings }) },
    sweep: async (h) => {
      calls.push(`sweep:${h}`)
      return sweepResult()
    },
    history,
    onChange: () => changes++,
    intervalMs: 10_000_000,
    runImmediately: false
  })
  sched.stop()
  return { calls, history, sched, changes: () => changes }
}

describe('scheduler', () => {
  it('tick purges then sweeps when enabled and logs entry', async () => {
    const { calls, history, sched } = await setup({ holdHours: 5 }, async () => ({ count: 3, bytes: 300 }))
    const before = (await history.list()).length
    await sched.tick()
    expect(calls).toEqual(['purge', 'sweep:5'])
    const list = await history.list()
    expect(list.length).toBe(before + 1)
    expect(list[0]).toMatchObject({
      type: 'recycle-sweep',
      status: 'done',
      count: 3,
      bytes: 300,
      title: 'Recycle Bin: 3 items older than 5h permanently deleted'
    })
  })

  it('tick does not sweep when disabled', async () => {
    const { calls, sched } = await setup({ sweepWindowsRecycleBin: false }, async () => ({ count: 1, bytes: 1 }))
    await sched.tick()
    expect(calls).toEqual(['purge'])
  })

  it('no history entry when sweep count is 0', async () => {
    const { history, sched } = await setup({}, async () => ({ count: 0, bytes: 0 }))
    const before = (await history.list()).length
    await sched.tick()
    expect((await history.list()).length).toBe(before)
  })

  it('tick swallows sweep errors', async () => {
    const { sched } = await setup({}, async () => {
      throw new Error('boom')
    })
    await expect(sched.tick()).resolves.toBeUndefined()
  })

  it('tick does nothing before the first-run notice is acknowledged', async () => {
    const { calls, sched } = await setup({ firstRunNoticeSeen: false }, async () => ({ count: 1, bytes: 1 }))
    await sched.tick()
    expect(calls).toEqual([])
  })

  it('tick does nothing in dry run', async () => {
    const { calls, sched } = await setup({ dryRun: true }, async () => ({ count: 1, bytes: 1 }))
    await sched.tick()
    expect(calls).toEqual([])
  })

  it('gap 9: dry run switched on during a tick stops the sweep', async () => {
    const calls: string[] = []
    let dry = false
    const history = new HistoryStore(path.join(await tmpDir(), 'data'))
    const sched = startScheduler({
      safeBin: {
        purgeExpired: async () => {
          calls.push('purge')
          dry = true // user flips dry run on while the purge is running
          return 0
        }
      },
      settings: { get: async () => ({ ...DEFAULT_SETTINGS, firstRunNoticeSeen: true, dryRun: dry }) },
      sweep: async () => {
        calls.push('sweep')
        return { count: 0, bytes: 0 }
      },
      history,
      onChange: () => {},
      intervalMs: 10_000_000,
      runImmediately: false
    })
    sched.stop()
    await sched.tick()
    expect(calls).toEqual(['purge'])
  })
})
