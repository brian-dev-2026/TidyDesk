import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { execFile } from 'child_process'
import type { BinItem, EntryStatus, HistoryEntry, Orphan } from '@shared/types'
import type { HistoryStore } from './history'
import { BIN_DIR_NAME } from './guards'
import { getLog } from './logger'
import { isExcluded } from './exclusions'
import { dirSize, mapLimit, moveFile, uniquePath } from './fsutil'

export interface SafeBinOpts {
  history: HistoryStore
  holdHours: () => number | Promise<number>
  binRootFor?: (file: string) => string
  now?: () => number
  /** When true, restore/purge/deleteOrphan refuse to touch disk. */
  isDryRun?: () => boolean | Promise<boolean>
  /** Permanently deletes one bin item (injectable so failures can be tested). */
  remove?: (p: string) => Promise<void>
}

export interface QuarantineMeta {
  type: 'junk' | 'duplicates'
  title: string
  dryRun?: boolean
  /** Files modified after this time (ms) are skipped with reason RECENT. */
  skipNewerThan?: number
  /** Paths inside these are skipped with reason EXCLUDED. */
  exclusions?: string[]
}

const HOUR = 3600000
// Benchmarked on Windows: concurrent renames are ~8x slower than sequential ones (filter-driver
// contention), so file moves run one at a time.
const CONCURRENCY = 1
// a dry run only stats files, which parallelises well
const STAT_CONCURRENCY = 32

function defaultBinRoot(file: string): string {
  return path.join(path.parse(file).root, BIN_DIR_NAME)
}

function errCode(e: unknown): string {
  return (e as NodeJS.ErrnoException).code ?? (e as Error).message ?? 'ERROR'
}

/** The bin path is always fresh and unique, so a plain rename is safe; other drives fall back to copy. */
async function moveIntoBin(from: string, to: string): Promise<void> {
  try {
    await fs.rename(from, to)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e
    await moveFile(from, to)
  }
}

function sumSize(items: BinItem[], state: BinItem['state']): number {
  return items.reduce((s, i) => (i.state === state ? s + i.size : s), 0)
}

function statusOf(items: BinItem[]): EntryStatus {
  const held = items.some((i) => i.state === 'held')
  const restored = items.some((i) => i.state === 'restored')
  const purged = items.some((i) => i.state === 'purged')
  if (held) return restored ? 'partial' : 'held'
  if (purged) return 'purged'
  if (restored) return 'restored'
  return 'skipped'
}

/**
 * Holding area for everything TidyDesk removes. Files are moved to <drive>\.tidydesk-bin\<batchId>\
 * and permanently deleted only when their batch expires or the user asks.
 */
export class SafeBin {
  private history: HistoryStore
  private holdHours: () => number | Promise<number>
  private binRootFor: (file: string) => string
  private now: () => number
  private preparedRoots = new Map<string, string>()
  private preparedBatches = new Set<string>()
  /** Batches whose files are still being moved; their history entry does not exist yet. */
  private inFlight = new Set<string>()
  private isDryRun: () => boolean | Promise<boolean>
  private remove: (p: string) => Promise<void>
  /** Tail of the operation queue per batch, so restore/purge on one batch never overlap. */
  private locks = new Map<string, Promise<unknown>>()

