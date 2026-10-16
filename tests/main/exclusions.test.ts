import { describe, it, expect } from 'vitest'
import path from 'path'
import { isExcluded, normaliseExclusions } from '../../src/main/exclusions'

const w = (...p: string[]) => path.win32.join('C:/', ...p)

describe('exclusions', () => {
  it('isExcluded matches equal and nested paths case-insensitively', () => {
    const list = [w('Users', 'me', 'Projects')]
    expect(isExcluded(w('Users', 'me', 'Projects'), list)).toBe(true)
    expect(isExcluded(w('users', 'ME', 'projects', 'app', 'x.txt'), list)).toBe(true)
    expect(isExcluded(w('Users', 'me', 'Downloads', 'x.txt'), list)).toBe(false)
  })

  it('isExcluded does not match sibling prefixes', () => {
    expect(isExcluded(w('a', 'bc'), [w('a', 'b')])).toBe(false)
    expect(isExcluded(w('a', 'b'), [w('a', 'b') + '\\'])).toBe(true)
  })

  it('isExcluded with an empty list is false', () => {
    expect(isExcluded(w('a'), [])).toBe(false)
  })

  it('normaliseExclusions drops relative, duplicate and non-string entries and caps at 200', () => {
    const many = Array.from({ length: 250 }, (_, i) => w('x' + i))
    expect(normaliseExclusions([w('a'), w('A'), 'relative\\path', 42, null, w('b') + '\\'])).toEqual([w('a'), w('b')])
    expect(normaliseExclusions(many)).toHaveLength(200)
    expect(normaliseExclusions('nope')).toEqual([])
  })
})
