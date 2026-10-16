import fs from 'fs/promises'
import { constants } from 'fs'
import path from 'path'
import type { FileInfo } from '@shared/types'
import { BIN_DIR_NAME } from './guards'

function eexist(p: string): NodeJS.ErrnoException {
  const err = new Error(`Destination already exists: ${p}`) as NodeJS.ErrnoException
  err.code = 'EEXIST'
  return err
}

export async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.lstat(p)
    return true
  } catch {
    return false
  }
}

/**
 * Moves a file, creating the destination's parent. Never overwrites, even when another move targets
 * the same name at the same moment: on one drive it hard-links then unlinks (linking fails if the
 * target exists); elsewhere it copies with COPYFILE_EXCL and then deletes the source.
 */
export async function moveFile(from: string, to: string): Promise<void> {
  await fs.mkdir(path.dirname(to), { recursive: true })
  try {
    await fs.link(from, to)
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    if (code === 'EEXIST') throw eexist(to)
    if (code === 'ENOENT' || code === 'EACCES' || code === 'EBUSY') throw e
    // other drive, a folder, or a file system without hard links: copy exclusively instead
    await fs.copyFile(from, to, constants.COPYFILE_EXCL).catch((err: NodeJS.ErrnoException) => {
      throw err.code === 'EEXIST' ? eexist(to) : err
    })
  }
  // Node 20 (inside Electron) clears the read-only flag to delete a read-only file, and a hard
  // link shares that flag, so remember it and put it back afterwards
  const readOnly = await fs.lstat(from).then((st) => (st.mode & 0o200) === 0, () => false)
  try {
    await fs.unlink(from)
  } catch (unlinkErr) {
    await fs.unlink(to).catch(() => {}) // source is locked: undo, leave the original in place
    throw unlinkErr
  }
  if (readOnly) await fs.chmod(to, 0o444).catch(() => {})
}

/** Returns p if free, otherwise "name<suffix>.ext", "name (1).ext", "name (2).ext"… (first free one). */
export async function uniquePath(p: string, suffix?: string, taken?: Set<string>): Promise<string> {
  const isTaken = async (c: string): Promise<boolean> =>
    (taken?.has(c.toLowerCase()) ?? false) || (await pathExists(c))
  if (!(await isTaken(p))) return p
  const { dir, name, ext } = path.parse(p)
  if (suffix) {
    const c = path.join(dir, `${name}${suffix}${ext}`)
    if (!(await isTaken(c))) return c
  }
  for (let i = 1; ; i++) {
    const c = path.join(dir, `${name}${suffix ?? ''} (${i})${ext}`)
    if (!(await isTaken(c))) return c
  }
}

const STAT_BATCH = 64
const DIR_CONCURRENCY = 16

export interface WalkOptions {
  /** Paths (folders or files) for which this returns true are not entered or yielded. */
  exclude?: (p: string) => boolean
  skipHidden?: boolean
  /** Called with a folder's entry names; returning true skips that whole folder (e.g. a project root). */
  skipFolder?: (dir: string, names: string[]) => boolean
  signal?: AbortSignal
}

/**
 * Recursively yields regular files. Never follows symlinks or junctions, never enters a Safe Bin,
 * and silently skips entries it cannot read.
 */
export async function* walkFiles(dir: string, opts: WalkOptions = {}): AsyncGenerator<FileInfo> {
  // Several folders are read concurrently: trees like %TEMP% can hold 100k+ folders, and
  // reading them one at a time is the bottleneck.
  const pending = [dir]
  const ready: FileInfo[] = []
  let active = 0
  let wake: (() => void) | null = null
  const notify = (): void => {
    wake?.()
    wake = null
  }

  async function visit(current: string): Promise<void> {
    let entries
    try {
      entries = await fs.readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    if (opts.skipFolder?.(current, entries.map((e) => e.name))) return
    const files: string[] = []
    for (const e of entries) {
      if (e.isSymbolicLink()) continue
      if (e.name.toLowerCase() === BIN_DIR_NAME) continue
      if (opts.skipHidden && e.name.startsWith('.')) continue
      const p = path.join(current, e.name)
      if (opts.exclude?.(p)) continue
      if (e.isDirectory()) pending.push(p)
      else if (e.isFile()) files.push(p)
    }
    for (let i = 0; i < files.length; i += STAT_BATCH) {
      const batch = await Promise.all(
        files.slice(i, i + STAT_BATCH).map((p) =>
          fs.lstat(p).then(
            (st) => ({ path: p, size: st.size, mtimeMs: st.mtimeMs }),
            () => null // vanished or unreadable — skip
          )
        )
      )
      for (const f of batch) if (f) ready.push(f)
    }
  }

  const pump = (): void => {
    while (active < DIR_CONCURRENCY && pending.length && ready.length < 10000) {
      active++
      visit(pending.pop()!).finally(() => {
        active--
        notify()
      })
    }
  }

  while (true) {
    if (opts.signal?.aborted) throw new Error('Cancelled')
    pump()
    if (ready.length) {
      yield* ready.splice(0, ready.length)
      continue
    }
    if (!active && !pending.length) return
    await new Promise<void>((r) => (wake = r))
  }
}

/** Runs fn over items with at most `limit` in flight; results keep the input order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

export async function dirSize(dir: string): Promise<number> {
  let total = 0
  for await (const f of walkFiles(dir)) total += f.size
  return total
}
