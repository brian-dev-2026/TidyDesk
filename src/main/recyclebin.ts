import { execFile } from 'child_process'
import type { RecycleInfo } from '@shared/types'

// Walks every item in the Windows Recycle Bin (all drives) via Shell.Application.
// With 'sweep', items deleted more than `hours` ago are removed permanently ($R payload + $I metadata).
// The deletion time is read from the $I file (a UTC FILETIME at offset 16) and compared in UTC:
// Shell's System.Recycle.DateDeleted is UTC but unlabelled, so comparing it to local time is wrong.
function script(mode: 'info' | 'sweep' | 'dry-sweep', hours = 0): string {
  return `
$ErrorActionPreference = 'Stop'
$cutoff = [DateTime]::UtcNow.AddHours(-${Number(hours)})
$mode = '${mode}'
$n = 0; $b = [int64]0
$rb = (New-Object -ComObject Shell.Application).Namespace(10)
foreach ($i in @($rb.Items())) {
  try {
    $s = [int64]$i.ExtendedProperty('Size')
    if ($mode -eq 'info') { $n++; $b += $s; continue }
    $p = $i.Path
    $leaf = Split-Path $p -Leaf
    if (-not $leaf.StartsWith('$R')) { continue }
    $info = Join-Path (Split-Path $p) ('$I' + $leaf.Substring(2))
    $bytes = [System.IO.File]::ReadAllBytes($info)
    if ($bytes.Length -lt 24) { continue }
    $deleted = [DateTime]::FromFileTimeUtc([BitConverter]::ToInt64($bytes, 16))
    if ($deleted -ge $cutoff) { continue }
    if ($mode -eq 'sweep') {
      Remove-Item -LiteralPath $p -Recurse -Force
      Remove-Item -LiteralPath $info -Force -ErrorAction SilentlyContinue
    }
    $n++; $b += $s
  } catch {}
}
@{ count = $n; bytes = $b } | ConvertTo-Json -Compress
`
}

function runPs(command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
      { windowsHide: true, timeout: 120000, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve(stdout))
    )
  })
}

function parse(out: string): RecycleInfo {
  const line = out.trim().split(/\r?\n/).pop() ?? '{}'
  const r = JSON.parse(line)
  return { count: Number(r.count) || 0, bytes: Number(r.bytes) || 0 }
}

export async function recycleBinInfo(): Promise<RecycleInfo> {
  return parse(await runPs(script('info')))
}

/** Permanently deletes Recycle Bin items deleted more than `hours` ago. dryRun only counts them. */
export async function sweepRecycleBin(hours: number, dryRun = false): Promise<RecycleInfo> {
  return parse(await runPs(script(dryRun ? 'dry-sweep' : 'sweep', hours)))
}

/** Empties the whole Recycle Bin. dryRun only reports what is there. */
export async function emptyRecycleBin(dryRun = false): Promise<RecycleInfo> {
  const info = await recycleBinInfo()
  if (!dryRun && info.count > 0) {
    await runPs('Clear-RecycleBin -Force -ErrorAction SilentlyContinue')
  }
  return info
}
