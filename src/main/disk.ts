import fs from 'fs/promises'
import type { DriveInfo } from '@shared/types'

/** Free and total space for every mounted drive letter. */
export async function listDrives(): Promise<DriveInfo[]> {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
  const results = await Promise.all(
    letters.map(async (l) => {
      const root = `${l}:\\`
      try {
        const s = await fs.statfs(root)
        const total = s.blocks * s.bsize
        if (!total) return null
        return { root, total, free: s.bavail * s.bsize }
      } catch {
        return null
      }
    })
  )
  return results.filter((d): d is DriveInfo => d !== null)
}
