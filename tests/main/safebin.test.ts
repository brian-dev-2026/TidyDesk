import { describe, it, expect } from 'vitest'
import fs from 'fs/promises'
import path from 'path'
import { SafeBin } from '../../src/main/safebin'
import { HistoryStore } from '../../src/main/history'
import { tmpDir, write, exists, snapshot } from '../helpers/tmp'

const HOUR = 3600000

async function setup(now = () => 1_000_000) {
  const root = await tmpDir()
  const data = path.join(root, 'data')
  const work = path.join(root, 'work')
  const bin = path.join(root, 'bin')
  await fs.mkdir(work, { recursive: true })
  const history = new HistoryStore(data)
  const safeBin = new SafeBin({ history, holdHours: () => 5, binRootFor: () => bin, now })
  return { root, data, work, bin, history, safeBin }
}

describe('SafeBin', () => {
  it('quarantine moves files and records entry', async () => {
    const { work, safeBin, history } = await setup()
    const a = await write(path.join(work, 'a.txt'), 'aaa')
    const b = await write(path.join(work, 'b.txt'), 'bb')
    const e = await safeBin.quarantine([a, b], { type: 'junk', title: 'Junk clean' })
    expect(await exists(a)).toBe(false)
    expect(await exists(b)).toBe(false)
    expect(e.status).toBe('held')
    expect(e.count).toBe(2)
    expect(e.bytes).toBe(5)
    expect(e.skipped).toBe(0)
    expect(e.createdAt).toBe(1_000_000)
    expect(e.expiresAt).toBe(1_000_000 + 5 * HOUR)
    for (const it of e.items!) expect(await exists(it.binPath)).toBe(true)
    expect((await history.get(e.id))!.items).toHaveLength(2)
  })

  it('same basenames do not collide in bin', async () => {
    const { work, safeBin } = await setup()
    const a = await write(path.join(work, 'a', 'x.txt'), 'from-a')
    const b = await write(path.join(work, 'b', 'x.txt'), 'from-b')
    const e = await safeBin.quarantine([a, b], { type: 'duplicates', title: 'Dups' })
    const contents = await Promise.all(e.items!.map((i) => fs.readFile(i.binPath, 'utf8')))
    expect(contents.sort()).toEqual(['from-a', 'from-b'])
  })

  it('restore all returns files to original paths', async () => {
    const { work, safeBin } = await setup()
    const a = await write(path.join(work, 'a.txt'), 'aaa')
    const e = await safeBin.quarantine([a], { type: 'junk', title: 't' })
    const r = await safeBin.restore(e.id)
    expect(r.status).toBe('restored')
    expect(await fs.readFile(a, 'utf8')).toBe('aaa')
    expect(r.items![0].state).toBe('restored')
  })

  it('restore subset gives partial', async () => {
    const { work, safeBin } = await setup()
    const a = await write(path.join(work, 'a.txt'))
    const b = await write(path.join(work, 'b.txt'))
    const e = await safeBin.quarantine([a, b], { type: 'junk', title: 't' })
    const r = await safeBin.restore(e.id, [a])
    expect(r.status).toBe('partial')
    expect(await exists(a)).toBe(true)
    expect(await exists(b)).toBe(false)
  })

  it('restore recreates missing parent dirs', async () => {
    const { work, safeBin } = await setup()
    const a = await write(path.join(work, 'deep', 'er', 'a.txt'), 'A')
    const e = await safeBin.quarantine([a], { type: 'junk', title: 't' })
    await fs.rm(path.join(work, 'deep'), { recursive: true })
    await safeBin.restore(e.id)
    expect(await fs.readFile(a, 'utf8')).toBe('A')
  })

  it('restore with conflict writes "(restored)" copy', async () => {
    const { work, safeBin } = await setup()
    const a = await write(path.join(work, 'a.txt'), 'old')
    const e = await safeBin.quarantine([a], { type: 'junk', title: 't' })
    await write(a, 'new')
    const r = await safeBin.restore(e.id)
    expect(await fs.readFile(a, 'utf8')).toBe('new')
    expect(await fs.readFile(path.join(work, 'a (restored).txt'), 'utf8')).toBe('old')
    expect(r.items![0].restoredTo).toBe(path.join(work, 'a (restored).txt'))
  })

  it('purge deletes bin folder and marks purged', async () => {
    const { work, safeBin, bin } = await setup()
    const a = await write(path.join(work, 'a.txt'))
    const e = await safeBin.quarantine([a], { type: 'junk', title: 't' })
    const p = await safeBin.purge(e.id)
    expect(p.status).toBe('purged')
    expect(p.purgedAt).toBe(1_000_000)
    expect(p.freedBytes).toBe(1)
    expect(p.items![0].state).toBe('purged')
    expect(await exists(path.join(bin, e.id))).toBe(false)
  })

  it('purge after partial restore keeps restored items restored', async () => {
    const { work, safeBin } = await setup()
    const a = await write(path.join(work, 'a.txt'))
    const b = await write(path.join(work, 'b.txt'))
    const e = await safeBin.quarantine([a, b], { type: 'junk', title: 't' })
    await safeBin.restore(e.id, [a])
    const p = await safeBin.purge(e.id)
    expect(p.items!.map((i) => i.state).sort()).toEqual(['purged', 'restored'])
    expect(await exists(a)).toBe(true)
    expect(p.freedBytes).toBe(1)
  })

  it('purgeExpired purges overdue batches on startup', async () => {
    const { work, data, bin, safeBin: first } = await setup()
    const a = await write(path.join(work, 'a.txt'))
    const e = await first.quarantine([a], { type: 'junk', title: 't' })
    // simulate an app restart 6 hours later
    const later = new SafeBin({
      history: new HistoryStore(data),
      holdHours: () => 5,
      binRootFor: () => bin,
      now: () => 1_000_000 + 6 * HOUR
    })
    expect(await later.purgeExpired()).toBe(1)
    expect((await new HistoryStore(data).get(e.id))!.status).toBe('purged')
  })

  it('purgeExpired leaves unexpired batches', async () => {
    const { work, safeBin } = await setup()
    const a = await write(path.join(work, 'a.txt'))
    await safeBin.quarantine([a], { type: 'junk', title: 't' })
    expect(await safeBin.purgeExpired()).toBe(0)
  })

  it('heldBytes sums held items', async () => {
    const { work, safeBin } = await setup()
    const a = await write(path.join(work, 'a.txt'), '1234')
    const b = await write(path.join(work, 'b.txt'), '12')
    const e = await safeBin.quarantine([a, b], { type: 'junk', title: 't' })
    expect(await safeBin.heldBytes()).toBe(6)
    const r = await safeBin.restore(e.id, [a])
    expect(r.restoredBytes).toBe(4)
    expect(await safeBin.heldBytes()).toBe(2)
  })

  it('dry run quarantine changes nothing', async () => {
    const { root, work, bin, safeBin } = await setup()
    const a = await write(path.join(work, 'a.txt'), 'aaa')
    await write(path.join(work, 'sub', 'b.txt'), 'bb')
    const before = await snapshot(work)
    const e = await safeBin.quarantine([a, path.join(work, 'sub', 'b.txt')], {
      type: 'junk',
      title: 't',
      dryRun: true
    })
    expect(await snapshot(work)).toEqual(before)
    expect(await exists(bin)).toBe(false)
    expect(e.status).toBe('simulated')
    expect(e.dryRun).toBe(true)
    expect(e.expiresAt).toBeUndefined()
    expect(e.count).toBe(2)
    expect(e.bytes).toBe(5)
    expect(e.items!.every((i) => i.state === 'would-remove' && i.binPath === '')).toBe(true)
    await expect(safeBin.restore(e.id)).rejects.toThrow('Dry run entry')
    await expect(safeBin.purge(e.id)).rejects.toThrow('Dry run entry')
    expect(await safeBin.purgeExpired()).toBe(0)
    expect(root).toBeTruthy()
  })

  it('orphans lists bin folders without history and purgeExpired never touches them', async () => {
    const { bin, safeBin } = await setup(() => 1_000_000 + 99 * HOUR)
    await write(path.join(bin, 'stray-1', '0_x.txt'), '12345')
    const orphans = await safeBin.orphans([path.dirname(bin)], path.basename(bin))
    expect(orphans).toEqual([{ binDir: path.join(bin, 'stray-1'), bytes: 5 }])
    await safeBin.purgeExpired()
    expect(await exists(path.join(bin, 'stray-1', '0_x.txt'))).toBe(true)
  })

  it('deleteOrphan only accepts a direct child of a bin folder', async () => {
    const { work, safeBin } = await setup()
    const realBin = path.join(work, '.tidydesk-bin')
    await write(path.join(realBin, 'stray', 'f.txt'))
    await expect(safeBin.deleteOrphan(work)).rejects.toThrow()
    await expect(safeBin.deleteOrphan(path.join(realBin, 'stray', 'f.txt'))).rejects.toThrow()
    await safeBin.deleteOrphan(path.join(realBin, 'stray'))
    expect(await exists(path.join(realBin, 'stray'))).toBe(false)
  })

  it('locked file is skipped', async () => {
    const { work, safeBin } = await setup()
    const a = await write(path.join(work, 'a.txt'), 'aa')
    const e = await safeBin.quarantine([a, path.join(work, 'missing.txt')], { type: 'junk', title: 't' })
    expect(e.count).toBe(1)
    expect(e.bytes).toBe(2)
    expect(e.skipped).toBe(1)
    const skipped = e.items!.find((i) => i.state === 'skipped')!
    expect(skipped.reason).toBe('ENOENT')
  })

  it('restore, purge and deleteOrphan refuse while dry run is on', async () => {
    const root = await tmpDir()
    const bin = path.join(root, '.tidydesk-bin')
    let dry = false
    const sb = new SafeBin({
      history: new HistoryStore(path.join(root, 'data')),
      holdHours: () => 5,
      binRootFor: () => bin,
      isDryRun: () => dry
    })
    const a = await write(path.join(root, 'w', 'a.txt'))
    const e = await sb.quarantine([a], { type: 'junk', title: 't' })
    await write(path.join(bin, 'stray', 'f.txt'))
    dry = true
    await expect(sb.restore(e.id)).rejects.toThrow('Dry run is on')
    await expect(sb.purge(e.id)).rejects.toThrow('Dry run is on')
    await expect(sb.deleteOrphan(path.join(bin, 'stray'))).rejects.toThrow('Dry run is on')
    expect(await exists(e.items![0].binPath)).toBe(true)
    expect(await exists(path.join(bin, 'stray', 'f.txt'))).toBe(true)
  })

  it('a batch that is still being moved is not an orphan and cannot be deleted', async () => {
    const root = await tmpDir()
    const bin = path.join(root, '.tidydesk-bin')
    const sb = new SafeBin({ history: new HistoryStore(path.join(root, 'data')), holdHours: () => 5, binRootFor: () => bin })
    const a = await write(path.join(root, 'w', 'a.txt'))
    const b = await write(path.join(root, 'w', 'b.txt'))
    let seen: unknown[] | null = null
    let deleteError: unknown = null
    await sb.quarantine([a, b], { type: 'junk', title: 't' }, async (done) => {
      if (done !== 1 || seen) return
      seen = await sb.orphans([root])
      const dirs = await fs.readdir(bin)
      deleteError = await sb.deleteOrphan(path.join(bin, dirs[0])).catch((err) => err)
    })
    await new Promise((r) => setTimeout(r, 50))
    expect(seen).toEqual([])
    expect(String(deleteError)).toContain('in use')
  })

  it('deleteOrphan refuses a folder that belongs to a held batch', async () => {
    const root = await tmpDir()
    const bin = path.join(root, '.tidydesk-bin')
    const sb = new SafeBin({ history: new HistoryStore(path.join(root, 'data')), holdHours: () => 5, binRootFor: () => bin })
    const a = await write(path.join(root, 'w', 'a.txt'))
    const e = await sb.quarantine([a], { type: 'junk', title: 't' })
    await expect(sb.deleteOrphan(path.join(bin, e.id))).rejects.toThrow('in use')
    expect(await exists(e.items![0].binPath)).toBe(true)
  })

  it('all-skipped quarantine leaves no empty batch folder', async () => {
    const { work, bin, safeBin } = await setup()
    await fs.mkdir(bin, { recursive: true })
    await safeBin.quarantine([path.join(work, 'missing.txt')], { type: 'junk', title: 't' })
    expect(await fs.readdir(bin)).toEqual([])
  })

  it('unreadable sidecar: restore and purge refuse and keep the entry', async () => {
    const { work, data, safeBin, history } = await setup()
    const files: string[] = []
    for (let i = 0; i < 2001; i++) files.push(await write(path.join(work, `f${i}.tmp`)))
    const e = await safeBin.quarantine(files, { type: 'junk', title: 't' })
    await fs.writeFile(path.join(data, 'history', `${e.id}.json`), '{corrupt')
    await expect(safeBin.restore(e.id)).rejects.toThrow()
    await expect(safeBin.purge(e.id)).rejects.toThrow()
    const listed = (await history.list()).find((x) => x.id === e.id)!
    expect(listed.status).toBe('held')
    expect(await exists(path.join(data, 'history', `${e.id}.json`))).toBe(true)
  }, 60000)

  it('purgeExpired skips a batch whose file list is unreadable and purges the rest', async () => {
    let now = 1_000_000
    const root = await tmpDir()
    const data = path.join(root, 'data')
    const sb = new SafeBin({ history: new HistoryStore(data), holdHours: () => 5, binRootFor: () => path.join(root, 'bin'), now: () => now })
    const big: string[] = []
    for (let i = 0; i < 2001; i++) big.push(await write(path.join(root, 'w', 'big', `f${i}.tmp`)))
    const bad = await sb.quarantine(big, { type: 'junk', title: 'big' })
    const ok = await sb.quarantine([await write(path.join(root, 'w', 'one.txt'))], { type: 'junk', title: 'small' })
    await fs.writeFile(path.join(data, 'history', `${bad.id}.json`), '{corrupt')
    now += 6 * 3600000
    expect(await sb.purgeExpired()).toBe(1)
    const list = await new HistoryStore(data).list()
    expect(list.find((e) => e.id === ok.id)!.status).toBe('purged')
    expect(list.find((e) => e.id === bad.id)!.status).toBe('held')
  }, 60000)
})
