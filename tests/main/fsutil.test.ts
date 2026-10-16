import { describe, it, expect } from 'vitest'
import fs from 'fs/promises'
import path from 'path'
import { moveFile, uniquePath, walkFiles } from '../../src/main/fsutil'
import { tmpDir, write, exists } from '../helpers/tmp'

async function collect(dir: string): Promise<string[]> {
  const out: string[] = []
  for await (const f of walkFiles(dir)) out.push(path.relative(dir, f.path))
  return out.sort()
}

describe('fsutil', () => {
  it('moveFile moves and creates parent', async () => {
    const d = await tmpDir()
    const a = await write(path.join(d, 'a.txt'), 'hello')
    const to = path.join(d, 'x', 'y', 'a.txt')
    await moveFile(a, to)
    expect(await exists(a)).toBe(false)
    expect(await fs.readFile(to, 'utf8')).toBe('hello')
  })

  it('moveFile refuses to overwrite', async () => {
    const d = await tmpDir()
    const a = await write(path.join(d, 'a.txt'), 'A')
    const b = await write(path.join(d, 'b.txt'), 'B')
    await expect(moveFile(a, b)).rejects.toMatchObject({ code: 'EEXIST' })
    expect(await fs.readFile(b, 'utf8')).toBe('B')
    expect(await exists(a)).toBe(true)
  })

  it('uniquePath appends (1) then (2)', async () => {
    const d = await tmpDir()
    const p = path.join(d, 'f.txt')
    expect(await uniquePath(p)).toBe(p)
    await write(p)
    expect(await uniquePath(p)).toBe(path.join(d, 'f (1).txt'))
    await write(path.join(d, 'f (1).txt'))
    expect(await uniquePath(p)).toBe(path.join(d, 'f (2).txt'))
  })

  it('uniquePath honours a custom suffix', async () => {
    const d = await tmpDir()
    const p = await write(path.join(d, 'f.txt'))
    expect(await uniquePath(p, ' (restored)')).toBe(path.join(d, 'f (restored).txt'))
  })

  it('walkFiles yields size and mtime', async () => {
    const d = await tmpDir()
    await write(path.join(d, 'sub', 'a.txt'), '12345')
    const files = []
    for await (const f of walkFiles(d)) files.push(f)
    expect(files).toHaveLength(1)
    expect(files[0].size).toBe(5)
    expect(files[0].mtimeMs).toBeGreaterThan(0)
  })

  it('walkFiles does not follow junctions', async () => {
    const d = await tmpDir()
    const a = path.join(d, 'a')
    await write(path.join(a, 'f1.txt'))
    await write(path.join(a, 'deep', 'f2.txt'))
    await fs.symlink(a, path.join(a, 'loop'), 'junction')
    expect(await collect(d)).toEqual([path.join('a', 'deep', 'f2.txt'), path.join('a', 'f1.txt')])
  })

  it('walkFiles skips .tidydesk-bin', async () => {
    const d = await tmpDir()
    await write(path.join(d, 'keep.txt'))
    await write(path.join(d, '.tidydesk-bin', 'b1', 'x.txt'))
    expect(await collect(d)).toEqual(['keep.txt'])
  })

  it('walkFiles skipHidden skips dot files and dirs', async () => {
    const d = await tmpDir()
    await write(path.join(d, 'keep.txt'))
    await write(path.join(d, '.hidden'))
    await write(path.join(d, '.git', 'x'))
    const out: string[] = []
    for await (const f of walkFiles(d, { skipHidden: true })) out.push(path.basename(f.path))
    expect(out).toEqual(['keep.txt'])
  })

  it('walkFiles on missing dir yields nothing', async () => {
    const d = await tmpDir()
    expect(await collect(path.join(d, 'nope'))).toEqual([])
  })
})
