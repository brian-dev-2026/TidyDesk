import fs from 'fs/promises'
import path from 'path'
import { randomBytes } from 'crypto'
import type { HistoryEntry } from '@shared/types'

const MAX_ENTRIES = 500
const SIDECAR_THRESHOLD = 2000
let idCounter = 0

interface Detail {
  items?: HistoryEntry['items']
  moves?: HistoryEntry['moves']
}

/** Activity log in <dir>/history.json; large item lists live in <dir>/history/<id>.json. */
export class HistoryStore {
  private entries: HistoryEntry[] | null = null
  private chain: Promise<unknown> = Promise.resolve()

  constructor(private dir: string) {}

  private get file(): string {
    return path.join(this.dir, 'history.json')
  }

  private sidecar(id: string): string {
    return path.join(this.dir, 'history', `${id}.json`)
  }

  newId(): string {
    idCounter = (idCounter + 1) % 1296
    return `${Date.now().toString(36)}-${idCounter.toString(36).padStart(2, '0')}${randomBytes(3).toString('hex')}`
  }

  /** Serialise every operation so writes never interleave. */
  private run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn)
    this.chain = next.catch(() => {})
    return next
  }

  private async load(): Promise<HistoryEntry[]> {
    if (this.entries) return this.entries
    try {
      const parsed = JSON.parse(await fs.readFile(this.file, 'utf8'))
      if (!Array.isArray(parsed)) throw new Error('not an array')
      this.entries = parsed
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
        await fs.rename(this.file, path.join(this.dir, `history.corrupt-${Date.now()}.json`)).catch(() => {})
      }
      this.entries = []
    }
    return this.entries!
  }

  private async save(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true })
    const tmp = this.file + '.tmp'
    await fs.writeFile(tmp, JSON.stringify(this.entries))
    await fs.rename(tmp, this.file)
  }

  /** Moves large item lists into a sidecar file and returns the entry as stored in history.json. */
  private async externalise(e: HistoryEntry): Promise<HistoryEntry> {
    const size = (e.items?.length ?? 0) + (e.moves?.length ?? 0)
    if (size <= SIDECAR_THRESHOLD) {
      if (e.itemsFile) {
        await fs.rm(this.sidecar(e.id), { force: true })
        const { itemsFile: _drop, ...rest } = e
        return rest
      }
      return e
    }
    const detail: Detail = { items: e.items, moves: e.moves }
    await fs.mkdir(path.dirname(this.sidecar(e.id)), { recursive: true })
    const tmp = this.sidecar(e.id) + '.tmp'
    await fs.writeFile(tmp, JSON.stringify(detail))
    await fs.rename(tmp, this.sidecar(e.id))
    const { items: _i, moves: _m, ...rest } = e
    return { ...rest, itemsFile: `history/${e.id}.json` }
  }

  private async hydrate(e: HistoryEntry): Promise<HistoryEntry> {
    if (!e.itemsFile) return { ...e }
    // a missing or unreadable sidecar must surface: acting on an empty item list would lose the batch
    const detail: Detail = JSON.parse(await fs.readFile(this.sidecar(e.id), 'utf8'))
    return { ...e, ...detail }
  }

  /** Newest first, without item/move lists. */
  list(): Promise<HistoryEntry[]> {
    return this.run(async () =>
      [...(await this.load())]
        .sort((a, b) => b.createdAt - a.createdAt)
        .map(({ items: _i, moves: _m, ...rest }) => rest)
    )
  }

  /** Every entry with item lists loaded; for internal bookkeeping. */
  all(): Promise<HistoryEntry[]> {
    return this.run(async () => Promise.all((await this.load()).map((e) => this.hydrate(e))))
  }

  get(id: string): Promise<HistoryEntry | undefined> {
    return this.run(async () => {
      const e = (await this.load()).find((x) => x.id === id)
      return e ? this.hydrate(e) : undefined
    })
  }

  add(e: HistoryEntry): Promise<void> {
    return this.run(async () => {
      const entries = await this.load()
      entries.push(await this.externalise(e))
      entries.sort((a, b) => a.createdAt - b.createdAt)
      // drop the oldest finished entries; a batch still in the Safe Bin is never dropped
      while (entries.length > MAX_ENTRIES) {
        const i = entries.findIndex((x) => x.status !== 'held' && x.status !== 'partial')
        if (i < 0) break
        const [old] = entries.splice(i, 1)
        if (old.itemsFile) await fs.rm(this.sidecar(old.id), { force: true })
      }
      await this.save()
    })
  }

  update(id: string, patch: Partial<HistoryEntry>): Promise<HistoryEntry> {
    return this.run(async () => {
      const entries = await this.load()
      const i = entries.findIndex((x) => x.id === id)
      if (i < 0) throw new Error(`History entry not found: ${id}`)
      const full = { ...(await this.hydrate(entries[i])), ...patch }
      entries[i] = await this.externalise(full)
      await this.save()
      return full
    })
  }
}
