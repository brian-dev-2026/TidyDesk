import { describe, it, expect } from 'vitest'
import path from 'path'
import { findLargeFiles } from '../../src/main/largefiles'
import { tmpDir, write } from '../helpers/tmp'

const sized = (n: number) => Buffer.alloc(n, 1)

describe('findLargeFiles', () => {
  it('returns the N largest above minSize, largest first', async () => {
    const d = await tmpDir()
    await write(path.join(d, 'small.bin'), sized(10))
    await write(path.join(d, 'a', 'b.bin'), sized(5000))
    await write(path.join(d, 'c.bin'), sized(9000))
    await write(path.join(d, 'a', 'deep', 'd.bin'), sized(7000))
    await write(path.join(d, 'e.bin'), sized(3000))
    const r = await findLargeFiles(d, { minSize: 100, limit: 3 })
    expect(r.map((f) => [path.basename(f.path), f.size])).toEqual([
      ['c.bin', 9000],
      ['d.bin', 7000],
      ['b.bin', 5000]
    ])
  })

  it('respects exclusions', async () => {
    const d = await tmpDir()
    await write(path.join(d, 'keep', 'huge.bin'), sized(9000))
    await write(path.join(d, 'x.bin'), sized(2000))
    const r = await findLargeFiles(d, { minSize: 1, limit: 10, exclusions: [path.join(d, 'keep')] })
    expect(r.map((f) => path.basename(f.path))).toEqual(['x.bin'])
  })

  it('skips protected folders when scanning a drive root', async () => {
    const d = await tmpDir()
    await write(path.join(d, 'Windows', 'big.sys'), sized(9000))
    await write(path.join(d, 'Users', 'me', 'movie.mp4'), sized(8000))
    const r = await findLargeFiles(d, {
      minSize: 1,
      limit: 10,
      isProtected: (p) => p.toLowerCase() === path.join(d, 'Windows').toLowerCase()
    })
    expect(r.map((f) => path.basename(f.path))).toEqual(['movie.mp4'])
  })

  it('refuses a protected folder that is not a drive root', async () => {
    await expect(findLargeFiles('C:\\Windows\\System32', { minSize: 1, limit: 1 })).rejects.toThrow('Protected folder')
  })

  it('abort throws Cancelled', async () => {
    const d = await tmpDir()
    await write(path.join(d, 'a.bin'), sized(10))
    const ac = new AbortController()
    ac.abort()
    await expect(findLargeFiles(d, { minSize: 1, limit: 1, signal: ac.signal })).rejects.toThrow('Cancelled')
  })
})
