import type { HistoryEntry } from '@shared/types'
import { formatBytes } from '@shared/format'
import { toast } from './api'

const plural = (n: number, word: string): string => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`

/** Toast describing what a restore actually did, including partial results. */
export function announceRestore(e: HistoryEntry): void {
  const r = e.lastRestore
  if (!r) return toast.success('Restored')
  if (r.restored === 0 && r.failed > 0) {
    return toast.error(`Nothing could be restored — ${plural(r.failed, 'file')} failed (in use or missing). See the details on the Dashboard.`)
  }
  const parts = [`Restored ${plural(r.restored, 'file')}`]
  if (r.renamed) parts.push(`${plural(r.renamed, 'file')} came back as a “(restored)” copy because the name was taken`)
  if (r.failed) parts.push(`${plural(r.failed, 'file')} could not be restored`)
  const msg = parts.join(' · ')
  if (r.failed) toast.error(msg)
  else if (r.renamed) toast.info(msg)
  else toast.success(msg)
}

/** Toast describing what a purge actually freed, including files that could not be deleted yet. */
export function announcePurge(e: HistoryEntry): void {
  const stillHeld = e.status === 'held' || e.status === 'partial'
  if (stillHeld) {
    const left = e.bytes - (e.restoredBytes ?? 0) - (e.freedBytes ?? 0)
    toast.error(
      `Freed ${formatBytes(e.freedBytes ?? 0)} — ${formatBytes(left)} could not be deleted yet (in use) and will be retried automatically.`
    )
  } else toast.success(`${formatBytes(e.freedBytes ?? 0)} permanently freed`)
}

/** Plain-language reason for a skipped or failed file. */
export function reasonText(code: string): string {
  switch (code) {
    case 'RECENT':
      return 'Changed in the last hour — left alone'
    case 'EBUSY':
    case 'EPERM':
    case 'EACCES':
      return 'In use or access denied'
    case 'ENOENT':
      return 'No longer exists'
    case 'EEXIST':
      return 'A file with that name already exists'
    default:
      return code
  }
}
