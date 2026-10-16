import { app, BrowserWindow, dialog, ipcMain, nativeImage, shell } from 'electron'
import fs from 'fs/promises'
import { createWriteStream } from 'fs'
import { once } from 'events'
import path from 'path'
import type { HistoryEntry, Progress, Result, Settings, Stats } from '@shared/types'
import type { HistoryStore } from './history'
import type { SettingsStore } from './settings'
import type { SafeBin } from './safebin'
import { isProtectedPath } from './guards'
import { listDrives } from './disk'
import { junkCategories, runningBrowsers, scanJunk } from './junk'
import { emptyRecycleBin, recycleBinInfo } from './recyclebin'
import { autoOrganize, undoOrganize } from './organizer'
import { findDuplicates, pickDuplicateRemovals } from './duplicates'
import { getLog } from './logger'
import type { Updater } from './updater'
import { findLargeFiles } from './largefiles'
import { CSV_HEADER, csvLine, historyToCsvRows } from './csv'
import { findEmptyFolders, removeEmptyFolders, restoreEmptyFolders } from './emptyfolders'

export interface IpcDeps {
  history: HistoryStore
  settings: SettingsStore
  safeBin: SafeBin
  getWindow: () => BrowserWindow | null
  getUpdater: () => Updater | null
}

const IMAGE_EXT = /\.(jpe?g|png|gif|bmp|webp|heic|tiff?|ico)$/i

