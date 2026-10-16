import fs from 'fs/promises'
import path from 'path'
import type { HistoryEntry, Move } from '@shared/types'
import type { HistoryStore } from './history'
import { isProtectedPath } from './guards'
import { execFile } from 'child_process'
import { moveFile, pathExists, uniquePath } from './fsutil'
import { isExcluded } from './exclusions'

export const DEFAULT_CATEGORIES: Record<string, string[]> = {
  Images: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'heic', 'tiff', 'ico', 'raw'],
  Documents: ['pdf', 'doc', 'docx', 'txt', 'rtf', 'odt', 'md', 'epub'],
  Spreadsheets: ['xls', 'xlsx', 'csv', 'ods'],
  Presentations: ['ppt', 'pptx', 'odp', 'key'],
  Videos: ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'webm', 'flv', 'm4v'],
  Music: ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma'],
  Archives: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'iso'],
  Installers: ['exe', 'msi', 'msix', 'appx', 'bat', 'cmd'],
  Code: ['js', 'ts', 'jsx', 'tsx', 'py', 'java', 'c', 'cpp', 'cs', 'go', 'rs', 'html', 'css', 'json', 'xml', 'yml', 'yaml', 'sh', 'ps1', 'sql', 'php', 'rb']
}
/** @deprecated use DEFAULT_CATEGORIES */
export const CATEGORIES = DEFAULT_CATEGORIES
const OTHER = 'Other'
const HIDDEN_NAMES = new Set(['desktop.ini', 'thumbs.db'])
const RESERVED_WIN = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

function extensionMap(categories: Record<string, string[]>): Map<string, string> {
  const m = new Map<string, string>()
  for (const [cat, exts] of Object.entries(categories)) for (const ext of exts) m.set(ext, cat)
  return m
}

export function categoryOf(file: string, categories: Record<string, string[]> = DEFAULT_CATEGORIES): string {
  return extensionMap(categories).get(path.extname(file).slice(1).toLowerCase()) ?? OTHER
}

/**
 * Checks a user-edited category table and returns it normalised (trimmed names, lowercase
 * extensions without dots). Throws an Error describing the first problem found.
 */
export function validateCategories(input: unknown): Record<string, string[]> {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !Object.keys(input).length) {
    throw new Error('Add at least one category')
  }
  const out: Record<string, string[]> = {}
  const names = new Set<string>()
  const owner = new Map<string, string>()
  for (const [rawName, rawExts] of Object.entries(input as Record<string, unknown>)) {
    const name = rawName.trim()
    if (!name || /[<>:"/\\|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name) || RESERVED_WIN.test(name)) {
      throw new Error(`"${rawName}" is not a valid folder name`)
    }
    if (name.toLowerCase() === OTHER.toLowerCase()) throw new Error('"Other" is reserved for files no category matches')
    if (names.has(name.toLowerCase())) throw new Error(`The category name "${name}" is used twice`)
    names.add(name.toLowerCase())
    if (!Array.isArray(rawExts)) throw new Error(`"${name}" needs a list of extensions`)
    const exts: string[] = []
    for (const raw of rawExts) {
      const ext = String(raw).trim().replace(/^\.+/, '').toLowerCase()
      if (!ext || /[\\/:*?"<>|\s]/.test(ext)) throw new Error(`"${name}" has an empty extension`)
      const prev = owner.get(ext)
      if (prev && prev !== name) throw new Error(`".${ext}" is in two categories: ${prev} and ${name}`)
      owner.set(ext, name)
      if (!exts.includes(ext)) exts.push(ext)
    }
    out[name] = exts
  }
  return out
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** The folder a category's files go into: the category name, or the first free "Name (n)" if a file holds that name. */
async function categoryFolder(dir: string, category: string): Promise<string> {
  for (let i = 0; ; i++) {
    const p = path.join(dir, i === 0 ? category : `${category} (${i})`)
    try {
      const st = await fs.lstat(p)
      if (st.isDirectory()) return p
    } catch {
      return p
    }
  }
}

/** Lowercase names of files in dir that Windows marks Hidden or System (e.g. Office "~$" lock files). */
function hiddenOrSystemNames(dir: string): Promise<Set<string>> {
  if (process.platform !== 'win32') return Promise.resolve(new Set())
  const script =
    '[Console]::OutputEncoding = [Text.Encoding]::UTF8; ' +
    'Get-ChildItem -LiteralPath $env:TIDY_DIR -Force -File | ' +
    'Where-Object { $_.Attributes -band ([IO.FileAttributes]::Hidden -bor [IO.FileAttributes]::System) } | ' +
    'ForEach-Object { $_.Name }'
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { env: { ...process.env, TIDY_DIR: dir }, windowsHide: true, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
      (err, out) => {
        // without the attribute list we cannot tell which files are hidden, so refuse rather than guess
        if (err) return reject(new Error('Could not read file attributes in this folder'))
        resolve(new Set(out.split(/\r?\n/).map((n) => n.trim().toLowerCase()).filter(Boolean)))
      }
    )
  })
}

export interface PlanOptions {
  exclusions?: string[]
  /** 'type' sorts into category folders; 'date' into YYYY\\YYYY-MM by modified time. */
  mode?: 'type' | 'date'
  categories?: Record<string, string[]>
}

/** Plans moving every top-level, non-hidden file of dir into subfolders. Touches nothing on disk. */

export async function planOrganize(dir: string, opts: PlanOptions = {}): Promise<Move[]> {
  if (isProtectedPath(dir)) throw new Error('Protected folder')
  const exclusions = opts.exclusions ?? []
  if (isExcluded(dir, exclusions)) throw new Error('This folder is in your exclusions list (excluded)')
  const [entries, hidden] = await Promise.all([fs.readdir(dir, { withFileTypes: true }), hiddenOrSystemNames(dir)])
  const categories = opts.categories ?? DEFAULT_CATEGORIES
  const extMap = extensionMap(categories)
  const folderNames = new Set([...Object.keys(categories), OTHER].map((n) => n.toLowerCase()))
  const folders = new Map<string, string>()
  const taken = new Set<string>()
  const moves: Move[] = []
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!e.isFile()) continue
    const lower = e.name.toLowerCase()
    if (e.name.startsWith('.') || HIDDEN_NAMES.has(lower) || hidden.has(lower)) continue
    if (opts.mode !== 'date' && folderNames.has(lower)) continue
    const from = path.join(dir, e.name)
    if (isExcluded(from, exclusions)) continue
    let category: string
    let folderKey: string
    if (opts.mode === 'date') {
      const d = new Date((await fs.stat(from)).mtimeMs)
      const year = String(d.getFullYear())
      category = `${year}-${pad2(d.getMonth() + 1)}`
      folderKey = path.join(year, category)
      if (!folders.has(folderKey)) folders.set(folderKey, path.join(await categoryFolder(dir, year), category))
    } else {
      category = extMap.get(path.extname(e.name).slice(1).toLowerCase()) ?? OTHER
      folderKey = category
      if (!folders.has(folderKey)) folders.set(folderKey, await categoryFolder(dir, category))
    }
    const to = await uniquePath(path.join(folders.get(folderKey)!, e.name), undefined, taken)
    taken.add(to.toLowerCase())
    moves.push({ from, to, category })
  }
  return moves
}

