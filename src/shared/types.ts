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

export type HistoryType = 'junk' | 'duplicates' | 'organize' | 'recycle-sweep'

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
  op: 'junk' | 'dup' | 'organize' | 'restore'
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
  organizePlan(dir: string): R<Move[]>
  organizeApply(dir: string, moves: Move[]): R<HistoryEntry>
  organizeUndo(id: string): R<HistoryEntry>
  dupScan(dir: string): R<DupGroup[]>
  dupCancel(): R<void>
  dupRemove(paths: string[]): R<HistoryEntry>
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
  onProgress(cb: (p: Progress) => void): () => void
  onHistoryChanged(cb: () => void): () => void
  win: { minimize(): void; maximize(): void; close(): void }
}
