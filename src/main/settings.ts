import fs from 'fs/promises'
import path from 'path'
import type { Settings } from '@shared/types'

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  holdHours: 5,
  sweepWindowsRecycleBin: true,
  minDuplicateSize: 1024,
  closeToTray: true,
  startWithWindows: false,
  firstRunNoticeSeen: false,
  dryRun: false
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
    this.cache = { ...DEFAULT_SETTINGS, ...stored }
    return { ...this.cache }
  }

  async set(p: Partial<Settings>): Promise<Settings> {
    const next = { ...(await this.get()), ...p }
    await fs.mkdir(this.dir, { recursive: true })
    const tmp = this.file + '.tmp'
    await fs.writeFile(tmp, JSON.stringify(next, null, 2))
    await fs.rename(tmp, this.file)
    this.cache = next
    return { ...next }
  }
}
