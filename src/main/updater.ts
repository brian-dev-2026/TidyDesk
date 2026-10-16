import type { UpdateStatus } from '@shared/types'
import { getLog } from './logger'

const FIRST_CHECK_MS = 10_000
const CHECK_EVERY_MS = 6 * 3600000

/** Turns an electron-updater event into the status the UI shows. */
export function mapUpdaterEvent(event: string, payload?: any, current: UpdateStatus = { state: 'idle' }): UpdateStatus {
  switch (event) {
    case 'checking-for-update':
      return { state: 'checking' }
    case 'update-available':
      return { state: 'available', version: payload?.version }
    case 'download-progress':
      return { state: 'downloading', version: current.version, percent: Math.round(payload?.percent ?? 0) }
    case 'update-downloaded':
      return { state: 'ready', version: payload?.version ?? current.version }
    case 'update-not-available':
      return { state: 'none' }
    case 'error':
      return { state: 'error', error: payload instanceof Error ? payload.message : String(payload ?? 'Unknown error') }
    default:
      return current
  }
}

/** electron-updater's autoUpdater, whether the module arrives ES-style or CommonJS-in-default (packaged). */
export function pickAutoUpdater(mod: any): any {
  const au = mod?.autoUpdater ?? mod?.default?.autoUpdater
  if (!au) throw new Error('electron-updater did not provide autoUpdater')
  return au
}

export interface UpdaterDeps {
  isPackaged: boolean
  autoDownload: () => Promise<boolean>
  send: (s: UpdateStatus) => void
  /** Called right before quitting to install, so the app can mark itself as really quitting. */
  beforeInstall: () => void
}

export interface Updater {
  check(): Promise<void>
  download(): Promise<void>
  install(): void
  status(): UpdateStatus
  stop(): void
}

/**
 * Checks GitHub Releases (electron-builder `publish` config) for a newer version. Only active in
 * the installed app; in development it reports `disabled` and never loads electron-updater.
 */
export function startUpdater(deps: UpdaterDeps): Updater {
  let status: UpdateStatus = deps.isPackaged ? { state: 'idle' } : { state: 'disabled' }
  const set = (s: UpdateStatus): void => {
    status = s
    deps.send(s)
  }
  if (!deps.isPackaged) {
    return { check: async () => {}, download: async () => {}, install: () => {}, status: () => status, stop: () => {} }
  }

  // loaded lazily: electron-updater needs the Electron runtime
  const ready = import('electron-updater').then((mod) => {
    const autoUpdater = pickAutoUpdater(mod)
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.logger = null
    for (const ev of ['checking-for-update', 'update-available', 'download-progress', 'update-downloaded', 'update-not-available', 'error']) {
      ;(autoUpdater.on as (e: string, l: (p: unknown) => void) => void).call(autoUpdater, ev, (payload: unknown) => {
        if (ev === 'error') getLog().error('Update check failed', payload)
        set(mapUpdaterEvent(ev, payload, status))
      })
    }
    return autoUpdater
  })
  ready.catch((e: unknown) => {
    getLog().error('Updater could not start', e)
    set(mapUpdaterEvent('error', e, status))
  })

  const check = async (): Promise<void> => {
    const u = await ready
    if (status.state === 'downloading' || status.state === 'ready') return
    u.autoDownload = await deps.autoDownload()
    await u.checkForUpdates().catch((e: unknown) => set(mapUpdaterEvent('error', e, status)))
  }

  const first = setTimeout(() => void check(), FIRST_CHECK_MS)
  const timer = setInterval(() => void check(), CHECK_EVERY_MS)

  return {
    check,
    download: async () => {
      const u = await ready
      if (status.state !== 'available') return
      await u.downloadUpdate().catch((e: unknown) => set(mapUpdaterEvent('error', e, status)))
    },
    install: () => {
      if (status.state !== 'ready') return
      deps.beforeInstall()
      void ready.then((u) => u.quitAndInstall(true, true))
    },
    status: () => status,
    stop: () => {
      clearTimeout(first)
      clearInterval(timer)
    }
  }
}
