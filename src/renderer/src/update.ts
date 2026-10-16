import { useEffect, useState } from 'react'
import type { UpdateStatus } from '@shared/types'
import { call, tidy } from './api'

/** Live auto-update status from the main process. */
export function useUpdateStatus(): UpdateStatus {
  const [status, setStatus] = useState<UpdateStatus>({ state: 'idle' })
  useEffect(() => {
    void call(tidy.updateStatus()).then((s) => s && setStatus(s))
    return tidy.onUpdateStatus(setStatus)
  }, [])
  return status
}

export function describeUpdate(s: UpdateStatus): string {
  switch (s.state) {
    case 'disabled':
      return 'Updates are checked in the installed app only.'
    case 'checking':
      return 'Checking for updates…'
    case 'available':
      return `Version ${s.version} is available.`
    case 'downloading':
      return `Downloading version ${s.version ?? ''}… ${s.percent ?? 0}%`
    case 'ready':
      return `Version ${s.version} is ready — restart to update.`
    case 'none':
      return 'You have the latest version.'
    case 'error':
      return `Could not check for updates: ${s.error}`
    default:
      return 'Updates are checked automatically.'
  }
}
