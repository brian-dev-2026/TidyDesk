import fs from 'fs/promises'
import path from 'path'
import type { Settings } from '@shared/types'
import { normaliseExclusions } from './exclusions'

export const DEFAULT_SETTINGS: Settings = {
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
}

export const JUNK_CATEGORY_IDS = ['user-temp', 'windows-temp', 'browser-cache', 'thumbnails', 'crash-dumps']

const THEMES: Settings['theme'][] = ['system', 'dark', 'light']

/** Drops unknown or wrongly typed values and clamps numbers to safe ranges. */
export function sanitizeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const out: Settings = { ...DEFAULT_SETTINGS }
  if (THEMES.includes(r.theme as Settings['theme'])) out.theme = r.theme as Settings['theme']
  if (typeof r.holdHours === 'number' && Number.isFinite(r.holdHours)) {
    out.holdHours = Math.min(168, Math.max(1, Math.round(r.holdHours)))
  }
  if (typeof r.minDuplicateSize === 'number' && Number.isFinite(r.minDuplicateSize)) {
    out.minDuplicateSize = Math.max(0, Math.round(r.minDuplicateSize))
  }
  for (const k of ['sweepWindowsRecycleBin', 'closeToTray', 'startWithWindows', 'firstRunNoticeSeen', 'dryRun', 'autoDownloadUpdates'] as const) {
    if (typeof r[k] === 'boolean') out[k] = r[k] as boolean
  }
  out.exclusions = normaliseExclusions(r.exclusions)
  if (r.autoClean === 'daily' || r.autoClean === 'weekly' || r.autoClean === 'off') out.autoClean = r.autoClean
  if (Array.isArray(r.autoCleanCategories)) {
    out.autoCleanCategories = [...new Set(r.autoCleanCategories.filter((c): c is string => typeof c === 'string' && JUNK_CATEGORY_IDS.includes(c)))]
  }
  if (typeof r.lastAutoClean === 'number' && Number.isFinite(r.lastAutoClean) && r.lastAutoClean >= 0) out.lastAutoClean = r.lastAutoClean
  if (r.organizeMode === 'type' || r.organizeMode === 'date') out.organizeMode = r.organizeMode
  return out
}

export class SettingsStore {
  private cache: Settings | null = null

  constructor(private dir: string) {}

  private get file(): string {
    return path.join(this.dir, 'settings.json')
  }

  async get(): Promise<Settings> {
    if (this.cache) return { ...this.cache }
    let stored: Partial<Settings> = {}
    try {
      stored = JSON.parse(await fs.readFile(this.file, 'utf8'))
    } catch {
      // missing or corrupt — defaults
    }
    this.cache = sanitizeSettings(stored)
    return { ...this.cache }
  }

  async set(p: Partial<Settings>): Promise<Settings> {
    const next = sanitizeSettings({ ...(await this.get()), ...p })
    await fs.mkdir(this.dir, { recursive: true })
    const tmp = this.file + '.tmp'
    await fs.writeFile(tmp, JSON.stringify(next, null, 2))
    await fs.rename(tmp, this.file)
    this.cache = next
    return { ...next }
  }
}