export function registerIpc(deps: IpcDeps): { notifyHistoryChanged: () => void; sendUpdateStatus: (s: unknown) => void } {
  const { history, settings, safeBin } = deps
  let junkFiles: Record<string, string[]> = {}
  let dupAbort: AbortController | null = null
  let largeAbort: AbortController | null = null
  let lastLarge: Set<string> | null = null
  let lastEmpty: Set<string> | null = null

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
    const { exclusions } = await settings.get()
    const { categories, files } = await scanJunk(junkCategories(process.env), {
      running: await runningBrowsers(),
      exclusions,
      onProgress: (d, t, seen) => report(`Scanned ${seen.toLocaleString('en-US')} files`, d, t)
    })
    junkFiles = files
    return categories
  })

  handle('junkClean', async (ids: string[]) => {
    const files = ids.filter((id) => id !== 'recycle-bin').flatMap((id) => junkFiles[id] ?? [])
    if (!files.length) throw new Error('Nothing to clean — run a scan first')
    const { dryRun, exclusions } = await settings.get()
    const report = progress('junk')
    const entry = await withChange(
      safeBin.quarantine(
        files,
        // re-apply the 1-hour rule and exclusions at clean time: things may have changed since the scan
        { type: 'junk', title: 'Junk clean', dryRun, exclusions, skipNewerThan: Date.now() - 3600000 },
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

  handle('isFolder', async (p: string) => (await fs.lstat(p).catch(() => null))?.isDirectory() ?? false)

  handle('pickFile', async () => {
    const w = deps.getWindow()
    const opts = { properties: ['openFile' as const] }
    const r = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts)
    return r.canceled ? null : r.filePaths[0] ?? null
  })

  /** The folders the one-click actions use: the user's list, or the standard ones. */
  const autoFolders = async (): Promise<{ organize: string[]; duplicates: string[] }> => {
    const s = await settings.get()
    const known = (['desktop', 'documents', 'downloads', 'pictures', 'music', 'videos'] as const).flatMap((k) => {
      try {
        return [app.getPath(k)]
      } catch {
        return [] // a folder Windows does not know about
      }
    })
    return {
      organize: s.organizeFolders ?? known.slice(0, 1),
      duplicates: s.duplicateFolders ?? known
    }
  }

  handle('autoFolders', autoFolders)

  /** A folder list from the page (a dropped folder) must be absolute paths. */
  const folderList = (dirs: unknown): string[] | undefined => {
    if (dirs === undefined || dirs === null) return undefined
    if (!Array.isArray(dirs) || !dirs.every((d) => typeof d === 'string' && path.win32.isAbsolute(d))) throw new Error('Invalid folder list')
    return dirs
  }

  handle('organizeAuto', async (dirs?: string[]) => {
    const s = await settings.get()
    const list = folderList(dirs) ?? (await autoFolders()).organize
    if (!list.length) throw new Error('Add a folder to organize first')
    const r = await autoOrganize(list, history, {
      dryRun: s.dryRun,
      exclusions: s.exclusions,
      mode: s.organizeMode,
      categories: s.organizerCategories
    })
    if (r.entries.length) notifyHistoryChanged()
    return { entries: r.entries.map(strip), errors: r.errors }
  })

  handle('organizeUndo', async (id: string) => {
    const { dryRun } = await settings.get()
    return strip(await withChange(undoOrganize(id, history, { dryRun })))
  })

  handle('dupAuto', async (dirs?: string[]) => {
    dupAbort?.abort()
    const ac = new AbortController()
    dupAbort = ac
    const { minDuplicateSize, exclusions, dryRun } = await settings.get()
    const list = folderList(dirs) ?? (await autoFolders()).duplicates
    if (!list.length) throw new Error('Add a folder to check first')
    const report = progress('dup')
    try {
      const groups = await findDuplicates(list, {
        minSize: minDuplicateSize,
        exclusions,
        signal: ac.signal,
        onProgress: (p) => report(p.phase, p.done, p.total)
      })
      if (ac.signal.aborted) throw new Error('Cancelled')
      const paths = pickDuplicateRemovals(groups).filter((p) => !isProtectedPath(p))
      if (!paths.length) return null
      const title = `Removed ${paths.length} duplicate${paths.length === 1 ? '' : 's'}`
      return strip(
        await withChange(
          safeBin.quarantine(paths, { type: 'duplicates', title, dryRun, exclusions }, (d, t) => report('Moving', d, t))
        )
      )
    } finally {
      if (dupAbort === ac) dupAbort = null
    }
  })

  handle('dupCancel', () => {
    dupAbort?.abort()
  })

  handle('largeScan', async (dir: string) => {
    largeAbort?.abort()
    const ac = new AbortController()
    largeAbort = ac
    const { exclusions } = await settings.get()
    const report = progress('large')
    try {
      lastLarge = null
      const files = await findLargeFiles(dir, {
        minSize: 50 * 1024 * 1024,
        limit: 200,
        exclusions,
        signal: ac.signal,
        onProgress: (seen) => report(`Scanned ${seen.toLocaleString('en-US')} files`, 0, 0)
      })
      lastLarge = new Set(files.map((f) => f.path.toLowerCase()))
      return files
    } finally {
      if (largeAbort === ac) largeAbort = null
    }
  })

  handle('largeCancel', () => {
    largeAbort?.abort()
  })

  handle('largeRemove', async (paths: string[]) => {
    if (!paths.length) throw new Error('No files selected')
    const unknown = paths.find((p) => !lastLarge?.has(p.toLowerCase()))
    if (unknown) throw new Error(`${unknown} is not part of the last scan — scan again first`)
    const bad = paths.find((p) => isProtectedPath(p))
    if (bad) throw new Error(`Protected location: ${bad}`)
    const { dryRun, exclusions } = await settings.get()
    const report = progress('large')
    const title = `Removed ${paths.length} large file${paths.length === 1 ? '' : 's'}`
    const entry = await withChange(
      safeBin.quarantine(paths, { type: 'large-files', title, dryRun, exclusions }, (d, t) => report('Moving', d, t))
    )
    if (!dryRun) for (const p of paths) lastLarge?.delete(p.toLowerCase())
    return strip(entry)
  })

  handle('emptyScan', async (dir: string) => {
    const { exclusions } = await settings.get()
    lastEmpty = null
    const found = await findEmptyFolders(dir, { exclusions })
    lastEmpty = new Set(found.map((p) => p.toLowerCase()))
    return found
  })

  handle('emptyRemove', async (paths: string[]) => {
    if (!paths.length) throw new Error('No folders selected')
    const unknown = paths.find((p) => !lastEmpty?.has(p.toLowerCase()))
    if (unknown) throw new Error(`${unknown} is not part of the last scan — scan again first`)
    const { dryRun, exclusions } = await settings.get()
    const entry = await withChange(removeEmptyFolders(paths, history, { dryRun, exclusions }))
    if (!dryRun) lastEmpty = null
    return strip(entry)
  })

  handle('emptyRestore', async (id: string) => {
    const { dryRun } = await settings.get()
    return strip(await withChange(restoreEmptyFolders(id, history, { dryRun })))
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

  handle('updateStatus', () => deps.getUpdater()?.status() ?? { state: 'disabled' })
  handle('updateCheck', async () => {
    await deps.getUpdater()?.check()
  })
  handle('updateDownload', async () => {
    await deps.getUpdater()?.download()
  })
  handle('updateInstall', () => {
    deps.getUpdater()?.install()
  })

  handle('openLogs', async () => {
    const dir = path.join(app.getPath('userData'), 'logs')
    await fs.mkdir(dir, { recursive: true })
    const err = await shell.openPath(dir)
    if (err) throw new Error(err)
  })

  handle('exportCsv', async (): Promise<string | null> => {
    const w = deps.getWindow()
    const name = `tidydesk-activity-${new Date().toISOString().slice(0, 10)}.csv`
    const opts = { defaultPath: path.join(app.getPath('documents'), name), filters: [{ name: 'CSV', extensions: ['csv'] }] }
    const r = w ? await dialog.showSaveDialog(w, opts) : await dialog.showSaveDialog(opts)
    if (r.canceled || !r.filePath) return null
    const out = createWriteStream(r.filePath, { encoding: 'utf8' })
    const write = async (s: string): Promise<void> => {
      if (!out.write(s)) await once(out, 'drain')
    }
    await write('﻿' + csvLine(CSV_HEADER)) // BOM so Excel reads UTF-8 paths correctly
    for (const e of await history.list()) {
      const full = await history.get(e.id).catch(() => e) // an unreadable item list still exports its summary row
      for (const row of historyToCsvRows(full ?? e)) await write(csvLine(row))
    }
    out.end()
    await once(out, 'finish')
    return r.filePath
  })

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

  return { notifyHistoryChanged, sendUpdateStatus: (s) => send('update-status', s) }
}

/** Result payloads omit large item lists; the renderer loads them on demand via historyEntry. */
function strip(e: HistoryEntry): HistoryEntry {
  const { items: _i, moves: _m, ...rest } = e
  return rest
}
