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

/** Moves a file, creating the destination's parent. Never overwrites; falls back to copy+unlink across drives. */
export async function moveFile(from: string, to: string): Promise<void> {
  await fs.mkdir(path.dirname(to), { recursive: true })
  if (await pathExists(to)) throw eexist(to)
  try {
    await fs.rename(from, to)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e
    await fs.copyFile(from, to, constants.COPYFILE_EXCL)
    try {
      await fs.unlink(from)
    } catch (unlinkErr) {
      await fs.unlink(to).catch(() => {})
      throw unlinkErr
    }
  }
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

export interface WalkOptions {
  skipHidden?: boolean
  signal?: AbortSignal
}

/**
 * Recursively yields regular files. Never follows symlinks or junctions, never enters a Safe Bin,
 * and silently skips entries it cannot read.
 */
export async function* walkFiles(dir: string, opts: WalkOptions = {}): AsyncGenerator<FileInfo> {
  const stack = [dir]
  while (stack.length) {
    if (opts.signal?.aborted) throw new Error('Cancelled')
    const current = stack.pop()!
    let entries
    try {
      entries = await fs.readdir(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (e.isSymbolicLink()) continue
      if (e.name.toLowerCase() === BIN_DIR_NAME) continue
      if (opts.skipHidden && e.name.startsWith('.')) continue
      const p = path.join(current, e.name)
      if (e.isDirectory()) {
        stack.push(p)
      } else if (e.isFile()) {
        try {
          const st = await fs.lstat(p)
          yield { path: p, size: st.size, mtimeMs: st.mtimeMs }
        } catch {
          // vanished or unreadable — skip
        }
      }
    }
  }
}

export async function dirSize(dir: string): Promise<number> {
  let total = 0
  for await (const f of walkFiles(dir)) total += f.size
  return total
}
