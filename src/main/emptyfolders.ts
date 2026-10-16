import fs from 'fs/promises'
import path from 'path'
import { execFile } from 'child_process'
import type { HistoryEntry } from '@shared/types'
import type { HistoryStore } from './history'
import { BIN_DIR_NAME, isProtectedPath } from './guards'
import { isExcluded } from './exclusions'

const SKIP_NAMES = new Set(['.git', BIN_DIR_NAME])

/**
 * Lowercase full paths of every Hidden or System folder under dir (one PowerShell call). PowerShell
 * may spell the folder differently (it expands 8.3 short names), so it reports paths relative to dir.
 */
function hiddenFolders(dir: string): Promise<Set<string>> {
  if (process.platform !== 'win32') return Promise.resolve(new Set())
  const script =
    '[Console]::OutputEncoding = [Text.Encoding]::UTF8; ' +
    '$root = (Get-Item -LiteralPath $env:TIDY_DIR -Force).FullName.TrimEnd([char]92); ' +
    'Get-ChildItem -LiteralPath $env:TIDY_DIR -Recurse -Force -Directory -ErrorAction SilentlyContinue | ' +
    'Where-Object { $_.Attributes -band ([IO.FileAttributes]::Hidden -bor [IO.FileAttributes]::System) } | ' +
    'ForEach-Object { $_.FullName.Substring($root.Length).TrimStart([char]92) }'
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { env: { ...process.env, TIDY_DIR: dir }, windowsHide: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
      (err, out) => {
        if (err) return reject(new Error('Could not read folder attributes'))
        const base = path.resolve(dir)
        resolve(new Set(out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((rel) => path.join(base, rel).toLowerCase())))
      }
    )
  })
}

/**
 * Folders under dir that contain no files at any depth, deepest first. Never returns dir itself,
 * and never looks inside hidden/system folders, .git, the Safe Bin, links or excluded paths.
 */
export async function findEmptyFolders(
  dir: string,
  opts: { exclusions?: string[]; signal?: AbortSignal } = {}
): Promise<string[]> {
  if (isProtectedPath(dir)) throw new Error('Protected folder')
  const exclusions = opts.exclusions ?? []
  if (isExcluded(dir, exclusions)) throw new Error('This folder is in your exclusions list')
  const hidden = await hiddenFolders(dir)
  const found: string[] = []

  /** Returns true when folder p holds no files at any depth (and adds empty descendants to found). */
  async function visit(p: string): Promise<boolean> {
    if (opts.signal?.aborted) throw new Error('Cancelled')
    let entries
    try {
      entries = await fs.readdir(p, { withFileTypes: true })
    } catch {
      return false // unreadable: treat as not empty, never remove
    }
    let empty = true
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const child = path.join(p, e.name)
      const skip =
        !e.isDirectory() ||
        e.isSymbolicLink() ||
        SKIP_NAMES.has(e.name.toLowerCase()) ||
        hidden.has(child.toLowerCase()) ||
        isExcluded(child, exclusions)
      if (skip) {
        empty = false // files, links and skipped folders all count as content
        continue
      }
      if (await visit(child)) found.push(child)
      else empty = false
    }
    return empty
  }

  await visit(path.resolve(dir))
  return found
}

/** Removes the given folders (deepest first) only if they are still empty right now. */
export async function removeEmptyFolders(
  paths: string[],
  history: HistoryStore,
  opts: { dryRun?: boolean; exclusions?: string[] } = {}
): Promise<HistoryEntry> {
  const ordered = [...paths].sort((a, b) => b.split(/[\\/]/).length - a.split(/[\\/]/).length)
  const removed: string[] = []
  let skipped = 0
  for (const p of ordered) {
    if (isProtectedPath(p) || (opts.exclusions && isExcluded(p, opts.exclusions))) {
      skipped++
      continue
    }
    if (opts.dryRun) {
      removed.push(p)
      continue
    }
    try {
      const st = await fs.lstat(p)
      if (!st.isDirectory() || st.isSymbolicLink()) throw new Error('not a folder')
      // rmdir only ever removes an empty folder, so a file that arrived after the scan is safe
      await fs.rmdir(p)
      removed.push(p)
    } catch {
      skipped++
    }
  }
  const entry: HistoryEntry = {
    id: history.newId(),
    type: 'empty-folders',
    title: `Removed ${removed.length} empty folder${removed.length === 1 ? '' : 's'}`,
    createdAt: Date.now(),
    status: opts.dryRun ? 'simulated' : 'done',
    count: removed.length,
    bytes: 0,
    skipped,
    folders: removed
  }
  if (opts.dryRun) entry.dryRun = true
  await history.add(entry)
  return entry
}

export async function restoreEmptyFolders(
  entryId: string,
  history: HistoryStore,
  opts: { dryRun?: boolean } = {}
): Promise<HistoryEntry> {
  if (opts.dryRun) throw new Error('Dry run is on — turn it off to change files')
  const e = await history.get(entryId)
  if (!e || e.type !== 'empty-folders') throw new Error('Not an empty-folders entry')
  if (e.dryRun) throw new Error('Dry run entry')
  for (const p of [...(e.folders ?? [])].reverse()) await fs.mkdir(p, { recursive: true })
  return history.update(e.id, { status: 'restored' })
}
