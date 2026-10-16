import { describe, it, expect } from 'vitest'
import fs from 'fs/promises'
import path from 'path'
import { findDuplicates, planDuplicateRemovals, recheckRemovals, usableRoots, USER_CONTENT_EXTENSIONS } from '../../src/main/duplicates'
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

describe('automatic duplicate safety', () => {
  it('only compares user files when given the user-content extensions', async () => {
    const d = await tmpDir()
    await write(path.join(d, 'a', 'pip.exe'), big(1))
    await write(path.join(d, 'b', 'pip3.exe'), big(1))
    await write(path.join(d, 'a', 'lib.dll'), big(2))
    await write(path.join(d, 'b', 'lib.dll'), big(2))
    await write(path.join(d, 'a', 'Trip.PDF'), big(3))
    await write(path.join(d, 'b', 'Trip (1).pdf'), big(3))
    const groups = await findDuplicates(d, { minSize: 1, extensions: USER_CONTENT_EXTENSIONS })
    expect(groups.map((g) => g.files.map((f) => path.basename(f.path)).sort())).toEqual([['Trip (1).pdf', 'Trip.PDF']])
  })

  it.each([
    ['a .git folder', '.git', 'HEAD'],
    ['a Python venv', 'pyvenv.cfg', null],
    ['a package.json', 'package.json', null],
    ['a Visual Studio project', 'App.csproj', null],
    ['a Cargo.toml', 'Cargo.toml', null]
  ])('skips a project folder marked by %s', async (_label, marker, inner) => {
    const d = await tmpDir()
    for (const p of ['p1', 'p2']) {
      await write(inner ? path.join(d, p, marker, inner) : path.join(d, p, marker), '{}')
      await write(path.join(d, p, 'assets', 'logo.png'), big(8))
    }
    expect(await findDuplicates(d, { minSize: 1 })).toEqual([])
  })

  it.each(['bin', 'obj', 'venv', 'AppData', 'My Games', 'WindowsPowerShell', 'GitHub'])('skips folders named %s', async (name) => {
    const d = await tmpDir()
    await write(path.join(d, name, 'one', 'x.png'), big(8))
    await write(path.join(d, name, 'two', 'x.png'), big(8))
    expect(await findDuplicates(d, { minSize: 1 })).toEqual([])
  })

  it('never treats empty files as duplicates, even with a minimum size of 0', async () => {
    const d = await tmpDir()
    await write(path.join(d, 'a', '__init__.py'), '')
    await write(path.join(d, 'b', '__init__.py'), '')
    expect(await findDuplicates(d, { minSize: 0 })).toEqual([])
  })

  it('the same folder reached through a junction is not a copy of itself', async () => {
    const d = await tmpDir()
    const real = path.join(d, 'Photos')
    await write(path.join(real, 'only.jpg'), big(9))
    const alias = path.join(d, 'Alias')
    await fs.symlink(real, alias, 'junction')
    expect(await findDuplicates([alias, real], { minSize: 1 })).toEqual([])
  })

  it('two hard links to one file are not duplicates', async () => {
    const d = await tmpDir()
    const a = await write(path.join(d, 'a', 'one.jpg'), big(9))
    await fs.mkdir(path.join(d, 'b'))
    await fs.link(a, path.join(d, 'b', 'one.jpg'))
    expect(await findDuplicates(d, { minSize: 1 })).toEqual([])
  })

  it('usableRoots skips excluded, protected and missing folders and says why', async () => {
    const d = await tmpDir()
    const ok = path.join(d, 'ok')
    const ex = path.join(d, 'excluded')
    await fs.mkdir(ok)
    await fs.mkdir(ex)
    const r = await usableRoots([ok, ex, path.join(d, 'gone'), 'C:\\Windows'], [ex])
    expect(r.roots).toEqual([ok])
    expect(r.skipped.map((s) => path.basename(s.dir))).toEqual(['excluded', 'gone', 'Windows'])
  })
})

describe('planDuplicateRemovals', () => {
  const f = (p: string, mtimeMs: number) => ({ path: p, size: 10, mtimeMs })
  const removed = (plans: { remove: { path: string }[] }[]) => plans.flatMap((p) => p.remove.map((r) => r.path)).sort()

  it('keeps the oldest copy of each group and removes the rest', () => {
    const groups = [
      { hash: 'a', size: 10, files: [f('C:\\new.jpg', 300), f('C:\\old.jpg', 100), f('C:\\mid.jpg', 200)] },
      { hash: 'b', size: 10, files: [f('C:\\x.pdf', 5), f('C:\\y.pdf', 9)] }
    ]
    expect(removed(planDuplicateRemovals(groups))).toEqual(['C:\\mid.jpg', 'C:\\new.jpg', 'C:\\y.pdf'])
  })

  it('on equal age keeps the copy in the better-ranked folder, then the shorter path', () => {
    const rank = (p: string) => (p.startsWith('C:\\Pictures') ? 0 : p.startsWith('C:\\Downloads') ? 2 : 1)
    const groups = [{ hash: 'a', size: 10, files: [f('C:\\Downloads\\a.jpg', 1), f('C:\\Pictures\\Trip 2024\\a.jpg', 1)] }]
    expect(removed(planDuplicateRemovals(groups, rank))).toEqual(['C:\\Downloads\\a.jpg'])
    const tie = [{ hash: 'a', size: 10, files: [f('C:\\x\\copy of a.jpg', 1), f('C:\\x\\a.jpg', 1)] }]
    expect(removed(planDuplicateRemovals(tie))).toEqual(['C:\\x\\copy of a.jpg'])
  })

  it('returns nothing for no groups', () => {
    expect(planDuplicateRemovals([])).toEqual([])
  })
})

describe('recheckRemovals', () => {
  async function scanned() {
    const d = await tmpDir()
    const old = await write(path.join(d, 'a', 'photo.jpg'), big(7))
    const t = new Date(Date.now() - 86400000)
    await fs.utimes(old, t, t)
    const copy = await write(path.join(d, 'b', 'photo (1).jpg'), big(7))
    const plans = planDuplicateRemovals(await findDuplicates(d, { minSize: 1 }))
    return { old, copy, plans }
  }

  it('keeps the plan when nothing changed', async () => {
    const { copy, plans } = await scanned()
    expect(await recheckRemovals(plans)).toEqual([copy])
  })

  it('drops a copy that was edited after the scan', async () => {
    const { copy, plans } = await scanned()
    await fs.writeFile(copy, big(8))
    expect(await recheckRemovals(plans)).toEqual([])
  })

  it('drops the whole group when the kept copy is gone or changed', async () => {
    const { old, plans } = await scanned()
    await fs.rm(old)
    expect(await recheckRemovals(plans)).toEqual([])
  })
})
