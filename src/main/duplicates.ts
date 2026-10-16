import { createHash } from 'crypto'
import { createReadStream } from 'fs'
import fs from 'fs/promises'
import path from 'path'
import type { DupGroup, FileInfo } from '@shared/types'
import { isProtectedPath } from './guards'
import { walkFiles } from './fsutil'
import { excluder, isExcluded } from './exclusions'
import { DEFAULT_CATEGORIES } from './organizer'

const HEAD_BYTES = 65536

/** Folders whose identical files belong to programs, games or projects, not to the user. */
const SKIP_DIR_NAMES = new Set([
  'node_modules', '__pycache__', 'site-packages', 'bower_components', 'bin', 'obj', 'target', 'build', 'dist',
  'vendor', 'packages', 'venv', 'appdata', 'windowspowershell', 'powershell', 'my games', 'github', 'source', 'arduino'
])
/** A folder holding one of these is a project or app root and is skipped whole. */
const PROJECT_MARKERS = new Set(['.git', '.svn', '.hg', 'pyvenv.cfg', 'package.json', 'cargo.toml', 'go.mod', 'pom.xml', 'build.gradle'])
const PROJECT_MARKER_EXT = /\.(sln|csproj|vbproj|fsproj|vcxproj)$/i

/** What the one-click remover may compare: the user's photos, documents, media and archives. */
export const USER_CONTENT_EXTENSIONS = new Set([
  ...['Images', 'Documents', 'Spreadsheets', 'Presentations', 'Videos', 'Music', 'Archives'].flatMap((c) => DEFAULT_CATEGORIES[c]),
  'msi'
])

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
  /** Only files with these lowercase extensions (no dot) are compared. */
  extensions?: Set<string>
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

/** Volume + file id, or undefined when the file system cannot tell files apart. */
async function fileId(p: string): Promise<string | undefined> {
  const st = await fs.stat(p, { bigint: true })
  return st.ino === 0n ? undefined : `${st.dev}:${st.ino}`
}

function multiples<K>(map: Map<K, FileInfo[]>): FileInfo[][] {
  return [...map.values()].filter((g) => g.length > 1)
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('Cancelled')
}

/** The real location of a folder (junctions, links, mapped drives and 8.3 names resolved), lowercased. */
async function realKey(dir: string): Promise<string> {
  const real = await fs.realpath(dir).catch(() => path.resolve(dir))
  return real.toLowerCase()
}

/**
 * Unique roots, dropping any whose real location equals or sits inside another's, so no file is
 * listed twice. Roots keep the form they were given in, so results and exclusions match it.
 */
async function distinctRoots(dirs: string[]): Promise<string[]> {
  const items = await Promise.all(dirs.map(async (d) => ({ dir: path.resolve(d), key: await realKey(d) })))
  // a drive root such as c:\ already ends with a separator
  const under = (k: string, o: string): boolean => k.startsWith(o.endsWith(path.sep) ? o : o + path.sep)
  const out: string[] = []
  const seen = new Set<string>()
  for (const { dir, key } of items) {
    if (seen.has(key) || items.some((o) => o.key !== key && under(key, o.key))) continue
    seen.add(key)
    out.push(dir)
  }
  return out
}

/** Splits a folder list into the ones that can be scanned and the ones that are skipped, with why. */
export async function usableRoots(
  dirs: string[],
  exclusions: string[]
): Promise<{ roots: string[]; skipped: { dir: string; error: string }[] }> {
  const roots: string[] = []
  const skipped: { dir: string; error: string }[] = []
  for (const dir of dirs) {
    if (isProtectedPath(dir)) skipped.push({ dir, error: 'Protected folder' })
    else if (isExcluded(dir, exclusions)) skipped.push({ dir, error: 'In your exclusions list' })
    else if (!(await fs.stat(dir).then((s) => s.isDirectory(), () => false))) skipped.push({ dir, error: 'Folder not found' })
    else roots.push(dir)
  }
  return { roots, skipped }
}

