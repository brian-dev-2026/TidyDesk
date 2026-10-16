import type { HistoryEntry } from '@shared/types'

export const CSV_HEADER = ['date', 'action', 'title', 'status', 'dry_run', 'path', 'destination', 'size_bytes', 'item_state', 'reason']

function cell(v: string | number | boolean | undefined): string {
  if (v === undefined) return ''
  let s = String(v)
  // a leading = + - @ would run as a formula when the file is opened in a spreadsheet
  if (typeof v === 'string' && /^[=+\-@]/.test(s)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** One RFC 4180 line, CRLF-terminated. */
export function csvLine(values: (string | number | boolean | undefined)[]): string {
  return values.map(cell).join(',') + '\r\n'
}

/** One row per file, move or folder of an entry, or a single summary row when it has none. */
export function historyToCsvRows(e: HistoryEntry): string[][] {
  const head = [new Date(e.createdAt).toISOString(), e.type, e.title, e.status, String(!!e.dryRun)]
  const rows: string[][] = []
  for (const it of e.items ?? []) {
    rows.push([...head, it.originalPath, it.restoredTo ?? it.binPath, String(it.size), it.state, it.reason ?? ''])
  }
  for (const m of e.moves ?? []) {
    const state = e.status === 'simulated' ? 'would-move' : m.done ? 'moved' : e.status === 'undone' ? 'moved-back' : 'skipped'
    rows.push([...head, m.from, m.to, '', state, ''])
  }
  for (const f of e.folders ?? []) {
    const state = e.status === 'simulated' ? 'would-remove' : e.status === 'restored' ? 'recreated' : 'removed'
    rows.push([...head, f, '', '', state, ''])
  }
  if (!rows.length) rows.push([...head, '', '', String(e.bytes), '', ''])
  return rows
}
