import { describe, it, expect } from 'vitest'
import { mapUpdaterEvent, pickAutoUpdater, startUpdater } from '../../src/main/updater'

describe('mapUpdaterEvent', () => {
  it.each([
    ['checking-for-update', undefined, { state: 'checking' }],
    ['update-available', { version: '1.1.0' }, { state: 'available', version: '1.1.0' }],
    ['download-progress', { percent: 42.6 }, { state: 'downloading', version: '1.1.0', percent: 43 }],
    ['update-downloaded', { version: '1.1.0' }, { state: 'ready', version: '1.1.0' }],
    ['update-not-available', { version: '1.0.0' }, { state: 'none' }],
    ['error', new Error('net::ERR_INTERNET_DISCONNECTED'), { state: 'error', error: 'net::ERR_INTERNET_DISCONNECTED' }]
  ])('%s', (event, payload, expected) => {
    expect(mapUpdaterEvent(event, payload, { state: 'available', version: '1.1.0' })).toEqual(expected)
  })
})

describe('startUpdater', () => {
  it('is disabled when not packaged and never touches the network', async () => {
    const sent: unknown[] = []
    const u = startUpdater({
      isPackaged: false,
      autoDownload: async () => true,
      send: (s) => sent.push(s),
      beforeInstall: () => {}
    })
    expect(u.status()).toEqual({ state: 'disabled' })
    await u.check()
    expect(u.status()).toEqual({ state: 'disabled' })
    u.stop()
  })
})

describe('pickAutoUpdater', () => {
  const au = { checkForUpdates: () => {} }
  it('finds autoUpdater on an ES-style module', () => {
    expect(pickAutoUpdater({ autoUpdater: au })).toBe(au)
  })
  it('finds autoUpdater on a CommonJS module wrapped in default (packaged build)', () => {
    expect(pickAutoUpdater({ default: { autoUpdater: au } })).toBe(au)
  })
  it('throws a clear error when missing', () => {
    expect(() => pickAutoUpdater({})).toThrow('electron-updater')
  })
})
