import { useEffect, useState, useSyncExternalStore } from 'react'
import type { JunkCategory, Progress } from '@shared/types'
import { tidy } from './api'

/** Tiny shared store so the Dashboard and Junk page see the same last scan. */
function createStore<T>(initial: T) {
  let value = initial
  const subs = new Set<() => void>()
  return {
    get: () => value,
    set: (v: T) => {
      value = v
      subs.forEach((s) => s())
    },
    use: (): T =>
      useSyncExternalStore(
        (cb) => {
          subs.add(cb)
          return () => subs.delete(cb)
        },
        () => value
      )
  }
}

export const lastJunkScan = createStore<{ categories: JunkCategory[]; at: number } | null>(null)

/** Re-renders whenever the main process says history changed. */
export function useHistoryVersion(): number {
  const [v, setV] = useState(0)
  useEffect(() => tidy.onHistoryChanged(() => setV((x) => x + 1)), [])
  return v
}

/** Latest progress event for one operation kind. */
export function useProgress(op: Progress['op']): Progress | null {
  const [p, setP] = useState<Progress | null>(null)
  useEffect(() => tidy.onProgress((e) => e.op === op && setP(e)), [op])
  return p
}
