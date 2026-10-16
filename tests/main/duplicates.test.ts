import { describe, it, expect } from 'vitest'
import fs from 'fs/promises'
import path from 'path'
import { findDuplicates, validateDupRemoval } from '../../src/main/duplicates'
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

describe('validateDupRemoval', () => {
  const w = (...p: string[]) => path.win32.join('C:/', ...p)
  const f = (p: string) => ({ path: p, size: 10, mtimeMs: 1 })
  const groups = [
    { hash: 'h1', size: 10, files: [f(w('a', '1.jpg')), f(w('a', '2.jpg')), f(w('a', '3.jpg'))] },
    { hash: 'h2', size: 10, files: [f(w('b', 'x.pdf')), f(w('b', 'y.pdf'))] }
  ]

  it('accepts removing all but one per group', () => {
    expect(() => validateDupRemoval(groups, [w('a', '2.jpg'), w('A', '3.JPG'), w('b', 'y.pdf')])).not.toThrow()
  })

  it('rejects a path that was not in the scan', () => {
    expect(() => validateDupRemoval(groups, [w('Users', 'me', 'thesis.docx')])).toThrow('not part of the last duplicate scan')
  })

  it('rejects removing every copy of a group', () => {
    expect(() => validateDupRemoval(groups, [w('b', 'x.pdf'), w('b', 'y.pdf')])).toThrow('at least one copy')
  })

  it('rejects when there is no scan', () => {
    expect(() => validateDupRemoval(null, [w('a', '2.jpg')])).toThrow('not part of the last duplicate scan')
  })

  it('findDuplicates does not enter excluded folders', async () => {
    const d = await tmpDir()
    await write(path.join(d, 'a.bin'), big(1))
    await write(path.join(d, 'private', 'a-copy.bin'), big(1))
    expect(await findDuplicates(d, { minSize: 1, exclusions: [path.join(d, 'private')] })).toEqual([])
  })
})