  constructor(o: SafeBinOpts) {
    this.history = o.history
    this.holdHours = o.holdHours
    this.binRootFor = o.binRootFor ?? defaultBinRoot
    this.now = o.now ?? Date.now
    this.isDryRun = o.isDryRun ?? (() => false)
    this.remove = o.remove ?? ((p) => fs.rm(p, { force: true, recursive: true }))
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

  /** <binRoot>\<batchId>, created once per root and batch. */
  private async batchDir(file: string, id: string): Promise<string> {
    const dir = path.join(await this.rootFor(file), id)
    if (!this.preparedBatches.has(dir)) {
      await fs.mkdir(dir, { recursive: true })
      this.preparedBatches.add(dir)
    }
    return dir
  }

  async quarantine(
    files: string[],
    meta: QuarantineMeta,
    onProgress?: (done: number, total: number) => void
  ): Promise<HistoryEntry> {
    const id = this.history.newId()
    this.inFlight.add(id)
    try {
      return await this.runQuarantine(id, files, meta, onProgress)
    } finally {
      this.inFlight.delete(id)
    }
  }

  private async runQuarantine(
    id: string,
    files: string[],
    meta: QuarantineMeta,
    onProgress?: (done: number, total: number) => void
  ): Promise<HistoryEntry> {
    const createdAt = this.now()
    let done = 0
    const items = await mapLimit(files, meta.dryRun ? STAT_CONCURRENCY : CONCURRENCY, async (originalPath, i): Promise<BinItem> => {
      try {
        if (meta.exclusions && isExcluded(originalPath, meta.exclusions)) {
          return { originalPath, binPath: '', size: 0, state: 'skipped', reason: 'EXCLUDED' }
        }
        const st = await fs.lstat(originalPath)
        if (meta.skipNewerThan !== undefined && st.mtimeMs > meta.skipNewerThan) {
          return { originalPath, binPath: '', size: 0, state: 'skipped', reason: 'RECENT' }
        }
        if (meta.dryRun) return { originalPath, binPath: '', size: st.size, state: 'would-remove' }
        const batchDir = await this.batchDir(originalPath, id)
        const binPath = path.join(batchDir, `${i}_${path.basename(originalPath)}`)
        await moveIntoBin(originalPath, binPath)
        return { originalPath, binPath, size: st.size, state: 'held' }
      } catch (e) {
        return { originalPath, binPath: '', size: 0, state: 'skipped', reason: errCode(e) }
      } finally {
        onProgress?.(++done, files.length)
      }
    })
    const moved = items.filter((i) => i.state === 'held' || i.state === 'would-remove')
    const entry: HistoryEntry = {
      id,
      type: meta.type,
      title: meta.title,
      createdAt,
      status: meta.dryRun ? 'simulated' : moved.length ? 'held' : 'skipped',
      count: moved.length,
      bytes: moved.reduce((s, i) => s + i.size, 0),
      skipped: items.length - moved.length,
      items
    }
    if (meta.dryRun) entry.dryRun = true
    else if (moved.length) entry.expiresAt = createdAt + (await this.holdHours()) * HOUR
    await this.history.add(entry)
    return entry
  }

  private async assertNotDryRun(): Promise<void> {
    if (await this.isDryRun()) throw new Error('Dry run is on — turn it off to change files')
  }

  private async load(entryId: string): Promise<HistoryEntry> {
    const e = await this.history.get(entryId)
    if (!e) throw new Error('History entry not found')
    if (e.dryRun) throw new Error('Dry run entry')
    if (e.type !== 'junk' && e.type !== 'duplicates') throw new Error('Not a Safe Bin entry')
    if (e.itemsFile && !e.items) throw new Error('The file list for this batch could not be read')
    await this.assertNotDryRun()
    return e
  }

  /** Runs fn after every earlier operation on the same batch has finished. */
  private withLock<T>(entryId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(entryId) ?? Promise.resolve()
    const next = prev.then(fn, fn)
    const tail = next.catch(() => {})
    this.locks.set(entryId, tail)
    void tail.then(() => {
      if (this.locks.get(entryId) === tail) this.locks.delete(entryId)
    })
    return next
  }

  restore(entryId: string, paths?: string[]): Promise<HistoryEntry> {
    return this.withLock(entryId, () => this.runRestore(entryId, paths))
  }

  purge(entryId: string): Promise<HistoryEntry> {
    return this.withLock(entryId, () => this.runPurge(entryId))
  }

  private async runRestore(entryId: string, paths?: string[]): Promise<HistoryEntry> {
    const e = await this.load(entryId)
    const wanted = paths ? new Set(paths.map((p) => p.toLowerCase())) : null
    const items = (e.items ?? []).map((i) => ({ ...i }))
    const outcome = { restored: 0, failed: 0, renamed: 0 }
    await mapLimit(items, CONCURRENCY, async (it) => {
      if (it.state !== 'held') return
      if (wanted && !wanted.has(it.originalPath.toLowerCase())) return
      try {
        // uniquePath + moveFile: if the name is taken in between, moveFile refuses and we try the next name
        for (let attempt = 0; ; attempt++) {
          const target = await uniquePath(it.originalPath, ' (restored)')
          try {
            await moveFile(it.binPath, target)
            if (target !== it.originalPath) {
              it.restoredTo = target
              outcome.renamed++
            }
            break
          } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== 'EEXIST' || attempt > 20) throw err
          }
        }
        it.state = 'restored'
        delete it.reason
        outcome.restored++
      } catch (err) {
        it.reason = errCode(err)
        outcome.failed++
      }
    })
    await this.removeEmptyBatchDirs(items)
    const restoredBytes = sumSize(items, 'restored')
    return this.history.update(e.id, { items, status: statusOf(items), restoredBytes, lastRestore: outcome })
  }

  private async runPurge(entryId: string): Promise<HistoryEntry> {
    const e = await this.load(entryId)
    const items = (e.items ?? []).map((i) => ({ ...i }))
    await mapLimit(items, CONCURRENCY, async (it) => {
      if (it.state !== 'held') return
      try {
        await this.remove(it.binPath)
        it.state = 'purged'
        delete it.reason
      } catch (err) {
        it.reason = errCode(err) // stays held; the next purge retries it
      }
    })
    const stillHeld = items.some((i) => i.state === 'held')
    await this.removeEmptyBatchDirs(items, !stillHeld)
    const patch: Partial<HistoryEntry> = { items, status: statusOf(items), freedBytes: sumSize(items, 'purged') }
    if (!stillHeld && items.some((i) => i.state === 'purged')) patch.purgedAt = this.now()
    return this.history.update(e.id, patch)
  }

  private async removeEmptyBatchDirs(items: BinItem[], force = false): Promise<void> {
    const dirs = new Set(items.filter((i) => i.binPath).map((i) => path.dirname(i.binPath)))
    for (const d of dirs) {
      if (force) {
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
    for (const e of await this.history.list()) {
      if (e.dryRun || (e.status !== 'held' && e.status !== 'partial')) continue
      if (e.expiresAt === undefined || e.expiresAt > now) continue
      try {
        await this.purge(e.id)
        n++
      } catch (err) {
        getLog().error(`Could not purge batch ${e.id}`, err) // leave it held; retried next tick
      }
    }
    return n
  }

  async heldBytes(): Promise<number> {
    let total = 0
    for (const e of await this.history.list()) {
      if (e.status === 'held' || e.status === 'partial') total += e.bytes - (e.restoredBytes ?? 0) - (e.freedBytes ?? 0)
    }
    return total
  }

  /** Batch folders inside each root's bin that no held history entry refers to. */
  async orphans(roots: string[], binName = BIN_DIR_NAME): Promise<Orphan[]> {
    const live = new Set<string>(this.inFlight)
    for (const e of await this.history.list()) {
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

  /** Throws unless binDir is a batch folder directly inside a Safe Bin that no live batch uses. */
  async assertOrphan(binDir: string): Promise<string> {
    const resolved = path.resolve(binDir)
    if (path.basename(path.dirname(resolved)).toLowerCase() !== BIN_DIR_NAME) {
      throw new Error('Not a Safe Bin batch folder')
    }
    const st = await fs.lstat(resolved)
    if (!st.isDirectory() || st.isSymbolicLink()) throw new Error('Not a Safe Bin batch folder')
    const id = path.basename(resolved)
    const held = (await this.history.list()).some(
      (e) => e.id === id && (e.status === 'held' || e.status === 'partial')
    )
    if (held || this.inFlight.has(id)) throw new Error('This folder is in use by a batch in the Safe Bin')
    return resolved
  }

  async deleteOrphan(binDir: string): Promise<void> {
    await this.assertNotDryRun()
    await fs.rm(await this.assertOrphan(binDir), { recursive: true, force: true })
  }
}
