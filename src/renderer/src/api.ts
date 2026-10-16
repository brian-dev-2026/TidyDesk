import { createContext, useContext } from 'react'
import type { Result, Settings } from '@shared/types'

export const tidy = window.tidy

// ---- toasts -------------------------------------------------------------

export interface Toast {
  id: number
  kind: 'error' | 'success' | 'info'
  message: string
}

type Listener = (toasts: Toast[]) => void
let toasts: Toast[] = []
const listeners = new Set<Listener>()
let seq = 0

function emit(): void {
  for (const l of listeners) l(toasts)
}

function push(kind: Toast['kind'], message: string): void {
  const id = ++seq
  toasts = [...toasts, { id, kind, message }]
  emit()
  setTimeout(() => dismiss(id), kind === 'error' ? 7000 : 4000)
}

export function dismiss(id: number): void {
  toasts = toasts.filter((t) => t.id !== id)
  emit()
}

export function subscribeToasts(l: Listener): () => void {
  listeners.add(l)
  l(toasts)
  return () => listeners.delete(l)
}

export const toast = {
  error: (m: string) => push('error', m),
  success: (m: string) => push('success', m),
  info: (m: string) => push('info', m)
}

/** Unwraps an IPC Result; on failure shows an error toast and returns undefined. */
export async function call<T>(p: Promise<Result<T>>): Promise<T | undefined> {
  try {
    const r = await p
    if (r.ok) return r.data
    toast.error(r.error)
  } catch (e) {
    toast.error((e as Error).message)
  }
  return undefined
}

// ---- settings context ---------------------------------------------------

export interface SettingsCtx {
  settings: Settings
  update: (p: Partial<Settings>) => Promise<void>
}

export const SettingsContext = createContext<SettingsCtx | null>(null)

export function useSettings(): SettingsCtx {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('SettingsContext missing')
  return ctx
}
