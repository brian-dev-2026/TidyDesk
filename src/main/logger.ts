import fs from 'fs/promises'
import path from 'path'

const FILE = 'tidydesk.log'

/** Appends timestamped lines to <dir>\tidydesk.log, rotating to .1, .2 … at maxBytes. Never throws. */
export class Logger {
  private chain: Promise<void> = Promise.resolve()
  private maxBytes: number
  private keep: number

  constructor(
    private dir: string,
    opts: { maxBytes?: number; keep?: number } = {}
  ) {
    this.maxBytes = opts.maxBytes ?? 1048576
    this.keep = opts.keep ?? 3
  }

  get file(): string {
    return path.join(this.dir, FILE)
  }

  get folder(): string {
    return this.dir
  }

  error(msg: string, err?: unknown): void {
    const detail = err instanceof Error ? (err.stack ?? `${err.name}: ${err.message}`) : err === undefined ? '' : String(err)
    this.write('ERROR', detail ? `${msg} | ${detail}` : msg)
  }

  info(msg: string): void {
    this.write('INFO', msg)
  }

  /** Resolves once every queued line has been written (or dropped). */
  flush(): Promise<void> {
    return this.chain
  }

  private write(level: string, msg: string): void {
    const line = `${new Date().toISOString()} ${level} ${msg.replace(/\r?\n/g, ' ⏎ ')}\n`
    this.chain = this.chain.then(() => this.append(line)).catch(() => {})
  }

  private async append(line: string): Promise<void> {
    try {
      await fs.mkdir(this.dir, { recursive: true })
      const size = await fs.stat(this.file).then((s) => s.size, () => 0)
      if (size > 0 && size + Buffer.byteLength(line) > this.maxBytes) await this.rotate()
      await fs.appendFile(this.file, line)
    } catch {
      // logging must never break the app
    }
  }

  private async rotate(): Promise<void> {
    // tidydesk.log.(keep-1) is dropped; the rest shift up by one
    await fs.rm(`${this.file}.${this.keep - 1}`, { force: true })
    for (let i = this.keep - 2; i >= 1; i--) {
      await fs.rename(`${this.file}.${i}`, `${this.file}.${i + 1}`).catch(() => {})
    }
    await fs.rename(this.file, `${this.file}.1`).catch(() => {})
  }
}

let current: Logger | null = null

export function setLog(l: Logger): void {
  current = l
}

/** The app logger, or a console fallback when none is set (tests, early startup). */
export function getLog(): Pick<Logger, 'error' | 'info'> {
  return (
    current ?? {
      error: (msg: string, err?: unknown) => console.error(msg, err ?? ''),
      info: (msg: string) => console.log(msg)
    }
  )
}

export function installProcessHandlers(log: Logger): void {
  process.on('uncaughtException', (e) => log.error('Uncaught exception', e))
  process.on('unhandledRejection', (e) => log.error('Unhandled promise rejection', e))
}
