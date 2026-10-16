import { describe, it, expect } from 'vitest'
import fs from 'fs/promises'
import path from 'path'
import { execFileSync } from 'child_process'
import { findEmptyFolders, removeEmptyFolders, restoreEmptyFolders } from '../../src/main/emptyfolders'
import { HistoryStore } from '../../src/main/history'
import { tmpDir, write, exists } from '../helpers/tmp'

async function setup() {
  const root = await tmpDir()
  const dir = path.join(root, 'Stuff')
  await fs.mkdir(dir)
  return { dir, history: new HistoryStore(path.join(root, 'data')) }
}

const rel = (dir: string, list: string[]) => list.map((p) => path.relative(dir, p))

describe('empty folders', () => {
  it('finds nested empty folders deepest first and never the root', async () => {
    const { dir } = await setup()
    await fs.mkdir(path.join(dir, 'a', 'b', 'c'), { recursive: true })
    await fs.mkdir(path.join(dir, 'z'))
    const found = await findEmptyFolders(dir)
    expect(rel(dir, found)).toEqual([path.join('a', 'b', 'c'), path.join('a', 'b'), 'a', 'z'])
  })

  it('a folder with a file anywhere below is not empty', async () => {
    const { dir } = await setup()
    await write(path.join(dir, 'a', 'b', 'file.txt'))
    await fs.mkdir(path.join(dir, 'a', 'empty'))
    expect(rel(dir, await findEmptyFolders(dir))).toEqual([path.join('a', 'empty')])
  })

  it('skips .git, .tidydesk-bin and excluded folders', async () => {
    const { dir } = await setup()
    await fs.mkdir(path.join(dir, '.git', 'refs'), { recursive: true })
    await fs.mkdir(path.join(dir, '.tidydesk-bin', 'b1'), { recursive: true })
    await fs.mkdir(path.join(dir, 'keep', 'inner'), { recursive: true })
    await fs.mkdir(path.join(dir, 'gone'))
    const found = await findEmptyFolders(dir, { exclusions: [path.join(dir, 'keep')] })
    expect(rel(dir, found)).toEqual(['gone'])
  })

  it.runIf(process.platform === 'win32')('skips hidden folders', async () => {
    const { dir } = await setup()
    await fs.mkdir(path.join(dir, 'secret'))
    await fs.mkdir(path.join(dir, 'plain'))
    execFileSync('attrib', ['+h', path.join(dir, 'secret')])
    expect(rel(dir, await findEmptyFolders(dir))).toEqual(['plain'])
  })

  it('removes the folders and records history', async () => {
    const { dir, history } = await setup()
    await fs.mkdir(path.join(dir, 'a', 'b'), { recursive: true })
    const found = await findEmptyFolders(dir)
    const e = await removeEmptyFolders(found, history)
    expect(e).toMatchObject({ type: 'empty-folders', status: 'done', count: 2, skipped: 0, title: 'Removed 2 empty folders' })
    expect(await exists(path.join(dir, 'a'))).toBe(false)
    expect((await history.get(e.id))!.folders).toHaveLength(2)
  })

  it('does not remove a folder that is no longer empty', async () => {
    const { dir, history } = await setup()
    await fs.mkdir(path.join(dir, 'a'))
    const found = await findEmptyFolders(dir)
    await write(path.join(dir, 'a', 'new.txt'), 'arrived after the scan')
    const e = await removeEmptyFolders(found, history)
    expect(e.count).toBe(0)
    expect(e.skipped).toBe(1)
    expect(await exists(path.join(dir, 'a', 'new.txt'))).toBe(true)
  })

  it('dry run removes nothing', async () => {
    const { dir, history } = await setup()
    await fs.mkdir(path.join(dir, 'a'))
    const e = await removeEmptyFolders(await findEmptyFolders(dir), history, { dryRun: true })
    expect(e.status).toBe('simulated')
    expect(await exists(path.join(dir, 'a'))).toBe(true)
  })

  it('restore recreates the folders', async () => {
    const { dir, history } = await setup()
    await fs.mkdir(path.join(dir, 'a', 'b'), { recursive: true })
    const e = await removeEmptyFolders(await findEmptyFolders(dir), history)
    const r = await restoreEmptyFolders(e.id, history)
    expect(r.status).toBe('restored')
    expect(await exists(path.join(dir, 'a', 'b'))).toBe(true)
    await expect(restoreEmptyFolders(e.id, history, { dryRun: true })).rejects.toThrow('Dry run is on')
  })

  it('refuses a protected folder', async () => {
    await expect(findEmptyFolders('C:\\Windows')).rejects.toThrow('Protected folder')
  })
})
