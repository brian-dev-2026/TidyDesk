import { describe, it, expect } from 'vitest'
import fs from 'fs/promises'
import path from 'path'
import { SettingsStore, DEFAULT_SETTINGS } from '../../src/main/settings'
import { tmpDir } from '../helpers/tmp'

describe('SettingsStore', () => {
  it('defaults match spec', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      theme: 'system',
      holdHours: 5,
      sweepWindowsRecycleBin: true,
      minDuplicateSize: 1024,
      closeToTray: true,
      startWithWindows: false,
      firstRunNoticeSeen: false,
      dryRun: false
    })
  })

  it('returns defaults then persists set', async () => {
    const d = await tmpDir()
    const s = new SettingsStore(d)
    expect(await s.get()).toEqual(DEFAULT_SETTINGS)
    const next = await s.set({ holdHours: 2, dryRun: true })
    expect(next.holdHours).toBe(2)
    expect(await new SettingsStore(d).get()).toEqual({ ...DEFAULT_SETTINGS, holdHours: 2, dryRun: true })
  })

  it('corrupt settings fall back to defaults', async () => {
    const d = await tmpDir()
    await fs.writeFile(path.join(d, 'settings.json'), 'nope')
    expect(await new SettingsStore(d).get()).toEqual(DEFAULT_SETTINGS)
  })
})
