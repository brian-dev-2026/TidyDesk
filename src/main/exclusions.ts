import path from 'path'

const MAX_EXCLUSIONS = 200

function key(p: string): string {
  return path.win32.normalize(p).replace(/[\\/]+$/, '').toLowerCase()
}

/** True when p is one of the excluded paths or lies inside one of them. */
export function isExcluded(p: string, list: string[]): boolean {
  if (!list.length) return false
  const k = key(p)
  return list.some((e) => {
    const ek = key(e)
    return k === ek || k.startsWith(ek + '\\')
  })
}

/** Keeps absolute, unique paths (case-insensitive), without trailing slashes, at most 200. */
export function normaliseExclusions(list: unknown): string[] {
  if (!Array.isArray(list)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const v of list) {
    if (typeof v !== 'string' || !path.win32.isAbsolute(v) || !/^[a-z]:/i.test(v)) continue
    const p = path.win32.normalize(v).replace(/[\\/]+$/, '').replace(/^([a-z]:)$/i, '$1\\')
    const k = p.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(p)
    if (out.length >= MAX_EXCLUSIONS) break
  }
  return out
}

/** Predicate for walkFiles: skip anything excluded. */
export function excluder(list: string[] | undefined): ((p: string) => boolean) | undefined {
  return list && list.length ? (p) => isExcluded(p, list) : undefined
}
