import { describe, it, expect } from 'vitest'
import { csvLine, historyToCsvRows, CSV_HEADER } from '../../src/main/csv'
import type { HistoryEntry } from '../../src/shared/types'

const base = (o: Partial<HistoryEntry>): HistoryEntry => ({
  id: 'x',
  type: 'junk',
  title: 'Junk clean',
  createdAt: Date.UTC(2026, 9, 16, 10, 0, 0),
  status: 'held',
  count: 0,
  bytes: 0,
  skipped: 0,
  ...o
})

describe('csv', () => {
  it('header has the agreed columns', () => {
    expect(CSV_HEADER).toEqual(['date', 'action', 'title', 'status', 'dry_run', 'path', 'destination', 'size_bytes', 'item_state', 'reason'])
  })

  it('csvLine quotes commas, quotes and newlines and ends with CRLF', () => {
    expect(csvLine(['a', 'b,c', 'say "hi"', 'two\nlines', 3, true, undefined])).toBe('a,"b,c","say ""hi""","two\nlines",3,true,\r\n')
  })

  it('csvLine neutralises spreadsheet formulas', () => {
    expect(csvLine(['=cmd|calc', '+1', '-2', '@x'])).toBe("'=cmd|calc,'+1,'-2,'@x\r\n")
  })

  it('rows for a junk entry: one per item', () => {
    const rows = historyToCsvRows(
      base({
        items: [
          { originalPath: 'C:\\t\\a.tmp', binPath: 'C:\\.tidydesk-bin\\x\\0_a.tmp', size: 10, state: 'held' },
          { originalPath: 'C:\\t\\b.tmp', binPath: '', size: 0, state: 'skipped', reason: 'RECENT' }
        ]
      })
    )
    expect(rows).toEqual([
      ['2026-10-16T10:00:00.000Z', 'junk', 'Junk clean', 'held', 'false', 'C:\\t\\a.tmp', 'C:\\.tidydesk-bin\\x\\0_a.tmp', '10', 'held', ''],
      ['2026-10-16T10:00:00.000Z', 'junk', 'Junk clean', 'held', 'false', 'C:\\t\\b.tmp', '', '0', 'skipped', 'RECENT']
    ])
  })

  it('rows for organize, empty-folders and recycle-sweep entries', () => {
    const org = historyToCsvRows(base({ type: 'organize', title: 'Organized D', status: 'applied', moves: [{ from: 'C:\\d\\a.pdf', to: 'C:\\d\\Documents\\a.pdf', category: 'Documents', done: true }] }))
    expect(org[0].slice(5, 9)).toEqual(['C:\\d\\a.pdf', 'C:\\d\\Documents\\a.pdf', '', 'moved'])
    const empty = historyToCsvRows(base({ type: 'empty-folders', status: 'done', folders: ['C:\\d\\x', 'C:\\d\\y'] }))
    expect(empty.map((r) => r[5])).toEqual(['C:\\d\\x', 'C:\\d\\y'])
    expect(empty[0][8]).toBe('removed')
    const sweep = historyToCsvRows(base({ type: 'recycle-sweep', title: 'Recycle Bin: 3 items', status: 'done', count: 3, bytes: 99, dryRun: true }))
    expect(sweep).toEqual([['2026-10-16T10:00:00.000Z', 'recycle-sweep', 'Recycle Bin: 3 items', 'done', 'true', '', '', '99', '', '']])
  })
})
