import { app, BrowserWindow, dialog, ipcMain, nativeImage, shell } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import type { HistoryEntry, Progress, Result, Settings, Stats } from '@shared/types'
import type { HistoryStore } from './history'
import type { SettingsStore } from './settings'
import type { SafeBin } from './safebin'
import { isProtectedPath } from './guards'
import { listDrives } from './disk'
import { junkCategories, runningBrowsers, scanJunk } from './junk'
import { emptyRecycleBin, recycleBinInfo } from './recyclebin'
import { applyOrganize, planOrganize, undoOrganize } from './organizer'
import { findDuplicates, validateDupRemoval } from './duplicates'
import { getLog } from './logger'
import type { DupGroup } from '@shared/types'

export interface IpcDeps {
  history: HistoryStore
  settings: SettingsStore
  safeBin: SafeBin
  getWindow: () => BrowserWindow | null
}

const IMAGE_EXT = /\.(jpe?g|png|gif|bmp|webp|heic|tiff?|ico)$/i

export function registerIpc(deps: IpcDeps): { notifyHistoryChanged: () => void } {
  const { history, settings, safeBin } = deps
  let junkFiles: Record<string, string[]> = {}
  let dupAbort: AbortController | null = null
  let lastDupGroups: DupGroup[] | null = null

  /** Only the app's own page may call the API (not a file dropped onto the window). */
  const trusted = (url: string | undefined): boolean => {
    if (!url) return false
    const dev = process.env.ELECTRON_RENDERER_URL
    if (dev && url.startsWith(dev)) return true
    return url.startsWith('file://') && url.toLowerCase().includes('/out/renderer/index.html')
  }

  const send = (channel: string, payload?: unknown): void => {
    const w = deps.getWindow()
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload)
  }
  const notifyHistoryChanged = (): void => send('history-changed')

  /** At most one progress event per 100 ms, plus the final one. */
  const progress = (op: Progress['op']) => {
    let last = 0
    return (phase: string, done: number, total: number): void => {
      const now = Date.now()
      if (now - last < 100 && done < total) return
      last = now
      send('progress', { op, phase, done, total } satisfies Progress)
    }
  }

  function handle<A extends unknown[], T>(name: string, fn: (...args: A) => Promise<T> | T): void {
    ipcMain.handle(name, async (e, ...args: unknown[]): Promise<Result<T>> => {
      if (!trusted(e.senderFrame?.url)) return { ok: false, error: 'Untrusted caller' }
      try {
        return { ok: true, data: await fn(...(args as A)) }
      } catch (e) {
        getLog().error(`[ipc] ${name} failed`, e)
        return { ok: false, error: (e as Error).message || String(e) }
      }
    })
  }

  const withChange = async <T>(p: Promise<T>): Promise<T> => {
    const r = await p
    notifyHistoryChanged()
    return r
  }

  handle('disk', () => listDrives())

  handle('junkScan', async () => {
    const report = progress('junk')
    const { categories, files } = await scanJunk(junkCategories(process.env), {
      running: await runningBrowsers(),
      onProgress: (d, t, seen) => report(`Scanned ${seen.toLocaleString('en-US')} files`, d, t)
    })
    junkFiles = files
    return categories
  })

  handle('junkClean', async (ids: string[]) => {
    const files = ids.filter((id) => id !== 'recycle-bin').flatMap((id) => junkFiles[id] ?? [])
    if (!files.length) throw new Error('Nothing to clean — run a scan first')
    const { dryRun } = await settings.get()
    const report = progress('junk')
    const entry = await withChange(
      safeBin.quarantine(
        files,
        // re-apply the 1-hour rule at clean time: a file may have become active since the scan
        { type: 'junk', title: 'Junk clean', dryRun, skipNewerThan: Date.now() - 3600000 },
        (d, t) => report('Cleaning', d, t)
      )
    )
    junkFiles = {}
    return strip(entry)
  })

  handle('recycleInfo', () => recycleBinInfo())

  handle('emptyRecycleBin', async () => {
    const { dryRun } = await settings.get()
    const info = await emptyRecycleBin(dryRun)
    if (info.count > 0) {
      const entry: HistoryEntry = {
        id: history.newId(),
        type: 'recycle-sweep',
        title: dryRun ? 'Windows Recycle Bin (would be emptied)' : 'Windows Recycle Bin emptied',
        createdAt: Date.now(),
        status: dryRun ? 'simulated' : 'done',
        count: info.count,
        bytes: info.bytes,
        skipped: 0
      }
      if (dryRun) entry.dryRun = true
      await withChange(history.add(entry))
    }
    return info
  })

  handle('pickFolder', async () => {
    const w = deps.getWindow()
    const r = w
      ? await dialog.showOpenDialog(w, { properties: ['openDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return r.canceled ? null : r.filePaths[0] ?? null
  })

  handle('organizePlan', (dir: string) => planOrganize(dir))

  handle('organizeApply', async (dir: string, moves) => {
    const { dryRun } = await settings.get()
    return strip(await withChange(applyOrganize(dir, moves as never, history, { dryRun })))
  })

  handle('organizeUndo', async (id: string) => {
    const { dryRun } = await settings.get()
    return strip(await withChange(undoOrganize(id, history, { dryRun })))
  })

  handle('dupScan', async (dir: string) => {
    dupAbort?.abort()
    const ac = new AbortController()
    dupAbort = ac
    const { minDuplicateSize } = await settings.get()
    const report = progress('dup')
    try {
      lastDupGroups = null
      const groups = await findDuplicates(dir, {
        minSize: minDuplicateSize,
        signal: ac.signal,
        onProgress: (p) => report(p.phase, p.done, p.total)
      })
      lastDupGroups = groups
      return groups
    } finally {
      if (dupAbort === ac) dupAbort = null
    }
  })

  handle('dupCancel', () => {
    dupAbort?.abort()
  })

  handle('dupRemove', async (paths: string[]) => {
    if (!paths.length) throw new Error('No files selected')
    const bad = paths.find((p) => isProtectedPath(p))
    if (bad) throw new Error(`Protected location: ${bad}`)
    validateDupRemoval(lastDupGroups, paths)
    const { dryRun } = await settings.get()
    const report = progress('dup')
    const title = `Removed ${paths.length} duplicate${paths.length === 1 ? '' : 's'}`
    return strip(
      await withChange(
        safeBin.quarantine(paths, { type: 'duplicates', title, dryRun }, (d, t) => report('Moving', d, t))
      )
    )
  })

  handle('history', () => history.list())

  handle('historyEntry', async (id: string) => {
    const e = await history.get(id)
    if (!e) throw new Error('History entry not found')
    return e
  })

  handle('restore', async (id: string, paths?: string[]) => strip(await withChange(safeBin.restore(id, paths))))

  handle('purgeNow', async (id: string) => strip(await withChange(safeBin.purge(id))))

  handle('orphans', async () => safeBin.orphans((await listDrives()).map((d) => d.root)))

  handle('deleteOrphan', async (binDir: string): Promise<true> => {
    await safeBin.deleteOrphan(binDir)
    notifyHistoryChanged()
    return true
  })

  handle('openOrphan', async (binDir: string) => {
    const err = await shell.openPath(await safeBin.assertOrphan(binDir))
    if (err) throw new Error(err)
  })

  handle('stats', async (): Promise<Stats> => {
    let freedAllTime = 0
    for (const e of await history.list()) {
      if (e.dryRun) continue
      if (e.type === 'recycle-sweep') freedAllTime += e.bytes
      else freedAllTime += e.freedBytes ?? 0
    }
    return { heldBytes: await safeBin.heldBytes(), freedAllTime }
  })

  handle('getSettings', () => settings.get())

  handle('setSettings', async (p: Partial<Settings>) => {
    const next = await settings.set(p)
    if (p.startWithWindows !== undefined && app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: p.startWithWindows, args: ['--hidden'] })
    }
    if (p.dryRun !== undefined) notifyHistoryChanged()
    return next
  })

  handle('thumbnail', async (file: string) => {
    if (!IMAGE_EXT.test(file)) return null
    try {
      const img = await nativeImage.createThumbnailFromPath(file, { width: 96, height: 96 })
      return img.isEmpty() ? null : img.toDataURL()
    } catch {
      return null
    }
  })

  handle('showInFolder', async (file: string) => {
    // never "open" a file (that would run it): select it in Explorer, or open its folder
    const st = await fs.lstat(file).catch(() => null)
    if (st?.isFile()) return shell.showItemInFolder(file)
    const dir = st?.isDirectory() ? file : path.dirname(file)
    const dst = await fs.lstat(dir).catch(() => null)
    if (!dst?.isDirectory()) throw new Error('That location no longer exists')
    const err = await shell.openPath(dir)
    if (err) throw new Error(err)
  })

  handle('appVersion', () => app.getVersion())

  handle('logRenderer', (message: string) => {
    getLog().error(`[renderer] ${String(message).slice(0, 4000)}`)
  })

  ipcMain.on('win', (_e, action: string) => {
    const w = deps.getWindow()
    if (!w) return
    if (action === 'minimize') w.minimize()
    else if (action === 'maximize') (w.isMaximized() ? w.unmaximize() : w.maximize())
    else if (action === 'close') w.close()
  })

  return { notifyHistoryChanged }
}

/** Result payloads omit large item lists; the renderer loads them on demand via historyEntry. */
function strip(e: HistoryEntry): HistoryEntry {
  const { items: _i, moves: _m, ...rest } = e
  return rest
}
