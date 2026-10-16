import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterEach } from 'vitest'

const dirs: string[] = []

export async function tmpDir(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'tidy-test-'))
  dirs.push(d)
  return d
}

export async function write(file: string, content: string | Buffer = 'x'): Promise<string> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, content)
  return file
}

export async function exists(p: string): Promise<boolean> {
  return fs.access(p).then(
    () => true,
    () => false
  )
}

/** Relative path -> content for every file under dir (directories listed with a trailing '/'). */
export async function snapshot(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  async function walk(d: string): Promise<void> {
    for (const e of await fs.readdir(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      const rel = path.relative(dir, p)
      if (e.isDirectory()) {
        out[rel + '/'] = ''
        await walk(p)
      } else out[rel] = await fs.readFile(p, 'utf8')
    }
  }
  await walk(dir)
  return out
}

afterEach(async () => {
  while (dirs.length) await fs.rm(dirs.pop()!, { recursive: true, force: true }).catch(() => {})
})

/** A new temp folder addressed by its 8.3 short name (as on CI runners), e.g. C:\Users\RUNNER~1\... */
export async function shortTmpDir(): Promise<string> {
  const d = await tmpDir()
  const long = path.join(d, 'A Long Folder Name For Short Paths')
  await fs.mkdir(long)
  const { execSync } = await import('child_process')
  return execSync(`for %I in ("${long}") do @echo %~sI`, { encoding: 'utf8', shell: 'cmd.exe' }).trim()
}