/**
 * Groups files under one or more folders whose contents are byte-identical
 * (size → 64 KB head hash → full SHA-256). Empty files, hidden folders and program or project
 * folders are skipped, and two paths to the same file on disk never count as copies.
 */
export async function findDuplicates(dirs: string | string[], opts: FindOptions): Promise<DupGroup[]> {
  const roots = await distinctRoots(typeof dirs === 'string' ? [dirs] : dirs)
  for (const dir of roots) {
    if (isProtectedPath(dir)) throw new Error('Protected folder')
    if (opts.exclusions && isExcluded(dir, opts.exclusions)) throw new Error('This folder is in your exclusions list')
  }
  const { signal, onProgress } = opts
  const minSize = Math.max(1, opts.minSize)
  checkAbort(signal)

  const excluded = excluder(opts.exclusions)
  const exclude = (p: string): boolean => SKIP_DIR_NAMES.has(path.basename(p).toLowerCase()) || !!excluded?.(p)
  const skipFolder = (_dir: string, names: string[]): boolean =>
    names.some((n) => PROJECT_MARKERS.has(n.toLowerCase()) || PROJECT_MARKER_EXT.test(n))
  const bySize = new Map<number, FileInfo[]>()
  const seen = new Set<string>()
  let listed = 0
  for (const dir of roots) {
    for await (const f of walkFiles(dir, { signal, exclude, skipFolder, skipHidden: true })) {
      const k = f.path.toLowerCase()
      if (seen.has(k)) continue
      seen.add(k)
      listed++
      if (listed % 500 === 0) onProgress?.({ phase: 'listing', done: listed, total: 0 })
      if (f.size < minSize) continue
      if (opts.extensions && !opts.extensions.has(path.extname(f.path).slice(1).toLowerCase())) continue
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
    // one entry per physical file: hard links and aliases share an id
    const unique: FileInfo[] = []
    const ids = new Set<string>()
    for (const f of sizeGroup) {
      checkAbort(signal)
      try {
        const id = await fileId(f.path)
        if (id && ids.has(id)) continue
        if (id) ids.add(id)
        unique.push({ ...f, id })
      } catch {
        // vanished — drop
      }
    }
    const byHead = new Map<string, FileInfo[]>()
    for (const f of unique) {
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
        // without file ids we cannot prove these are separate files, so leave the group alone
        if (files.some((f) => !f.id)) continue
        groups.push({ hash, size: files[0].size, files: files.sort((a, b) => a.mtimeMs - b.mtimeMs) })
      }
    }
  }
  return groups.sort((a, b) => b.size * (b.files.length - 1) - a.size * (a.files.length - 1))
}

export interface RemovalPlan {
  keep: FileInfo
  remove: FileInfo[]
}

/**
 * Which copy each group keeps: the oldest; on equal age the one in the better-ranked folder
 * (lower rank wins), then the shorter path. Every other copy is removed.
 */
export function planDuplicateRemovals(groups: DupGroup[], rank: (p: string) => number = () => 0): RemovalPlan[] {
  return groups.map((g) => {
    const [keep, ...remove] = [...g.files].sort(
      (a, b) => a.mtimeMs - b.mtimeMs || rank(a.path) - rank(b.path) || a.path.length - b.path.length || a.path.localeCompare(b.path)
    )
    return { keep, remove }
  })
}

async function unchanged(f: FileInfo): Promise<boolean> {
  try {
    const st = await fs.stat(f.path)
    return st.isFile() && st.size === f.size && st.mtimeMs === f.mtimeMs && (await fileId(f.path)) === f.id
  } catch {
    return false
  }
}

/**
 * Re-checks a plan just before moving: a group whose kept copy is gone or changed is dropped whole,
 * and a copy that changed since the scan is left alone. Returns the paths still safe to remove.
 */
export async function recheckRemovals(plans: RemovalPlan[]): Promise<string[]> {
  const out: string[] = []
  for (const p of plans) {
    if (!p.keep.id || !(await unchanged(p.keep))) continue
    for (const r of p.remove) {
      if (r.id && r.id !== p.keep.id && (await unchanged(r))) out.push(r.path)
    }
  }
  return out
}
