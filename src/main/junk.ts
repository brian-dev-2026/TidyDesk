import fs from 'fs/promises'
import path from 'path'
import { execFile } from 'child_process'
import type { JunkCategory } from '@shared/types'
import { walkFiles } from './fsutil'
import { excluder } from './exclusions'

export interface JunkRoot {
  /** May contain a single "*" segment, expanded to every subfolder (browser profiles). */
  path: string
  browserProcess?: string
}

export interface JunkDef {
  id: string
  label: string
  description: string
  roots: JunkRoot[]
  filePattern?: RegExp
}

const RECENT_MS = 3600000

const BROWSERS: { name: string; dir: string[]; process: string }[] = [
  { name: 'Chrome', dir: ['Google', 'Chrome'], process: 'chrome.exe' },
  { name: 'Edge', dir: ['Microsoft', 'Edge'], process: 'msedge.exe' },
  { name: 'Brave', dir: ['BraveSoftware', 'Brave-Browser'], process: 'brave.exe' }
]
const BROWSER_NAMES: Record<string, string> = {
  'chrome.exe': 'Chrome',
  'msedge.exe': 'Edge',
  'brave.exe': 'Brave',
  'firefox.exe': 'Firefox'
}

export function junkCategories(env: NodeJS.ProcessEnv): JunkDef[] {
  const local = env.LOCALAPPDATA ?? ''
  const sysRoot = env.SystemRoot ?? 'C:\\Windows'
  const browserRoots: JunkRoot[] = []
  for (const b of BROWSERS) {
    for (const sub of ['Cache', 'Code Cache', 'GPUCache']) {
      browserRoots.push({ path: path.join(local, ...b.dir, 'User Data', '*', sub), browserProcess: b.process })
    }
  }
  browserRoots.push({
    path: path.join(local, 'Mozilla', 'Firefox', 'Profiles', '*', 'cache2'),
    browserProcess: 'firefox.exe'
  })
  return [
    {
      id: 'user-temp',
      label: 'User temp files',
      description: 'Temporary files left behind by apps and installers.',
      roots: env.TEMP ? [{ path: env.TEMP }] : []
    },
    {
      id: 'windows-temp',
      label: 'Windows temp files',
      description: 'System temporary files your account can access.',
      roots: [{ path: path.join(sysRoot, 'Temp') }]
    },
    {
      id: 'browser-cache',
      label: 'Browser cache',
      description: 'Cached web content from Chrome, Edge, Brave and Firefox.',
      roots: local ? browserRoots : []
    },
    {
      id: 'thumbnails',
      label: 'Thumbnail cache',
      description: 'Explorer thumbnail databases; Windows rebuilds them as needed.',
      roots: local ? [{ path: path.join(local, 'Microsoft', 'Windows', 'Explorer') }] : [],
      filePattern: /^thumbcache_.*\.db$/i
    },
    {
      id: 'crash-dumps',
      label: 'Crash dumps & error reports',
      description: 'Memory dumps and Windows Error Reporting files.',
      roots: local
        ? [{ path: path.join(local, 'CrashDumps') }, { path: path.join(local, 'Microsoft', 'Windows', 'WER') }]
        : []
    }
  ]
}

async function expand(root: string): Promise<string[]> {
  const parts = root.split(path.sep)
  const star = parts.indexOf('*')
  if (star < 0) return [root]
  const base = parts.slice(0, star).join(path.sep)
  const rest = parts.slice(star + 1)
  try {
    const entries = await fs.readdir(base, { withFileTypes: true })
    return entries.filter((e) => e.isDirectory()).map((e) => path.join(base, e.name, ...rest))
  } catch {
    return []
  }
}

export interface ScanOptions {
  now?: number
  running?: Set<string>
  /** done/total categories, plus the number of files looked at so far. */
  onProgress?: (done: number, total: number, filesSeen: number) => void
  exclusions?: string[]
}

export async function scanJunk(
  defs: JunkDef[],
  opts: ScanOptions = {}
): Promise<{ categories: JunkCategory[]; files: Record<string, string[]> }> {
  const now = opts.now ?? Date.now()
  const running = opts.running ?? new Set<string>()
  const categories: JunkCategory[] = []
  const files: Record<string, string[]> = {}
  let done = 0
  let seen = 0
  for (const def of defs) {
    const list: string[] = []
    let bytes = 0
    const blocked = new Set<string>()
    for (const root of def.roots) {
      if (root.browserProcess && running.has(root.browserProcess)) {
        blocked.add(BROWSER_NAMES[root.browserProcess] ?? root.browserProcess)
        continue
      }
      for (const dir of await expand(root.path)) {
        if (opts.exclusions && excluder(opts.exclusions)!(dir)) continue
        // the filtered categories (thumbnails) only look at the folder's own files
        for await (const f of walkFiles(dir, { exclude: excluder(opts.exclusions) })) {
          if (++seen % 2000 === 0) opts.onProgress?.(done, defs.length, seen)
          if (def.filePattern && (path.dirname(f.path) !== dir || !def.filePattern.test(path.basename(f.path)))) continue
          if (f.mtimeMs > now - RECENT_MS) continue
          list.push(f.path)
          bytes += f.size
        }
      }
    }
    const cat: JunkCategory = {
      id: def.id,
      label: def.label,
      description: def.description,
      bytes,
      fileCount: list.length
    }
    if (blocked.size) cat.note = `Close ${[...blocked].join(', ')} to clean ${blocked.size > 1 ? 'their caches' : 'its cache'}`
    categories.push(cat)
    files[def.id] = list
    opts.onProgress?.(++done, defs.length, seen)
  }
  return { categories, files }
}

/** Lowercase image names of running processes. */
export function runningBrowsers(): Promise<Set<string>> {
  return new Promise((resolve) => {
    execFile('tasklist', ['/fo', 'csv', '/nh'], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, out) => {
      if (err) return resolve(new Set())
      const names = out
        .split(/\r?\n/)
        .map((l) => l.split('","')[0]?.replace(/^"/, '').toLowerCase())
        .filter(Boolean)
      resolve(new Set(names))
    })
  })
}
