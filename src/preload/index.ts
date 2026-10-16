import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { Progress, TidyApi } from '../shared/types'

const invoke =
  (channel: string) =>
  (...args: unknown[]) =>
    ipcRenderer.invoke(channel, ...args)

const channels = [
  'disk',
  'junkScan',
  'junkClean',
  'recycleInfo',
  'emptyRecycleBin',
  'pickFolder',
  'pickFile',
  'isFolder',
  'autoFolders',
  'organizeAuto',
  'organizeUndo',
  'dupAuto',
  'dupCancel',
  'largeScan',
  'largeCancel',
  'largeRemove',
  'emptyScan',
  'emptyRemove',
  'emptyRestore',
  'history',
  'historyEntry',
  'restore',
  'purgeNow',
  'orphans',
  'deleteOrphan',
  'openOrphan',
  'stats',
  'getSettings',
  'setSettings',
  'thumbnail',
  'showInFolder',
  'appVersion',
  'logRenderer',
  'openLogs',
  'exportCsv',
  'updateStatus',
  'updateCheck',
  'updateDownload',
  'updateInstall'
] as const

const api = {
  ...Object.fromEntries(channels.map((c) => [c, invoke(c)])),
  onProgress(cb: (p: Progress) => void) {
    const listener = (_e: unknown, p: Progress): void => cb(p)
    ipcRenderer.on('progress', listener)
    return () => ipcRenderer.removeListener('progress', listener)
  },
  pathForFile(file: File): string {
    return webUtils.getPathForFile(file)
  },
  onUpdateStatus(cb: (s: unknown) => void) {
    const listener = (_e: unknown, s: unknown): void => cb(s)
    ipcRenderer.on('update-status', listener)
    return () => ipcRenderer.removeListener('update-status', listener)
  },
  onHistoryChanged(cb: () => void) {
    const listener = (): void => cb()
    ipcRenderer.on('history-changed', listener)
    return () => ipcRenderer.removeListener('history-changed', listener)
  },
  win: {
    minimize: () => ipcRenderer.send('win', 'minimize'),
    maximize: () => ipcRenderer.send('win', 'maximize'),
    close: () => ipcRenderer.send('win', 'close')
  }
} as unknown as TidyApi

contextBridge.exposeInMainWorld('tidy', api)
