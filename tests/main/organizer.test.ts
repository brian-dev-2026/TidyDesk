import { describe, it, expect } from 'vitest'
import fs from 'fs/promises'
import path from 'path'
import { planOrganize, applyOrganize, undoOrganize, validateCategories, autoOrganize } from '../../src/main/organizer'
import { HistoryStore } from '../../src/main/history'
import { tmpDir, write, exists, snapshot } from '../helpers/tmp'

async function setup() {
  const root = await tmpDir()
  const dir = path.join(root, 'Downloads')
  await fs.mkdir(dir)
  return { dir, history: new HistoryStore(path.join(root, 'data')) }
}

const rel = (dir: string, p: string) => path.relative(dir, p)

describe('organizer', () => {
  it('plans by extension', async () => {
    const { dir } = await setup()
    await write(path.join(dir, 'a.JPG'))
    await write(path.join(dir, 'b.pdf'))
    await write(path.join(dir, 'c.xyz'))
    await write(path.join(dir, 'noext'))
    const plan = await planOrganize(dir)
    const byName = Object.fromEntries(plan.map((m) => [path.basename(m.from), m]))
    expect(byName['a.JPG'].category).toBe('Images')
    expect(rel(dir, byName['a.JPG'].to)).toBe(path.join('Images', 'a.JPG'))
    expect(byName['b.pdf'].category).toBe('Documents')
    expect(byName['c.xyz'].category).toBe('Other')
    expect(byName['noext'].category).toBe('Other')
  })

  it('ignores subfolders and hidden files', async () => {
    const { dir } = await setup()
    await write(path.join(dir, 'sub', 'deep.png'))
    await write(path.join(dir, '.hidden.png'))
    await write(path.join(dir, 'desktop.ini'))
    await write(path.join(dir, 'Thumbs.db'))
    await write(path.join(dir, 'top.png'))
    const plan = await planOrganize(dir)
    expect(plan.map((m) => path.basename(m.from))).toEqual(['top.png'])
  })

  it('skips files named like a category folder', async () => {
    const { dir } = await setup()
    await write(path.join(dir, 'Images'))
    await write(path.join(dir, 'ok.png'))
    const plan = await planOrganize(dir)
    expect(plan.map((m) => path.basename(m.from))).toEqual(['ok.png'])
    // the "Images" name is taken by a file, so images go to a free folder name instead
    expect(rel(dir, plan[0].to)).toBe(path.join('Images (1)', 'ok.png'))
  })

  it('collision gets (1)', async () => {
    const { dir } = await setup()
    await write(path.join(dir, 'Images', 'a.jpg'), 'existing')
    await write(path.join(dir, 'a.jpg'), 'new')
    const [m] = await planOrganize(dir)
    expect(rel(dir, m.to)).toBe(path.join('Images', 'a (1).jpg'))
  })

  it('two planned files with same target name get unique targets', async () => {
    const { dir } = await setup()
    await write(path.join(dir, 'Images', 'a (1).jpg'))
    await write(path.join(dir, 'Images', 'a.jpg'))
    await write(path.join(dir, 'a.jpg'))
    await write(path.join(dir, 'a (1).jpg'))
    const plan = await planOrganize(dir)
    const targets = plan.map((m) => m.to.toLowerCase())
    expect(new Set(targets).size).toBe(2)
  })

  it('refuses protected folder', async () => {
    await expect(planOrganize('C:\\Windows')).rejects.toThrow('Protected folder')
  })

  it('apply then undo round-trip restores exact layout and removes created dirs', async () => {
    const { dir, history } = await setup()
    await write(path.join(dir, 'a.jpg'), 'A')
    await write(path.join(dir, 'b.pdf'), 'B')
    await write(path.join(dir, 'sub', 'keep.txt'), 'K')
    const before = await snapshot(dir)
    const plan = await planOrganize(dir)
    const e = await applyOrganize(dir, plan, history)
    expect(e.type).toBe('organize')
    expect(e.status).toBe('applied')
    expect(e.title).toBe('Organized Downloads')
    expect(e.count).toBe(2)
    expect(await exists(path.join(dir, 'Images', 'a.jpg'))).toBe(true)
    expect(await exists(path.join(dir, 'a.jpg'))).toBe(false)
    const u = await undoOrganize(e.id, history)
    expect(u.status).toBe('undone')
    expect(await snapshot(dir)).toEqual(before)
  })

  it('undo keeps pre-existing category folders', async () => {
    const { dir, history } = await setup()
    await fs.mkdir(path.join(dir, 'Images'))
    await write(path.join(dir, 'a.jpg'))
    const e = await applyOrganize(dir, await planOrganize(dir), history)
    await undoOrganize(e.id, history)
    expect(await exists(path.join(dir, 'Images'))).toBe(true)
  })

  it('apply with a vanished file counts it as skipped', async () => {
    const { dir, history } = await setup()
    await write(path.join(dir, 'a.jpg'))
    await write(path.join(dir, 'b.jpg'))
    const plan = await planOrganize(dir)
    await fs.rm(path.join(dir, 'b.jpg'))
    const e = await applyOrganize(dir, plan, history)
    expect(e.count).toBe(1)
    expect(e.skipped).toBe(1)
  })

  it('apply rejects moves outside the folder', async () => {
    const { dir, history } = await setup()
    const outside = await write(path.join(dir, '..', 'outside.txt'))
    await expect(
      applyOrganize(dir, [{ from: outside, to: path.join(dir, 'Other', 'outside.txt'), category: 'Other' }], history)
    ).rejects.toThrow('Invalid move')
    expect(await exists(outside)).toBe(true)
  })

  it('dry run apply changes nothing', async () => {
    const { dir, history } = await setup()
    await write(path.join(dir, 'a.jpg'), 'A')
    await write(path.join(dir, 'b.pdf'), 'B')
    const before = await snapshot(dir)
    const e = await applyOrganize(dir, await planOrganize(dir), history, { dryRun: true })
    expect(await snapshot(dir)).toEqual(before)
    expect(e.status).toBe('simulated')
    expect(e.dryRun).toBe(true)
    expect(e.count).toBe(2)
    expect((await history.get(e.id))!.moves).toHaveLength(2)
    await expect(undoOrganize(e.id, history)).rejects.toThrow('Dry run entry')
  })

  it('undo refuses while dry run is on', async () => {
    const { dir, history } = await setup()
    await write(path.join(dir, 'a.jpg'))
    const e = await applyOrganize(dir, await planOrganize(dir), history)
    await expect(undoOrganize(e.id, history, { dryRun: true })).rejects.toThrow('Dry run is on')
    expect(await exists(path.join(dir, 'Images', 'a.jpg'))).toBe(true)
  })

  it.runIf(process.platform === 'win32')('gap 6: files with the Windows hidden or system attribute are left alone', async () => {
    const { dir } = await setup()
    const hidden = await write(path.join(dir, '~$report.docx'))
    const system = await write(path.join(dir, 'boot.log'))
    await write(path.join(dir, 'visible.pdf'))
    const { execFileSync } = await import('child_process')
    execFileSync('attrib', ['+h', hidden])
    execFileSync('attrib', ['+s', system])
    const plan = await planOrganize(dir)
    expect(plan.map((m) => path.basename(m.from))).toEqual(['visible.pdf'])
  })

  it('planOrganize refuses an excluded folder and leaves out excluded files', async () => {
    const { dir } = await setup()
    await write(path.join(dir, 'a.pdf'))
    const secret = await write(path.join(dir, 'secret.pdf'))
    await expect(planOrganize(dir, { exclusions: [dir] })).rejects.toThrow('excluded')
    const plan = await planOrganize(dir, { exclusions: [secret] })
    expect(plan.map((m) => path.basename(m.from))).toEqual(['a.pdf'])
  })

  it('applyOrganize skips moves from excluded paths', async () => {
    const { dir, history } = await setup()
    const a = await write(path.join(dir, 'a.pdf'))
    const plan = await planOrganize(dir)
    const e = await applyOrganize(dir, plan, history, { exclusions: [a] })
    expect(e.count).toBe(0)
    expect(e.skipped).toBe(1)
    expect(await exists(a)).toBe(true)
  })

  it('date mode plans YYYY/YYYY-MM folders from mtime', async () => {
    const { dir } = await setup()
    const a = await write(path.join(dir, 'a.pdf'))
    const b = await write(path.join(dir, 'b.jpg'))
    await fs.utimes(a, new Date(2024, 2, 5), new Date(2024, 2, 5))
    await fs.utimes(b, new Date(2026, 9, 1), new Date(2026, 9, 1))
    const plan = await planOrganize(dir, { mode: 'date' })
    const by = Object.fromEntries(plan.map((m) => [path.basename(m.from), m]))
    expect(rel(dir, by['a.pdf'].to)).toBe(path.join('2024', '2024-03', 'a.pdf'))
    expect(by['a.pdf'].category).toBe('2024-03')
    expect(rel(dir, by['b.jpg'].to)).toBe(path.join('2026', '2026-10', 'b.jpg'))
  })

  it('date mode apply then undo round-trip', async () => {
    const { dir, history } = await setup()
    await fs.mkdir(path.join(dir, '2024'))
    const a = await write(path.join(dir, 'a.pdf'), 'A')
    const b = await write(path.join(dir, 'b.jpg'), 'B')
    await fs.utimes(a, new Date(2024, 2, 5), new Date(2024, 2, 5))
    await fs.utimes(b, new Date(2025, 0, 9), new Date(2025, 0, 9))
    const before = await snapshot(dir)
    const e = await applyOrganize(dir, await planOrganize(dir, { mode: 'date' }), history)
    expect(e.count).toBe(2)
    expect(await exists(path.join(dir, '2025', '2025-01', 'b.jpg'))).toBe(true)
    await undoOrganize(e.id, history)
    expect(await snapshot(dir)).toEqual(before)
  })

  it('custom categories are used for planning', async () => {
    const { dir } = await setup()
    await write(path.join(dir, 'scan.pdf'))
    await write(path.join(dir, 'pic.png'))
    const plan = await planOrganize(dir, { categories: { Paperwork: ['pdf'], Pictures: ['png'] } })
    const by = Object.fromEntries(plan.map((m) => [path.basename(m.from), m.category]))
    expect(by).toEqual({ 'scan.pdf': 'Paperwork', 'pic.png': 'Pictures' })
  })

  it('validateCategories normalises ".JPG" to "jpg" and trims names', () => {
    expect(validateCategories({ ' Photos ': ['.JPG', ' png '] })).toEqual({ Photos: ['jpg', 'png'] })
  })

  it.each([
    [{ A: ['jpg'], B: ['JPG'] }, 'in two categories'],
    [{ CON: ['x'] }, 'not a valid folder name'],
    [{ 'a/b': ['x'] }, 'not a valid folder name'],
    [{ 'trail.': ['x'] }, 'not a valid folder name'],
    [{ Other: ['x'] }, 'reserved'],
    [{ A: ['x'], a: ['y'] }, 'used twice'],
    [{ A: [''] }, 'empty extension'],
    [{}, 'at least one category'],
    ['nope', 'at least one category']
  ])('validateCategories rejects %j', (input, message) => {
    expect(() => validateCategories(input)).toThrow(message)
  })
})

