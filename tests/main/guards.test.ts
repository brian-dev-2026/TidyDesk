import { describe, it, expect } from 'vitest'
import { isProtectedPath } from '../../src/main/guards'

describe('isProtectedPath', () => {
  it.each([
    'C:\\Windows\\System32',
    'c:\\windows',
    'C:\\Program Files\\X',
    'C:\\Program Files (x86)',
    'C:\\ProgramData\\a',
    'C:\\',
    'D:\\',
    'D:\\.tidydesk-bin\\b1\\x.txt'
  ])('protects %s', (p) => {
    expect(isProtectedPath(p)).toBe(true)
  })

  it.each(['C:\\Users\\me\\Downloads', 'D:\\Photos', 'C:\\Windowsill'])('allows %s', (p) => {
    expect(isProtectedPath(p)).toBe(false)
  })
})
