export type Result<T> = { ok: true; data: T } | { ok: false; error: string }

export interface FileInfo {
  path: string
  size: number
  mtimeMs: number
}

export type ItemState = 'held' | 'restored' | 'purged' | 'skipped' | 'would-remove'

export interface BinItem {
  originalPath: string
  binPath: string
  size: number
  state: ItemState
  reason?: string
  restoredTo?: string
}

export interface Move {
  from: string
  to: string
  category: string
  done?: boolean
}

export type HistoryType = 'junk' | 'duplicates' | 'organize' | 'recycle-sweep' | 'large-files' | 'empty-folders'

export type EntryStatus =
  | 'held'
  | 'partial'
  | 'restored'
  | 'purged'
  | 'applied'
  | 'undone'
  | 'done'
  | 'simulated'
  | 'skipped'

export interface HistoryEntry {
  id: string
  type: HistoryType
  title: string
  createdAt: number
  expiresAt?: number
  purgedAt?: number
  status: EntryStatus
  count: number
  bytes: number
  skipped: number
  /** Bytes restored from the Safe Bin so far. */
  restoredBytes?: number
  /** Bytes permanently deleted when the batch was purged. */
  freedBytes?: number
  /** Outcome of the most recent restore on this batch. */
  lastRestore?: { restored: number; failed: number; renamed: number }
  dryRun?: boolean
  items?: BinItem[]
  moves?: Move[]
  createdDirs?: string[]
  /** Folders removed by an empty-folders action. */
  folders?: string[]
  itemsFile?: string
}

export interface Settings {
  theme: 'system' | 'dark' | 'light'
  holdHours: number
  sweepWindowsRecycleBin: boolean
  minDuplicateSize: number
  closeToTray: boolean
  startWithWindows: boolean
  firstRunNoticeSeen: boolean
  dryRun: boolean
  autoDownloadUpdates: boolean
  exclusions: string[]
  autoClean: 'off' | 'daily' | 'weekly'
  autoCleanCategories: string[]
  lastAutoClean?: number
  organizerCategories?: Record<string, string[]>
  organizeMode: 'type' | 'date'
  /** Folders the one-click Organizer tidies; unset means the Desktop. */
  organizeFolders?: string[]
  /** Folders the one-click duplicate remover checks; unset means the standard user folders. */
  duplicateFolders?: string[]
}

export interface DupGroup {
  hash: string
  size: number
  files: FileInfo[]
}

export interface JunkCategory {
  id: string
  label: string
  description: string
  bytes: number
  fileCount: number
  note?: string
}

export interface DriveInfo {
  root: string
  total: number
  free: number
}

export interface Progress {
  op: 'junk' | 'dup' | 'organize' | 'restore' | 'large' | 'empty'
  phase: string
  done: number
  total: number
}

export interface RecycleInfo {
  count: number
  bytes: number
}

export interface Orphan {
  binDir: string
  bytes: number
}

export interface UpdateStatus {
  state: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'none' | 'error' | 'disabled'
  version?: string
  percent?: number
  error?: string
}

export interface Stats {
  heldBytes: number
  freedAllTime: number
}

type R<T> = Promise<Result<T>>

export interface TidyApi {
  disk(): R<DriveInfo[]>
  junkScan(): R<JunkCategory[]>
  junkClean(ids: string[]): R<HistoryEntry>
  recycleInfo(): R<RecycleInfo>
  emptyRecycleBin(): R<RecycleInfo>
  pickFolder(): R<string | null>
  pickFile(): R<string | null>
  isFolder(p: string): R<boolean>
  /** Local path of a file or folder dropped onto the window. */
  pathForFile(file: File): string
  /** Folders the one-click Organizer and duplicate remover use. */
  autoFolders(): R<{ organize: string[]; duplicates: string[] }>
  /** Organizes the given folders, or the configured ones; one entry per folder that changed. */
  organizeAuto(dirs?: string[]): R<{ entries: HistoryEntry[]; errors: { dir: string; error: string }[] }>
  organizeUndo(id: string): R<HistoryEntry>
  /** Finds duplicates and moves every copy but the oldest to the Safe Bin; null when none. */
  dupAuto(dirs?: string[]): R<HistoryEntry | null>
  dupCancel(): R<void>
  largeScan(dir: string): R<FileInfo[]>
  largeCancel(): R<void>
  largeRemove(paths: string[]): R<HistoryEntry>
  emptyScan(dir: string): R<string[]>
  emptyRemove(paths: string[]): R<HistoryEntry>
  emptyRestore(id: string): R<HistoryEntry>
  history(): R<HistoryEntry[]>
  historyEntry(id: string): R<HistoryEntry>
  restore(id: string, paths?: string[]): R<HistoryEntry>
  purgeNow(id: string): R<HistoryEntry>
  orphans(): R<Orphan[]>
  deleteOrphan(binDir: string): R<true>
  openOrphan(binDir: string): R<void>
  stats(): R<Stats>
  getSettings(): R<Settings>
  setSettings(p: Partial<Settings>): R<Settings>
  thumbnail(path: string): R<string | null>
  showInFolder(path: string): R<void>
  appVersion(): R<string>
  logRenderer(message: string): R<void>
  openLogs(): R<void>
  exportCsv(): R<string | null>
  updateStatus(): R<UpdateStatus>
  updateCheck(): R<void>
  updateDownload(): R<void>
  updateInstall(): R<void>
  onUpdateStatus(cb: (s: UpdateStatus) => void): () => void
  onProgress(cb: (p: Progress) => void): () => void
  onHistoryChanged(cb: () => void): () => void
  win: { minimize(): void; maximize(): void; close(): void }
}
