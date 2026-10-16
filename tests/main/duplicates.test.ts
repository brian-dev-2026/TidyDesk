import { describe, it, expect } from 'vitest'
import fs from 'fs/promises'
import path from 'path'
import { findDuplicates, pickDuplicateRemovals } from '../../src/main/duplicates'
import { tmpDir, write } from '../helpers/tmp'

const big = (fill: number, size = 4096) => Buffer.alloc(size, fill)

describe('findDuplicates', () => {
  it('finds identical content with different names across subfolders', async () => {
    const d = await tmpDir()
    const a = await write(path.join(d, 'a.bin'), big(1))
    const b = await write(path.join(d, 'sub', 'copy of a.bin'), big(1))
    const c = await write(path.join(d, 'sub', 'deeper', 'x.dat'), big(1))
    await write(path.join(d, 'other.bin'), big(2))
    const groups = await findDuplicates(d, { minSize: 1024 })
    expect(groups).toHaveLength(1)
    expect(groups[0].size).toBe(4096)
    expect(groups[0].hash).toMatch(/^[0-9a-f]{64}$/)
    expect(groups[0].files.map((f) => f.path).sort()).toEqual([a, b, c].sort())
  })

  it('same size different content is not a duplicate', async () => {
    const d = await tmpDir()
    await write(path.join(d, 'a'), big(1))
    await write(path.join(d, 'b'), big(2))
    expect(await findDuplicates(d, { minSize: 1 })).toEqual([])
  })

  it('same first 64KB but different tail is not a duplicate', async () => {
    const d = await tmpDir()
    const x = Buffer.alloc(100 * 1024, 7)
    const y = Buffer.from(x)
    y[y.length - 1] = 8
    await write(path.join(d, 'x'), x)
    await write(path.join(d, 'y'), y)
    expect(await findDuplicates(d, { minSize: 1 })).toEqual([])
  })

  it('respects minSize', async () => {
    const d = await tmpDir()
    await write(path.join(d, 'a'), 'tiny')
    await write(path.join(d, 'b'), 'tiny')
    expect(await findDuplicates(d, { minSize: 1024 })).toEqual([])
    expect(await findDuplicates(d, { minSize: 1 })).toHaveLength(1)
  })

  it('empty folder returns []', async () => {
    expect(await findDuplicates(await tmpDir(), { minSize: 1 })).toEqual([])
  })

  it('sorts files oldest first and groups by reclaimable size', async () => {
    const d = await tmpDir()
    const newer = await write(path.join(d, 'newer'), big(1))
    const older = await write(path.join(d, 'older'), big(1))
    await fs.utimes(older, new Date(2020, 0, 1), new Date(2020, 0, 1))
    await write(path.join(d, 'big1'), big(3, 50000))
    await write(path.join(d, 'big2'), big(3, 50000))
    const groups = await findDuplicates(d, { minSize: 1 })
    expect(groups[0].size).toBe(50000)
    expect(groups[1].files.map((f) => f.path)).toEqual([older, newer])
  })

  it('does not follow junctions', async () => {
    const d = await tmpDir()
    const a = path.join(d, 'a')
    await write(path.join(a, 'one.bin'), big(5))
    await fs.symlink(a, path.join(d, 'link'), 'junction')
    expect(await findDuplicates(d, { minSize: 1 })).toEqual([])
  })

  it('skips .tidydesk-bin', async () => {
    const d = await tmpDir()
    await write(path.join(d, 'a.bin'), big(1))
    await write(path.join(d, '.tidydesk-bin', 'b1', '0_a.bin'), big(1))
    expect(await findDuplicates(d, { minSize: 1 })).toEqual([])
  })

  it('refuses protected folder', async () => {
    await expect(findDuplicates('C:\\Program Files', { minSize: 1 })).rejects.toThrow('Protected folder')
  })

  it('abort throws Cancelled', async () => {
    const d = await tmpDir()
    await write(path.join(d, 'a'), big(1))
    await write(path.join(d, 'b'), big(1))
    const ac = new AbortController()
    ac.abort()
    await expect(findDuplicates(d, { minSize: 1, signal: ac.signal })).rejects.toThrow('Cancelled')
  })

  it('reports progress phases', async () => {
    const d = await tmpDir()
    await write(path.join(d, 'a'), big(1))
    await write(path.join(d, 'b'), big(1))
    const phases = new Set<string>()
    await findDuplicates(d, { minSize: 1, onProgress: (p) => phases.add(p.phase) })
    expect([...phases]).toEqual(['listing', 'hashing'])
  })
})