export async function applyOrganize(
  dir: string,
  moves: Move[],
  history: HistoryStore,
  opts: { dryRun?: boolean; exclusions?: string[] } = {}
): Promise<HistoryEntry> {
  if (isProtectedPath(dir)) throw new Error('Protected folder')
  const base = path.resolve(dir).toLowerCase()
  for (const m of moves) {
    const fromOk = path.dirname(path.resolve(m.from)).toLowerCase() === base
    // destination: <dir>\<folder>\file (by type) or <dir>\<year>\<month>\file (by date)
    const depth = path.relative(base, path.resolve(m.to).toLowerCase()).split(path.sep).length
    const inside = path.resolve(m.to).toLowerCase().startsWith(base + path.sep)
    if (!fromOk || !inside || depth < 2 || depth > 3) throw new Error(`Invalid move: ${m.from}`)
  }
  const done: Move[] = moves.map((m) => ({ ...m, done: false }))
  const createdDirs: string[] = []
  let skipped = 0
  if (!opts.dryRun) {
    for (const m of done) {
      if (opts.exclusions && isExcluded(m.from, opts.exclusions)) {
        skipped++
        continue
      }
      // remember every folder level this move creates, so undo can remove exactly those
      const newDirs: string[] = []
      for (let d = path.dirname(m.to); d.toLowerCase() !== base && d.length > base.length; d = path.dirname(d)) {
        if (!(await pathExists(d))) newDirs.push(d)
      }
      try {
        await moveFile(m.from, m.to)
        m.done = true
        for (const d of newDirs) if (!createdDirs.includes(d)) createdDirs.push(d)
      } catch {
        skipped++
      }
    }
  }
  const entry: HistoryEntry = {
    id: history.newId(),
    type: 'organize',
    title: `Organized ${path.basename(dir)}`,
    createdAt: Date.now(),
    status: opts.dryRun ? 'simulated' : 'applied',
    count: opts.dryRun ? moves.length : done.filter((m) => m.done).length,
    bytes: 0,
    skipped,
    moves: done,
    createdDirs
  }
  if (opts.dryRun) entry.dryRun = true
  await history.add(entry)
  return entry
}

export async function undoOrganize(
  entryId: string,
  history: HistoryStore,
  opts: { dryRun?: boolean } = {}
): Promise<HistoryEntry> {
  if (opts.dryRun) throw new Error('Dry run is on — turn it off to undo')
  const e = await history.get(entryId)
  if (!e) throw new Error('History entry not found')
  if (e.dryRun) throw new Error('Dry run entry')
  if (e.type !== 'organize') throw new Error('Not an organize entry')
  if (e.status !== 'applied') throw new Error('Already undone')
  const moves = (e.moves ?? []).map((m) => ({ ...m }))
  for (const m of [...moves].reverse()) {
    if (!m.done) continue
    try {
      await moveFile(m.to, await uniquePath(m.from))
      m.done = false
    } catch {
      // leave it where it is; still listed as done
    }
  }
  // deepest first, so a year folder goes after its month folders
  const dirs = [...(e.createdDirs ?? [])].sort((a, b) => b.split(path.sep).length - a.split(path.sep).length)
  for (const d of dirs) await fs.rmdir(d).catch(() => {})
  return history.update(e.id, { moves, status: 'undone' })
}
