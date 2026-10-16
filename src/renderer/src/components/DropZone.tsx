import { useRef, useState, type ReactNode } from 'react'
import { FolderInput } from 'lucide-react'
import { call, tidy, toast } from '../api'

/** Wraps a page so a single folder can be dropped onto it. */
export function DropZone({ onFolder, children }: { onFolder: (dir: string) => void; children: ReactNode }): JSX.Element {
  const [over, setOver] = useState(false)
  const depth = useRef(0)

  const onDrop = async (e: React.DragEvent): Promise<void> => {
    e.preventDefault()
    depth.current = 0
    setOver(false)
    const files = [...e.dataTransfer.files]
    if (files.length !== 1) return toast.error('Drop a single folder')
    const p = tidy.pathForFile(files[0])
    if (!p || !(await call(tidy.isFolder(p)))) return toast.error('Drop a single folder')
    onFolder(p)
  }

  return (
    <div
      className="relative"
      onDragEnter={(e) => {
        e.preventDefault()
        depth.current++
        setOver(true)
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1)
        if (depth.current === 0) setOver(false)
      }}
      onDrop={(e) => void onDrop(e)}
    >
      {children}
      {over && (
        <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center rounded-2xl border-2 border-dashed border-indigo-500 bg-indigo-500/10 backdrop-blur-[1px]">
          <div className="flex items-center gap-2 rounded-xl bg-surface px-4 py-2 text-sm font-medium shadow-lg">
            <FolderInput className="h-4 w-4 text-indigo-500" /> Drop a folder
          </div>
        </div>
      )}
    </div>
  )
}
