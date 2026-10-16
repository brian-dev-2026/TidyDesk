import { describe, it, expect } from 'vitest'
import path from 'path'
import fs from 'fs/promises'
import { isAutoCleanDue, runAutoClean } from '../../src/main/autoclean'
import { SettingsStore, DEFAULT_SETTINGS } from '../../src/main/settings'
import { SafeBin } from '../../src/main/safebin'
import { HistoryStore } from '../../src/main/history'
import { tmpDir, write, exists } from '../helpers/tmp'

const H = 3600000
const D = 24 * H

describe('isAutoCleanDue', () => {
  const s = (o: object) => ({ ...DEFAULT_SETTINGS, ...o })
  const now = 1_000 * D
  it.each([
    [{ autoClean: 'off' }, false],
    [{ autoClean: 'off', lastAutoClean: 0 }, false],
    [{ autoClean: 'daily' }, true],
    [{ autoClean: 'daily', lastAutoClean: now - 23 * H }, false],
    [{ autoClean: 'daily', lastAutoClean: now - 25 * H }, true],
    [{ autoClean: 'weekly', lastAutoClean: now - 6 * D }, false],
    [{ autoClean: 'weekly', lastAutoClean: now - 8 * D }, true],
    [{ autoClean: 'weekly' }, true]
  ])('%j → %s', (o, due) => {
    expect(isAutoCleanDue(s(o), now)).toBe(due)
  })
})

async function setup() {
  const root = await tmpDir()
  const settings = new SettingsStore(path.join(root, 'data'))
  await settings.set({ autoClean: 'daily', firstRunNoticeSeen: true })
  const safeBin = new SafeBin({ history: new HistoryStore(path.join(root, 'data')), holdHours: () => 5, binRootFor: () => path.join(root, 'bin') })
  return { root, settings, safeBin }
}

describe('runAutoClean', () => {
  it('quarantines found files, sets lastAutoClean and notifies', async () => {
    const { root, settings, safeBin } = await setup()
    const f = await write(path.join(root, 'temp', 'old.tmp'), '12345')
    const past = new Date(Date.now() - 3 * H)
    await fs.utimes(f, past, past)
    const notified: number[] = []
    const scanned: string[][] = []
    const e = await runAutoClean({
      settings,
      safeBin,
      scan: async (ids) => {
        scanned.push(ids)
        return [f]
      },
      notify: (bytes) => notified.push(bytes),
      now: () => 5000
    })
    expect(scanned).toEqual([['user-temp', 'windows-temp', 'thumbnails', 'crash-dumps']])
    expect(e).toMatchObject({ title: 'Automatic junk clean', status: 'held', count: 1, bytes: 5 })
    expect(await exists(f)).toBe(false)
    expect(notified).toEqual([5])
    expect((await settings.get()).lastAutoClean).toBe(5000)
  })

  it('with nothing found sets lastAutoClean and does not notify', async () => {
    const { settings, safeBin } = await setup()
    const notified: number[] = []
    const e = await runAutoClean({ settings, safeBin, scan: async () => [], notify: (b) => notified.push(b), now: () => 7000 })
    expect(e).toBeNull()
    expect(notified).toEqual([])
    expect((await settings.get()).lastAutoClean).toBe(7000)
  })

  it('applies exclusions and the 1-hour rule', async () => {
    const { root, settings, safeBin } = await setup()
    const fresh = await write(path.join(root, 'temp', 'fresh.tmp'))
    const kept = await write(path.join(root, 'temp', 'keep', 'k.tmp'))
    const past = new Date(Date.now() - 3 * H)
    await fs.utimes(kept, past, past)
    await settings.set({ exclusions: [path.join(root, 'temp', 'keep')] })
    const e = await runAutoClean({ settings, safeBin, scan: async () => [fresh, kept], notify: () => {} })
    expect(e!.count).toBe(0)
    expect(await exists(fresh)).toBe(true)
    expect(await exists(kept)).toBe(true)
  })
})
