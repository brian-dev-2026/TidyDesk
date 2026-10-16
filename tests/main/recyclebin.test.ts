import { describe, it, expect, afterAll } from 'vitest'
import { execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { sweepRecycleBin } from '../../src/main/recyclebin'

// Integration test against the real Windows Recycle Bin. Only dry-run sweeps are used, and the
// probe file this test recycles is removed again afterwards; nothing else in the bin is touched.
const probeName = `tidydesk-probe-${process.pid}-${Date.now()}.txt`

function ps(command: string): string {
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8' })
}

function recycleProbe(): void {
  const f = path.join(os.tmpdir(), probeName)
  fs.writeFileSync(f, 'probe')
  ps(
    `Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile('${f}','OnlyErrorDialogs','SendToRecycleBin')`
  )
}

function removeProbe(): void {
  ps(`foreach ($i in @((New-Object -ComObject Shell.Application).Namespace(10).Items())) {
    if ($i.Name -eq '${probeName}') {
      $p = $i.Path; $leaf = Split-Path $p -Leaf
      Remove-Item -LiteralPath $p -Force -ErrorAction SilentlyContinue
      Remove-Item -LiteralPath (Join-Path (Split-Path $p) ('$I' + $leaf.Substring(2))) -Force -ErrorAction SilentlyContinue
    } }`)
}

describe.runIf(process.platform === 'win32')('recycle bin sweep (integration)', () => {
  afterAll(() => removeProbe())

  it('a just-recycled item is not older than the hold time', async () => {
    const before5 = await sweepRecycleBin(5, true)
    const before0 = await sweepRecycleBin(0, true)
    recycleProbe()
    const after5 = await sweepRecycleBin(5, true)
    const after0 = await sweepRecycleBin(0.0001, true)
    expect(after5.count - before5.count).toBe(0)
    expect(after0.count - before0.count).toBe(1)
  }, 60000)
})