describe('autoOrganize', () => {
  it('leaves shortcuts where they are', async () => {
    const { dir } = await setup()
    await write(path.join(dir, 'Chrome.lnk'))
    await write(path.join(dir, 'Site.url'))
    await write(path.join(dir, 'a.pdf'))
    const plan = await planOrganize(dir)
    expect(plan.map((m) => path.basename(m.from))).toEqual(['a.pdf'])
  })

  it('organizes every folder in one go and records one entry per folder', async () => {
    const { dir, history } = await setup()
    const desk = path.join(path.dirname(dir), 'Desktop')
    await write(path.join(dir, 'a.pdf'))
    await write(path.join(desk, 'b.png'))
    const r = await autoOrganize([desk, dir], history)
    expect(r.errors).toEqual([])
    expect(r.entries.map((e) => e.count)).toEqual([1, 1])
    expect(await exists(path.join(desk, 'Images', 'b.png'))).toBe(true)
    expect(await exists(path.join(dir, 'Documents', 'a.pdf'))).toBe(true)
  })

  it('skips folders with nothing to move, and reports a folder it cannot open', async () => {
    const { dir, history } = await setup()
    const missing = path.join(dir, 'gone')
    const r = await autoOrganize([dir, missing, 'C:\Windows'], history)
    expect(r.entries).toEqual([])
    expect(r.errors.map((e) => e.dir)).toEqual([missing, 'C:\Windows'])
    expect(await history.list()).toEqual([])
  })

  it('dry run moves nothing', async () => {
    const { dir, history } = await setup()
    await write(path.join(dir, 'a.pdf'))
    const r = await autoOrganize([dir], history, { dryRun: true })
    expect(r.entries[0].dryRun).toBe(true)
    expect(await exists(path.join(dir, 'a.pdf'))).toBe(true)
  })
})
