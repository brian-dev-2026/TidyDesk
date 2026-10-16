import { useEffect, useState } from 'react'
import { Plus, RotateCcw, Trash2 } from 'lucide-react'
import { call, tidy, toast, useSettings } from '../api'
import { Button } from './ui'

/** Built-in table, shown when the user has not customised categories (mirrors main's DEFAULT_CATEGORIES). */
export const DEFAULT_CATEGORIES: Record<string, string[]> = {
  Images: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'heic', 'tiff', 'ico', 'raw'],
  Documents: ['pdf', 'doc', 'docx', 'txt', 'rtf', 'odt', 'md', 'epub'],
  Spreadsheets: ['xls', 'xlsx', 'csv', 'ods'],
  Presentations: ['ppt', 'pptx', 'odp', 'key'],
  Videos: ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'webm', 'flv', 'm4v'],
  Music: ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma'],
  Archives: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'iso'],
  Installers: ['exe', 'msi', 'msix', 'appx', 'bat', 'cmd'],
  Code: ['js', 'ts', 'jsx', 'tsx', 'py', 'java', 'c', 'cpp', 'cs', 'go', 'rs', 'html', 'css', 'json', 'xml', 'yml', 'yaml', 'sh', 'ps1', 'sql', 'php', 'rb']
}

interface Row {
  name: string
  exts: string
}

const toRows = (c: Record<string, string[]>): Row[] => Object.entries(c).map(([name, e]) => ({ name, exts: e.join(', ') }))

export function CategoryEditor({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element | null {
  const { settings, update } = useSettings()
  const [rows, setRows] = useState<Row[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setRows(toRows(settings.organizerCategories ?? DEFAULT_CATEGORIES))
      setError(null)
    }
  }, [open, settings.organizerCategories])

  if (!open) return null

  const save = async (): Promise<void> => {
    const table: Record<string, string[]> = {}
    for (const r of rows) {
      if (!r.name.trim() && !r.exts.trim()) continue
      table[r.name] = r.exts.split(',').map((x) => x.trim()).filter(Boolean)
    }
    setSaving(true)
    // main validates; on error it answers with a message we show inline
    const res = await tidy.setSettings({ organizerCategories: table })
    setSaving(false)
    if (!res.ok) return setError(res.error)
    await update({})
    toast.success('Categories saved')
    onClose()
  }

  const reset = async (): Promise<void> => {
    await call(tidy.setSettings({ organizerCategories: null as never }))
    await update({})
    toast.success('Back to the built-in categories')
    onClose()
  }

  const set = (i: number, patch: Partial<Row>): void => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6 backdrop-blur-sm animate-fade-in">
      <div role="dialog" aria-modal="true" aria-label="Customize categories" className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-line bg-surface p-6 shadow-2xl">
        <h3 className="font-semibold">Customize categories</h3>
        <p className="mt-1 text-sm text-muted">
          Each category becomes a folder. List the file extensions that go into it, separated by commas. Anything that
          matches no category goes to “Other”.
        </p>
        <div className="mt-4 flex-1 overflow-y-auto pr-1">
          <div className="grid grid-cols-[180px_1fr_auto] gap-2 text-xs font-medium text-muted">
            <span>Folder</span>
            <span>Extensions</span>
            <span />
          </div>
          {rows.map((r, i) => (
            <div key={i} className="mt-2 grid grid-cols-[180px_1fr_auto] items-center gap-2">
              <input
                aria-label={`Category ${i + 1} name`}
                value={r.name}
                onChange={(e) => set(i, { name: e.target.value })}
                className="h-9 rounded-xl border border-line bg-raised px-3 text-sm"
              />
              <input
                aria-label={`Category ${i + 1} extensions`}
                value={r.exts}
                onChange={(e) => set(i, { exts: e.target.value })}
                className="h-9 rounded-xl border border-line bg-raised px-3 text-sm"
              />
              <button
                aria-label={`Remove category ${r.name || i + 1}`}
                className="rounded-md p-2 text-muted hover:bg-raised hover:text-fg"
                onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          <Button className="mt-3 h-8 px-3 text-xs" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setRows((rs) => [...rs, { name: '', exts: '' }])}>
            Add category
          </Button>
        </div>
        {error && (
          <div role="alert" className="mt-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-600 dark:text-rose-300">
            {error}
          </div>
        )}
        <div className="mt-5 flex items-center justify-between gap-2">
          <Button variant="ghost" icon={<RotateCcw className="h-4 w-4" />} onClick={() => void reset()}>
            Reset to defaults
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" loading={saving} onClick={() => void save()}>
              Save
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
