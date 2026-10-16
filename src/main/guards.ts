import path from 'path'

export const BIN_DIR_NAME = '.tidydesk-bin'

function norm(p: string): string {
  return path.win32.resolve(p).replace(/[\\/]+$/, '').toLowerCase()
}

function protectedRoots(): string[] {
  const env = process.env
  return [
    env.SystemRoot || 'C:\\Windows',
    env.ProgramFiles || 'C:\\Program Files',
    env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
    env.ProgramData || 'C:\\ProgramData'
  ].map(norm)
}

/** True for system folders, drive roots and anything inside a TidyDesk Safe Bin. */
export function isProtectedPath(p: string): boolean {
  const resolved = path.win32.resolve(p)
  if (resolved === path.win32.parse(resolved).root) return true
  const n = norm(resolved)
  if (n.split('\\').includes(BIN_DIR_NAME)) return true
  return protectedRoots().some((root) => n === root || n.startsWith(root + '\\'))
}
