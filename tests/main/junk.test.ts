import { describe, it, expect } from 'vitest'
import fs from 'fs/promises'
import path from 'path'
import { junkCategories, scanJunk } from '../../src/main/junk'
import { listDrives } from '../../src/main/disk'
import { tmpDir, write } from '../helpers/tmp'

const NOW = Date.now()
const OLD = new Date(NOW - 2 * 3600000)

async function old(file: string, content = 'xx'): Promise<string> {
  await write(file, content)
  await fs.utimes(file, OLD, OLD)
  return file
}

async function fakeEnv() {
  const root = await tmpDir()
  const env = {
    TEMP: path.join(root, 'Temp'),
    LOCALAPPDATA: path.join(root, 'Local'),
    APPDATA: path.join(root, 'Roaming'),
    SystemRoot: path.join(root, 'Windows')
  }
  return { root, env }
}

const byId = (cats: { id: string }[], id: string) => cats.find((c) => c.id === id) as any

describe('junk', () => {
  it('defines the five categories', async () => {
    const { env } = await fakeEnv()
    expect(junkCategories(env).map((d) => d.id)).toEqual([
      'user-temp',
      'windows-temp',
      'browser-cache',
      'thumbnails',
      'crash-dumps'
    ])
  })

  it('scans sizes per category', async () => {
    const { env } = await fakeEnv()
    await old(path.join(env.TEMP, 'a.tmp'), '1234')
    await old(path.join(env.TEMP, 'sub', 'b.tmp'), '12')
    await old(path.join(env.SystemRoot, 'Temp', 'w.tmp'), '123')
    await old(path.join(env.LOCALAPPDATA, 'Google', 'Chrome', 'User Data', 'Default', 'Cache', 'c1'), '12345')
    await old(path.join(env.LOCALAPPDATA, 'Microsoft', 'Edge', 'User Data', 'Profile 1', 'GPUCache', 'g'), '1')
    await old(path.join(env.LOCALAPPDATA, 'Mozilla', 'Firefox', 'Profiles', 'abc.default', 'cache2', 'f'), '12')
    await old(path.join(env.LOCALAPPDATA, 'CrashDumps', 'app.dmp'), '1234567')
    const { categories, files } = await scanJunk(junkCategories(env), { now: NOW, running: new Set() })
    expect(byId(categories, 'user-temp')).toMatchObject({ bytes: 6, fileCount: 2 })
    expect(byId(categories, 'windows-temp')).toMatchObject({ bytes: 3, fileCount: 1 })
    expect(byId(categories, 'browser-cache')).toMatchObject({ bytes: 8, fileCount: 3 })
    expect(byId(categories, 'crash-dumps')).toMatchObject({ bytes: 7, fileCount: 1 })
    expect(files['user-temp']).toHaveLength(2)
  })

  it('excludes files modified within 1 hour', async () => {
    const { env } = await fakeEnv()
    await old(path.join(env.TEMP, 'old.tmp'))
    await write(path.join(env.TEMP, 'fresh.tmp'))
    const { categories, files } = await scanJunk(junkCategories(env), { now: NOW, running: new Set() })
    expect(byId(categories, 'user-temp').fileCount).toBe(1)
    expect(files['user-temp'].map((f) => path.basename(f))).toEqual(['old.tmp'])
  })

  it('thumbnail filter only matches thumbcache_*.db', async () => {
    const { env } = await fakeEnv()
    const explorer = path.join(env.LOCALAPPDATA, 'Microsoft', 'Windows', 'Explorer')
    await old(path.join(explorer, 'thumbcache_256.db'), '123')
    await old(path.join(explorer, 'iconcache_16.db'), '12345')
    await old(path.join(explorer, 'ThumbCache_idx.DB'), '1')
    const { categories } = await scanJunk(junkCategories(env), { now: NOW, running: new Set() })
    expect(byId(categories, 'thumbnails')).toMatchObject({ bytes: 4, fileCount: 2 })
  })

  it('skips cache of running browser and sets note', async () => {
    const { env } = await fakeEnv()
    await old(path.join(env.LOCALAPPDATA, 'Google', 'Chrome', 'User Data', 'Default', 'Cache', 'c1'), '12345')
    await old(path.join(env.LOCALAPPDATA, 'Microsoft', 'Edge', 'User Data', 'Default', 'Cache', 'e1'), '1')
    const { categories } = await scanJunk(junkCategories(env), { now: NOW, running: new Set(['chrome.exe']) })
    const cat = byId(categories, 'browser-cache')
    expect(cat.bytes).toBe(1)
    expect(cat.note).toBe('Close Chrome to clean its cache')
  })

  it('missing roots give 0 bytes, no throw', async () => {
    const { env } = await fakeEnv()
    const { categories } = await scanJunk(junkCategories(env), { now: NOW, running: new Set() })
    expect(categories.every((c) => c.bytes === 0 && c.fileCount === 0)).toBe(true)
  })

  it('listDrives includes the system drive', async () => {
    const drives = await listDrives()
    const c = drives.find((d) => d.root.toUpperCase() === 'C:\\')
    expect(c).toBeDefined()
    expect(c!.total).toBeGreaterThan(c!.free)
  })
})
