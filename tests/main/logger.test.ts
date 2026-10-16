import { describe, it, expect } from 'vitest'
import fs from 'fs/promises'
import path from 'path'
import { Logger } from '../../src/main/logger'
import { tmpDir, exists } from '../helpers/tmp'

describe('Logger', () => {
  it('writes timestamped lines', async () => {
    const d = await tmpDir()
    const log = new Logger(d)
    log.error('scan failed', new Error('boom'))
    log.info('started')
    await log.flush()
    const text = await fs.readFile(path.join(d, 'tidydesk.log'), 'utf8')
    const lines = text.trim().split('\n')
    expect(lines[0]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z ERROR scan failed \| Error: boom/)
    expect(lines.at(-1)).toMatch(/Z INFO started$/)
  })

  it('rotates at maxBytes keeping N files', async () => {
    const d = await tmpDir()
    const log = new Logger(d, { maxBytes: 200, keep: 3 })
    for (let i = 0; i < 50; i++) log.info(`line number ${i} with some padding text`)
    await log.flush()
    expect(await exists(path.join(d, 'tidydesk.log'))).toBe(true)
    expect(await exists(path.join(d, 'tidydesk.log.1'))).toBe(true)
    expect(await exists(path.join(d, 'tidydesk.log.2'))).toBe(true)
    expect(await exists(path.join(d, 'tidydesk.log.3'))).toBe(false)
    expect((await fs.stat(path.join(d, 'tidydesk.log'))).size).toBeLessThanOrEqual(400)
  })

  it('never throws when the folder is unwritable', async () => {
    const d = await tmpDir()
    const blocker = path.join(d, 'not-a-dir')
    await fs.writeFile(blocker, 'x') // a file where the log folder should be
    const log = new Logger(path.join(blocker, 'logs'))
    expect(() => log.error('x')).not.toThrow()
    await expect(log.flush()).resolves.toBeUndefined()
  })
})
