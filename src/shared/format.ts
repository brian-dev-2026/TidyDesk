const UNITS = ['B', 'KB', 'MB', 'GB', 'TB']

export function formatBytes(n: number): string {
  if (n < 1024) return `${Math.max(0, Math.round(n))} B`
  let i = 0
  let v = n
  while (v >= 1024 && i < UNITS.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(1)} ${UNITS[i]}`
}

export function formatDuration(ms: number): string {
  const totalMin = Math.floor(ms / 60000)
  if (totalMin < 1) return '<1m'
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}
