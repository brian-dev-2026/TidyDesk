import { describe, it, expect } from 'vitest'
import fs from 'fs/promises'
import path from 'path'
import { HistoryStore } from '../../src/main/history'
import type { HistoryEntry, BinItem } from '../../src/shared/types'
import { tmpDir, exists } from '../helpers/tmp'

function entry(id: string, createdAt: number, extra: Partial<HistoryEntry> = {}): HistoryEntry {
  return { id, type: 'junk', title: id, createdAt, status: 'held', count: 0, bytes: 0, skipped: 0, ...extra }
}

const item = (state: BinItem['state'] = 'held'): BinItem => ({ originalPath: 'x', binPath: 'y', size: 1, state })

describe('HistoryStore', () => {
  it('add/list newest first', async () => {
    const h = new HistoryStore(await tmpDir())
    await h.add(entry('a', 1))
    await h.add(entry('b', 2))
    expect((await h.list()).map((e) => e.id)).toEqual(['b', 'a'])
  })

  it('persists across instances', async () => {
    const d = await tmpDir()
    await new HistoryStore(d).add(entry('a', 1))
    expect((await new HistoryStore(d).list()).map((e) => e.id)).toEqual(['a'])
  })

  it('caps at 500', async () => {
    const h = new HistoryStore(await tmpDir())
    for (let i = 0; i < 505; i++) await h.add(entry('e' + i, i, { status: 'purged' }))
    const list = await h.list()
    expect(list).toHaveLength(500)
    expect(list.find((e) => e.id === 'e4')).toBeUndefined()
    expect(list.find((e) => e.id === 'e5')).toBeDefined()
  })

  it('uses sidecar over 2000 items', async () => {
    const d = await tmpDir()
    const h = new HistoryStore(d)
    const items: BinItem[] = Array.from({ length: 2001 }, (_, i) => ({
      originalPath: 'C:\\f' + i,
      binPath: 'D:\\b' + i,
      size: 1,
      state: 'held'
    }))
    await h.add(entry('big', 1, { items }))
    expect(await exists(path.join(d, 'history', 'big.json'))).toBe(true)
    expect((await h.list())[0].items).toBeUndefined()
    expect((await h.get('big'))!.items).toHaveLength(2001)
  })

  it('list strips items and moves; get returns them', async () => {
    const h = new HistoryStore(await tmpDir())
    await h.add(entry('a', 1, { items: [item()] }))
    expect((await h.list())[0].items).toBeUndefined()
    expect((await h.get('a'))!.items).toHaveLength(1)
  })

  it('update merges patch and persists items', async () => {
    const d = await tmpDir()
    const h = new HistoryStore(d)
    await h.add(entry('a', 1, { items: [item()] }))
    const u = await h.update('a', { status: 'restored', items: [item('restored')] })
    expect(u.status).toBe('restored')
    const again = await new HistoryStore(d).get('a')
    expect(again!.status).toBe('restored')
    expect(again!.items![0].state).toBe('restored')
  })

  it('all() returns full entries for internal use', async () => {
    const h = new HistoryStore(await tmpDir())
    await h.add(entry('a', 1, { items: [item()] }))
    expect((await h.all())[0].items).toHaveLength(1)
  })

  it('recovers from corrupt file', async () => {
    const d = await tmpDir()
    await fs.writeFile(path.join(d, 'history.json'), '{bad')
    const h = new HistoryStore(d)
    expect(await h.list()).toEqual([])
    const names = await fs.readdir(d)
    expect(names.some((n) => /^history\.corrupt-.*\.json$/.test(n))).toBe(true)
  })

  it('writes atomically', async () => {
    const d = await tmpDir()
    const h = new HistoryStore(d)
    await h.add(entry('a', 1))
    expect(await exists(path.join(d, 'history.json.tmp'))).toBe(false)
    expect(await exists(path.join(d, 'history.json'))).toBe(true)
  })

  it('concurrent adds are not lost', async () => {
    const h = new HistoryStore(await tmpDir())
    await Promise.all(Array.from({ length: 20 }, (_, i) => h.add(entry('c' + i, i))))
    expect(await h.list()).toHaveLength(20)
  })

  it('newId is unique', () => {
    const h = new HistoryStore('x')
    const ids = new Set(Array.from({ length: 100 }, () => h.newId()))
    expect(ids.size).toBe(100)
  })

  it('gap 8: the 500-entry cap never drops a batch that is still held', async () => {
    const h = new HistoryStore(await tmpDir())
    await h.add(entry('held-old', 0, { status: 'held' }))
    await h.add(entry('partial-old', 1, { status: 'partial' }))
    for (let i = 0; i < 505; i++) await h.add(entry('d' + i, 10 + i, { status: 'purged' }))
    const list = await h.list()
    expect(list).toHaveLength(500)
    expect(list.find((e) => e.id === 'held-old')).toBeDefined()
    expect(list.find((e) => e.id === 'partial-old')).toBeDefined()
  })
})