describe('findDuplicates across several folders', () => {
  it('findDuplicates does not enter excluded folders', async () => {
    const d = await tmpDir()
    await write(path.join(d, 'a.bin'), big(1))
    await write(path.join(d, 'private', 'a-copy.bin'), big(1))
    expect(await findDuplicates(d, { minSize: 1, exclusions: [path.join(d, 'private')] })).toEqual([])
  })

  it('scans several folders and finds copies across them', async () => {
    const d = await tmpDir()
    const a = await write(path.join(d, 'Desktop', 'photo.jpg'), big(7))
    const b = await write(path.join(d, 'Downloads', 'photo (1).jpg'), big(7))
    const groups = await findDuplicates([path.join(d, 'Desktop'), path.join(d, 'Downloads')], { minSize: 1 })
    expect(groups).toHaveLength(1)
    expect(groups[0].files.map((f) => f.path).sort()).toEqual([a, b].sort())
  })

  it('never reports a file as a copy of itself when folders overlap', async () => {
    const d = await tmpDir()
    await write(path.join(d, 'Documents', 'Desktop', 'only.bin'), big(3))
    const docs = path.join(d, 'Documents')
    expect(await findDuplicates([docs, path.join(docs, 'Desktop'), docs.toUpperCase()], { minSize: 1 })).toEqual([])
  })

  it('skips folders that do not exist', async () => {
    const d = await tmpDir()
    await write(path.join(d, 'a', 'x'), big(1))
    await write(path.join(d, 'a', 'y'), big(1))
    expect(await findDuplicates([path.join(d, 'missing'), path.join(d, 'a')], { minSize: 1 })).toHaveLength(1)
  })

  it('leaves developer and hidden folders alone', async () => {
    const d = await tmpDir()
    await write(path.join(d, 'app', 'node_modules', 'pkg', 'LICENSE'), big(4))
    await write(path.join(d, 'other', 'node_modules', 'pkg', 'LICENSE'), big(4))
    await write(path.join(d, 'repo', '.git', 'objects', 'aa'), big(5))
    await write(path.join(d, 'repo2', '.git', 'objects', 'aa'), big(5))
    await write(path.join(d, 'py', '__pycache__', 'm.pyc'), big(6))
    await write(path.join(d, 'py2', '__pycache__', 'm.pyc'), big(6))
    expect(await findDuplicates(d, { minSize: 1 })).toEqual([])
  })
})

describe('pickDuplicateRemovals', () => {
  const f = (p: string, mtimeMs: number) => ({ path: p, size: 10, mtimeMs })

  it('keeps the oldest copy of each group and removes the rest', () => {
    const groups = [
      { hash: 'a', size: 10, files: [f('C:\\new.jpg', 300), f('C:\\old.jpg', 100), f('C:\\mid.jpg', 200)] },
      { hash: 'b', size: 10, files: [f('C:\\x.pdf', 5), f('C:\\y.pdf', 9)] }
    ]
    expect(pickDuplicateRemovals(groups).sort()).toEqual(['C:\\mid.jpg', 'C:\\new.jpg', 'C:\\y.pdf'])
  })

  it('breaks a tie on age by keeping the shorter path', () => {
    const groups = [{ hash: 'a', size: 10, files: [f('C:\\Downloads\\copy of a.jpg', 1), f('C:\\a.jpg', 1)] }]
    expect(pickDuplicateRemovals(groups)).toEqual(['C:\\Downloads\\copy of a.jpg'])
  })

  it('returns nothing for no groups', () => {
    expect(pickDuplicateRemovals([])).toEqual([])
  })
})
