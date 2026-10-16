import { useEffect, useState } from 'react'
import { CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { dismiss, subscribeToasts, type Toast } from '../api'

export function Toasts(): JSX.Element {
  const [items, setItems] = useState<Toast[]>([])
  useEffect(() => subscribeToasts(setItems), [])
  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[60] flex w-80 flex-col gap-2" aria-live="polite">
      {items.map((t) => (
        <div
          key={t.id}
          role={t.kind === 'error' ? 'alert' : 'status'}
          className="pointer-events-auto flex items-start gap-3 rounded-xl border border-line bg-surface p-3 text-sm shadow-xl animate-fade-in"
        >
          {t.kind === 'error' && <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />}
          {t.kind === 'success' && <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />}
          {t.kind === 'info' && <Info className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500" />}
          <div className="selectable min-w-0 flex-1 break-words">{t.message}</div>
          <button aria-label="Dismiss" onClick={() => dismiss(t.id)} className="text-muted hover:text-fg">
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  )
}
