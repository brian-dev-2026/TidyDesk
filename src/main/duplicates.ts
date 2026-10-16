import { createHash } from 'crypto'
import { createReadStream } from 'fs'
import fs from 'fs/promises'
import type { DupGroup, FileInfo } from '@shared/types'
import { isProtectedPath } from './guards'
import { walkFiles } from './fsutil'

const HEAD_BYTES = 65536

export interface DupProgress {
  phase: 'listing' | 'hashing'
  done: number
  total: number
}

export interface FindOptions {
  minSize: number
  signal?: AbortSignal
  onProgress?: (p: DupProgress) => void
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

/** Groups files under dir whose contents are byte-identical (size → 64 KB head hash → full SHA-256). */
export async function findDuplicates(dir: string, opts: FindOptions): Promise<DupGroup[]> {
  if (isProtectedPath(dir)) throw new Error('Protected folder')
  const { signal, onProgress } = opts
  checkAbort(signal)

  const bySize = new Map<number, FileInfo[]>()
  let listed = 0
  for await (const f of walkFiles(dir, { signal })) {
    listed++
    if (listed % 500 === 0) onProgress?.({ phase: 'listing', done: listed, total: 0 })
    if (f.size < opts.minSize) continue
    const g = bySize.get(f.size)
    if (g) g.push(f)
    else bySize.set(f.size, [f])
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
