import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { execFile } from 'child_process'
import type { BinItem, EntryStatus, HistoryEntry, Orphan } from '@shared/types'
import type { HistoryStore } from './history'
import { BIN_DIR_NAME } from './guards'
import { dirSize, moveFile, uniquePath } from './fsutil'

export interface SafeBinOpts {
  history: HistoryStore
  holdHours: () => number
  binRootFor?: (file: string) => string
  now?: () => number
}

export interface QuarantineMeta {
  type: 'junk' | 'duplicates'
  title: string
  dryRun?: boolean
}

const HOUR = 3600000

function defaultBinRoot(file: string): string {
  return path.join(path.parse(file).root, BIN_DIR_NAME)
}

function errCode(e: unknown): string {
  return (e as NodeJS.ErrnoException).code ?? (e as Error).message ?? 'ERROR'
}

function statusOf(items: BinItem[]): EntryStatus {
  const held = items.some((i) => i.state === 'held')
  const restored = items.some((i) => i.state === 'restored')
  const purged = items.some((i) => i.state === 'purged')
  if (held) return restored ? 'partial' : 'held'
  if (purged) return 'purged'
  if (restored) return 'restored'
  return 'purged'
}

/**
 * Holding area for everything TidyDesk removes. Files are moved to <drive>\.tidydesk-bin\<batchId>\
 * and permanently deleted only when their batch expires or the user asks.
 */
export class SafeBin {
  private history: HistoryStore
  private holdHours: () => number
  private binRootFor: (file: string) => string
  private now: () => number
  private preparedRoots = new Map<string, string>()

  constructor(o: SafeBinOpts) {
    this.history = o.history
    this.holdHours = o.holdHours
    this.binRootFor = o.binRootFor ?? defaultBinRoot
    this.now = o.now ?? Date.now
  }

  /** Resolves (and creates once) the bin root for a file, falling back to the profile drive. */
  private async rootFor(file: string): Promise<string> {
    const wanted = this.binRootFor(file)
    const cached = this.preparedRoots.get(wanted)
    if (cached) return cached
    let root = wanted
    try {
      await fs.mkdir(wanted, { recursive: true })
    } catch {
      root = defaultBinRoot(os.homedir())
      await fs.mkdir(root, { recursive: true })
    }
    if (path.basename(root) === BIN_DIR_NAME && process.platform === 'win32') {
      execFile('attrib', ['+h', root], () => {})
    }
    this.preparedRoots.set(wanted, root)
    return root
  }

  async quarantine(
    files: string[],
    meta: QuarantineMeta,
    onProgress?: (done: number, total: number) => void
  ): Promise<HistoryEntry> {
    const id = this.history.newId()
    const createdAt = this.now()
    const items: BinItem[] = []
    for (let i = 0; i < files.length; i++) {
      const originalPath = files[i]
      try {
        const st = await fs.lstat(originalPath)
        if (meta.dryRun) {
          items.push({ originalPath, binPath: '', size: st.size, state: 'would-remove' })
        } else {
          const binPath = path.join(await this.rootFor(originalPath), id, `${i}_${path.basename(originalPath)}`)
          await moveFile(originalPath, binPath)
          items.push({ originalPath, binPath, size: st.size, state: 'held' })
        }
      } catch (e) {
        items.push({ originalPath, binPath: '', size: 0, state: 'skipped', reason: errCode(e) })
      }
      onProgress?.(i + 1, files.length)
    }
    const moved = items.filter((i) => i.state === 'held' || i.state === 'would-remove')
    const entry: HistoryEntry = {
      id,
      type: meta.type,
      title: meta.title,
      createdAt,
      status: meta.dryRun ? 'simulated' : moved.length ? 'held' : 'purged',
      count: moved.length,
      bytes: moved.reduce((s, i) => s + i.size, 0),
      skipped: items.length - moved.length,
      items
    }
    if (meta.dryRun) entry.dryRun = true
    else entry.expiresAt = createdAt + this.holdHours() * HOUR
    await this.history.add(entry)
    return entry
  }

