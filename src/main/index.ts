import { app, BrowserWindow, Menu, nativeImage, Tray } from 'electron'
import { join } from 'path'
import { HistoryStore } from './history'
import { SettingsStore } from './settings'
import { SafeBin } from './safebin'
import { startScheduler } from './scheduler'
import { sweepRecycleBin } from './recyclebin'
import { registerIpc } from './ipc'
import { createTray, iconPath } from './tray'

let win: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false

// lets development and automated checks run against a throwaway data folder
if (process.env.TIDYDESK_DATA_DIR) app.setPath('userData', process.env.TIDYDESK_DATA_DIR)

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showWindow())
  app.whenReady().then(start)
}

function showWindow(): void {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function quit(): void {
  quitting = true
  app.quit()
}

async function start(): Promise<void> {
  app.setAppUserModelId('com.tidydesk.app')
  // Electron's default menu stays active (though hidden) in a frameless window, and its shortcuts
  // let a stray Ctrl+R reload the page mid-task or Ctrl+W close the window. TidyDesk has no menu.
  Menu.setApplicationMenu(null)
  const dataDir = app.getPath('userData')
  const history = new HistoryStore(dataDir)
  const settings = new SettingsStore(dataDir)
  const safeBin = new SafeBin({
    history,
    holdHours: async () => (await settings.get()).holdHours,
    isDryRun: async () => (await settings.get()).dryRun
  })

  const { notifyHistoryChanged } = registerIpc({ history, settings, safeBin, getWindow: () => win })

  win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    show: false,
    backgroundColor: '#0b0b14',
    icon: nativeImage.createFromPath(iconPath()),
    title: 'TidyDesk',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  win.on('ready-to-show', () => {
    if (!process.argv.includes('--hidden')) win?.show()
  })
  win.on('close', (e) => {
    if (quitting) return
    // settings are read asynchronously, so always cancel first and then hide or quit
    e.preventDefault()
    void settings.get().then((s) => (s.closeToTray ? win?.hide() : quit()))
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  if (!app.isPackaged) {
    // keep DevTools reachable while developing, now that the default menu is gone
    win.webContents.on('before-input-event', (e, input) => {
      if (input.type === 'keyDown' && input.control && input.shift && input.key.toLowerCase() === 'i') {
        win?.webContents.toggleDevTools()
        e.preventDefault()
      }
    })
  }
  // dropping a file on the window would otherwise navigate to it with the preload attached
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('Renderer process gone', details)
  })
  win.on('closed', () => console.error('Window closed'))

  if (process.env.ELECTRON_RENDERER_URL) await win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else await win.loadFile(join(__dirname, '../renderer/index.html'))

  tray = createTray(showWindow, quit)

  startScheduler({
    safeBin,
    settings,
    sweep: (h) => sweepRecycleBin(h),
    history,
    onChange: notifyHistoryChanged
  })
}

app.on('before-quit', () => {
  quitting = true
  tray?.destroy()
})
app.on('window-all-closed', () => {
  if (quitting) app.quit()
})
