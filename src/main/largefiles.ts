import path from 'path'
import type { FileInfo } from '@shared/types'
import { isProtectedPath } from './guards'
import { isExcluded } from './exclusions'
import { walkFiles } from './fsutil'

export interface LargeFileOptions {
  minSize: number
  limit: number
  exclusions?: string[]
  signal?: AbortSignal
  onProgress?: (seen: number) => void
  /** Folders not to enter; defaults to the system protected-path rule. */
  isProtected?: (p: string) => boolean
}

/**
 * The `limit` largest files under dir (at least minSize bytes), largest first. A drive root may be
 * scanned — protected system folders inside it are skipped — but no other protected folder may.
 */
export async function findLargeFiles(dir: string, opts: LargeFileOptions): Promise<FileInfo[]> {
  const resolved = path.resolve(dir)
  const isRoot = resolved === path.parse(resolved).root
  if (!isRoot && isProtectedPath(resolved)) throw new Error('Protected folder')
  const exclusions = opts.exclusions ?? []
  if (isExcluded(resolved, exclusions)) throw new Error('This folder is in your exclusions list')
  const isProtected = opts.isProtected ?? isProtectedPath

  // ascending by size; top[0] is the smallest kept, so a new file only enters if it beats it
  const top: FileInfo[] = []
  let seen = 0
  for await (const f of walkFiles(resolved, {
    signal: opts.signal,
    exclude: (p) => isProtected(p) || isExcluded(p, exclusions)
  })) {
    if (++seen % 2000 === 0) opts.onProgress?.(seen)
    if (f.size < opts.minSize) continue
    if (top.length >= opts.limit && f.size <= top[0].size) continue
    let lo = 0
    let hi = top.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (top[mid].size < f.size) lo = mid + 1
      else hi = mid
    }
    top.splice(lo, 0, f)
    if (top.length > opts.limit) top.shift()
  }
  opts.onProgress?.(seen)
  return top.reverse()
}
