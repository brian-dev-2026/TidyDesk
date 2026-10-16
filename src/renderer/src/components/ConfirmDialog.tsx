import { useEffect, useRef, type ReactNode } from 'react'
import { AlertTriangle, ShieldCheck } from 'lucide-react'
import { Button } from './ui'

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = 'Confirm',
  danger,
  onConfirm,
  onCancel
}: {
  open: boolean
  title: string
  body: ReactNode
  confirmLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}): JSX.Element | null {
  const cancelRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    cancelRef.current?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6 backdrop-blur-sm animate-fade-in">
      <div role="dialog" aria-modal="true" aria-label={title} className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-2xl">
        <div className="flex gap-4">
          <div
            className={
              danger
                ? 'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-500/15 text-rose-500'
                : 'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-500'
            }
          >
            {danger ? <AlertTriangle className="h-5 w-5" /> : <ShieldCheck className="h-5 w-5" />}
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold">{title}</h3>
            <div className="mt-1.5 text-sm text-muted">{body}</div>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button ref={cancelRef} variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
