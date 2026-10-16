import { describe, it, expect } from 'vitest'
import { formatBytes, formatDuration } from '../../src/shared/format'

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [1024, '1.0 KB'],
    [1.5 * 1024 ** 2, '1.5 MB'],
    [2.3 * 1024 ** 3, '2.3 GB']
  ])('%d -> %s', (n, s) => expect(formatBytes(n)).toBe(s))
})

describe('formatDuration', () => {
  it.each([
    [(3 * 60 + 12) * 60000, '3h 12m'],
    [45 * 60000, '45m'],
    [20000, '<1m']
  ])('%d -> %s', (ms, s) => expect(formatDuration(ms)).toBe(s))
})