  private async load(entryId: string): Promise<HistoryEntry> {
    const e = await this.history.get(entryId)
    if (!e) throw new Error('History entry not found')
    if (e.dryRun) throw new Error('Dry run entry')
    if (e.type !== 'junk' && e.type !== 'duplicates') throw new Error('Not a Safe Bin entry')
    return e
  }

  async restore(entryId: string, paths?: string[]): Promise<HistoryEntry> {
    const e = await this.load(entryId)
    const wanted = paths ? new Set(paths.map((p) => p.toLowerCase())) : null
    const items = (e.items ?? []).map((i) => ({ ...i }))
    for (const it of items) {
      if (it.state !== 'held') continue
      if (wanted && !wanted.has(it.originalPath.toLowerCase())) continue
      try {
        const target = await uniquePath(it.originalPath, ' (restored)')
        await moveFile(it.binPath, target)
        it.state = 'restored'
        if (target !== it.originalPath) it.restoredTo = target
        delete it.reason
      } catch (err) {
        it.reason = errCode(err)
      }
    }
    await this.removeEmptyBatchDirs(items)
    return this.history.update(e.id, { items, status: statusOf(items) })
  }

  async purge(entryId: string): Promise<HistoryEntry> {
    const e = await this.load(entryId)
    const items = (e.items ?? []).map((i) => ({ ...i }))
    for (const it of items) {
      if (it.state !== 'held') continue
      await fs.rm(it.binPath, { force: true, recursive: true }).catch(() => {})
      it.state = 'purged'
    }
    await this.removeEmptyBatchDirs(items, true)
    return this.history.update(e.id, { items, status: statusOf(items), purgedAt: this.now() })
  }

  private async removeEmptyBatchDirs(items: BinItem[], force = false): Promise<void> {
    const dirs = new Set(items.filter((i) => i.binPath).map((i) => path.dirname(i.binPath)))
    for (const d of dirs) {
      if (force && items.every((i) => i.state !== 'held')) {
        await fs.rm(d, { recursive: true, force: true }).catch(() => {})
      } else {
        await fs.rmdir(d).catch(() => {}) // only succeeds when empty
      }
    }
  }

  /** Purges every held batch whose hold time has passed. Returns the number of batches purged. */
  async purgeExpired(): Promise<number> {
    const now = this.now()
    let n = 0
    for (const e of await this.history.all()) {
      if (e.dryRun || (e.status !== 'held' && e.status !== 'partial')) continue
      if (e.expiresAt === undefined || e.expiresAt > now) continue
      await this.purge(e.id)
      n++
    }
    return n
  }

  async heldBytes(): Promise<number> {
    let total = 0
    for (const e of await this.history.all()) {
      if (e.status !== 'held' && e.status !== 'partial') continue
      for (const i of e.items ?? []) if (i.state === 'held') total += i.size
    }
    return total
  }

  /** Batch folders inside each root's bin that no held history entry refers to. */
  async orphans(roots: string[], binName = BIN_DIR_NAME): Promise<Orphan[]> {
    const live = new Set<string>()
    for (const e of await this.history.all()) {
      if (e.status === 'held' || e.status === 'partial') live.add(e.id)
    }
    const out: Orphan[] = []
    for (const root of roots) {
      const bin = path.join(root, binName)
      let entries
      try {
        entries = await fs.readdir(bin, { withFileTypes: true })
      } catch {
        continue
      }
      for (const d of entries) {
        if (!d.isDirectory() || live.has(d.name)) continue
        const binDir = path.join(bin, d.name)
        out.push({ binDir, bytes: await dirSize(binDir) })
      }
    }
    return out
  }

  async deleteOrphan(binDir: string): Promise<void> {
    const resolved = path.resolve(binDir)
    if (path.basename(path.dirname(resolved)).toLowerCase() !== BIN_DIR_NAME) {
      throw new Error('Not a Safe Bin batch folder')
    }
    const st = await fs.lstat(resolved)
    if (!st.isDirectory()) throw new Error('Not a Safe Bin batch folder')
    await fs.rm(resolved, { recursive: true, force: true })
  }
}
