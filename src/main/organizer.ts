import fs from 'fs/promises'
import path from 'path'
import type { HistoryEntry, Move } from '@shared/types'
import type { HistoryStore } from './history'
import { isProtectedPath } from './guards'
import { moveFile, pathExists, uniquePath } from './fsutil'

export const CATEGORIES: Record<string, string[]> = {
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
const OTHER = 'Other'
const FOLDER_NAMES = new Set([...Object.keys(CATEGORIES), OTHER].map((n) => n.toLowerCase()))
const HIDDEN_NAMES = new Set(['desktop.ini', 'thumbs.db'])

const EXT_TO_CATEGORY = new Map<string, string>()
for (const [cat, exts] of Object.entries(CATEGORIES)) for (const ext of exts) EXT_TO_CATEGORY.set(ext, cat)

export function categoryOf(file: string): string {
  return EXT_TO_CATEGORY.get(path.extname(file).slice(1).toLowerCase()) ?? OTHER
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

/** Plans moving every top-level, non-hidden file of dir into category subfolders. Touches nothing on disk. */
export async function planOrganize(dir: string): Promise<Move[]> {
  if (isProtectedPath(dir)) throw new Error('Protected folder')
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const folders = new Map<string, string>()
  const taken = new Set<string>()
  const moves: Move[] = []
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!e.isFile()) continue
    const lower = e.name.toLowerCase()
    if (e.name.startsWith('.') || HIDDEN_NAMES.has(lower) || FOLDER_NAMES.has(lower)) continue
    const category = categoryOf(e.name)
    if (!folders.has(category)) folders.set(category, await categoryFolder(dir, category))
    const to = await uniquePath(path.join(folders.get(category)!, e.name), undefined, taken)
    taken.add(to.toLowerCase())
    moves.push({ from: path.join(dir, e.name), to, category })
  }
  return moves
}

export async function applyOrganize(
  dir: string,
  moves: Move[],
  history: HistoryStore,
  opts: { dryRun?: boolean } = {}
): Promise<HistoryEntry> {
  if (isProtectedPath(dir)) throw new Error('Protected folder')
  const base = path.resolve(dir).toLowerCase()
  for (const m of moves) {
    const fromOk = path.dirname(path.resolve(m.from)).toLowerCase() === base
    const toOk = path.dirname(path.dirname(path.resolve(m.to))).toLowerCase() === base
    if (!fromOk || !toOk) throw new Error(`Invalid move: ${m.from}`)
  }
  const done: Move[] = moves.map((m) => ({ ...m, done: false }))
  const createdDirs: string[] = []
  let skipped = 0
  if (!opts.dryRun) {
    for (const m of done) {
      const parent = path.dirname(m.to)
      const existed = await pathExists(parent)
      try {
        await moveFile(m.from, m.to)
        m.done = true
        if (!existed && !createdDirs.includes(parent)) createdDirs.push(parent)
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
  for (const d of e.createdDirs ?? []) await fs.rmdir(d).catch(() => {})
  return history.update(e.id, { moves, status: 'undone' })
}
