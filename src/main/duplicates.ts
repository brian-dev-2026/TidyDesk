import { createHash } from 'crypto'
import { createReadStream } from 'fs'
import fs from 'fs/promises'
import path from 'path'
import type { DupGroup, FileInfo } from '@shared/types'
import { isProtectedPath } from './guards'
import { walkFiles } from './fsutil'
import { excluder, isExcluded } from './exclusions'

const HEAD_BYTES = 65536
/** Folders whose identical files belong to programs or projects, not to the user. */
const DEV_DIRS = new Set(['node_modules', '__pycache__', 'site-packages', 'bower_components'])

export interface DupProgress {
  phase: 'listing' | 'hashing'
  done: number
  total: number
}

export interface FindOptions {
  minSize: number
  signal?: AbortSignal
  onProgress?: (p: DupProgress) => void
  exclusions?: string[]
}

async function headHash(file: string): Promise<string> {
  const fh = await fs.open(file, 'r')
  try {
    const buf = Buffer.alloc(HEAD_BYTES)
    const { bytesRead } = await fh.read(buf, 0, HEAD_BYTES, 0)
    return createHash('sha256').update(buf.subarray(0, bytesRead)).digest('hex')
  } finally {
    await fh.close()
  }
}

function fullHash(file: string, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256')
    const s = createReadStream(file, { signal })
    s.on('data', (chunk) => h.update(chunk))
    s.on('error', reject)
    s.on('end', () => resolve(h.digest('hex')))
  })
}

function multiples<K>(map: Map<K, FileInfo[]>): FileInfo[][] {
  return [...map.values()].filter((g) => g.length > 1)
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('Cancelled')
}

/** Unique roots, dropping any that sit inside another, so no file is listed twice. */
function distinctRoots(dirs: string[]): string[] {
  // path.resolve drops trailing separators except on a drive root such as C:\
  const key = (p: string): string => path.resolve(p).toLowerCase()
  const keys = [...new Set(dirs.map(key))]
  const inside = (k: string): boolean => keys.some((o) => o !== k && k.startsWith(o.endsWith(path.sep) ? o : o + path.sep))
  const out: string[] = []
  const seen = new Set<string>()
  for (const d of dirs) {
    const k = key(d)
    if (seen.has(k) || inside(k)) continue
    seen.add(k)
    out.push(path.resolve(d))
  }
  return out
}

/**
 * Groups files under one or more folders whose contents are byte-identical
 * (size → 64 KB head hash → full SHA-256). Hidden and developer folders are skipped.
 */
export async function findDuplicates(dirs: string | string[], opts: FindOptions): Promise<DupGroup[]> {
  const roots = distinctRoots(typeof dirs === 'string' ? [dirs] : dirs)
  for (const dir of roots) {
    if (isProtectedPath(dir)) throw new Error('Protected folder')
    if (opts.exclusions && isExcluded(dir, opts.exclusions)) throw new Error('This folder is in your exclusions list')
  }
  const { signal, onProgress } = opts
  checkAbort(signal)

  const excluded = excluder(opts.exclusions)
  const exclude = (p: string): boolean => DEV_DIRS.has(path.basename(p).toLowerCase()) || !!excluded?.(p)
  const bySize = new Map<number, FileInfo[]>()
  const seen = new Set<string>()
  let listed = 0
  for (const dir of roots) {
    for await (const f of walkFiles(dir, { signal, exclude, skipHidden: true })) {
      const k = f.path.toLowerCase()
      if (seen.has(k)) continue
      seen.add(k)
      listed++
      if (listed % 500 === 0) onProgress?.({ phase: 'listing', done: listed, total: 0 })
      if (f.size < opts.minSize) continue
      const g = bySize.get(f.size)
      if (g) g.push(f)
      else bySize.set(f.size, [f])
    }
  }
  onProgress?.({ phase: 'listing', done: listed, total: listed })

  const candidates = multiples(bySize)
  const total = candidates.reduce((n, g) => n + g.length, 0)
  let done = 0
  const tick = (): void => onProgress?.({ phase: 'hashing', done: ++done, total })
  onProgress?.({ phase: 'hashing', done: 0, total })

  const groups: DupGroup[] = []
  for (const sizeGroup of candidates) {
    const byHead = new Map<string, FileInfo[]>()
    for (const f of sizeGroup) {
      checkAbort(signal)
      try {
        const k = await headHash(f.path)
        byHead.set(k, [...(byHead.get(k) ?? []), f])
      } catch {
        // unreadable — drop
      }
    }
    for (const [head, headGroup] of byHead) {
      if (headGroup.length < 2) continue
      const byFull = new Map<string, FileInfo[]>()
      for (const f of headGroup) {
        checkAbort(signal)
        try {
          // a file no larger than the head block is already fully hashed
          const k = f.size <= HEAD_BYTES ? head : await fullHash(f.path, signal)
          byFull.set(k, [...(byFull.get(k) ?? []), f])
        } catch {
          checkAbort(signal) // surface cancellation; otherwise the file was unreadable — drop
        }
        tick()
      }
      for (const [hash, files] of byFull) {
        if (files.length < 2) continue
        groups.push({ hash, size: files[0].size, files: files.sort((a, b) => a.mtimeMs - b.mtimeMs) })
      }
    }
  }
  return groups.sort((a, b) => b.size * (b.files.length - 1) - a.size * (a.files.length - 1))
}

/** The copies to remove: every file of each group except the oldest (ties keep the shorter path). */
export function pickDuplicateRemovals(groups: DupGroup[]): string[] {
  return groups.flatMap((g) => {
    const [, ...rest] = [...g.files].sort((a, b) => a.mtimeMs - b.mtimeMs || a.path.length - b.path.length || a.path.localeCompare(b.path))
    return rest.map((f) => f.path)
  })
}
