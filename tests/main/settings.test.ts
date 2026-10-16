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
      dryRun: false,
      autoDownloadUpdates: true,
      exclusions: [],
      autoClean: 'off',
      autoCleanCategories: ['user-temp', 'windows-temp', 'thumbnails', 'crash-dumps'],
      organizeMode: 'type'
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

  it('clamps holdHours and drops invalid values', async () => {
    const d = await tmpDir()
    await fs.writeFile(
      path.join(d, 'settings.json'),
      JSON.stringify({ holdHours: 0, theme: 'purple', dryRun: 'yes', minDuplicateSize: -5 })
    )
    const s = await new SettingsStore(d).get()
    expect(s.holdHours).toBe(1)
    expect(s.theme).toBe('system')
    expect(s.dryRun).toBe(false)
    expect(s.minDuplicateSize).toBe(0)
    const s2 = new SettingsStore(await tmpDir())
    expect((await s2.set({ holdHours: -3 })).holdHours).toBe(1)
    expect((await s2.set({ holdHours: 9999 })).holdHours).toBe(168)
    expect((await s2.set({ holdHours: 2.6 })).holdHours).toBe(3)
  })

  it('validates the v1.0 fields', async () => {
    const d = await tmpDir()
    await fs.writeFile(
      path.join(d, 'settings.json'),
      JSON.stringify({
        autoClean: 'hourly',
        organizeMode: 'x',
        autoDownloadUpdates: 'yes',
        exclusions: ['relative', 'C:\\\\keep'],
        autoCleanCategories: ['user-temp', 'nope', 7],
        lastAutoClean: -1
      })
    )
    const s = await new SettingsStore(d).get()
    expect(s.autoClean).toBe('off')
    expect(s.organizeMode).toBe('type')
    expect(s.autoDownloadUpdates).toBe(true)
    expect(s.exclusions).toEqual(['C:\\keep'])
    expect(s.autoCleanCategories).toEqual(['user-temp'])
    expect(s.lastAutoClean).toBeUndefined()
  })

  it('v1.0 defaults', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({
      autoDownloadUpdates: true,
      exclusions: [],
      autoClean: 'off',
      autoCleanCategories: ['user-temp', 'windows-temp', 'thumbnails', 'crash-dumps'],
      organizeMode: 'type'
    })
  })

  it('automatic folder lists keep absolute, unique paths and reset to defaults with null', async () => {
    const s = new SettingsStore(await tmpDir())
    expect((await s.get()).organizeFolders).toBeUndefined()
    const saved = await s.set({ organizeFolders: ['C:\\Desk\\', 'c:\\desk', 'relative'], duplicateFolders: ['D:\\Photos'] })
    expect(saved.organizeFolders).toEqual(['C:\\Desk'])
    expect(saved.duplicateFolders).toEqual(['D:\\Photos'])
    expect((await s.set({ organizeFolders: [] })).organizeFolders).toEqual([])
    expect((await s.set({ organizeFolders: null as never })).organizeFolders).toBeUndefined()
  })

  it('organizerCategories are validated on save and can be reset with null', async () => {
    const s = new SettingsStore(await tmpDir())
    expect((await s.set({ organizerCategories: { Pics: ['.PNG'] } })).organizerCategories).toEqual({ Pics: ['png'] })
    await expect(s.set({ organizerCategories: { Other: ['x'] } })).rejects.toThrow('reserved')
    expect((await s.get()).organizerCategories).toEqual({ Pics: ['png'] })
    expect((await s.set({ organizerCategories: null as never })).organizerCategories).toBeUndefined()
  })

  it('an invalid stored category table is dropped on load', async () => {
    const d = await tmpDir()
    await fs.writeFile(path.join(d, 'settings.json'), JSON.stringify({ organizerCategories: { CON: ['x'] } }))
    expect((await new SettingsStore(d).get()).organizerCategories).toBeUndefined()
  })
})
