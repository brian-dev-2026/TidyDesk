import { app, BrowserWindow } from 'electron'
import { join } from 'path'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true, contextIsolation: true }
  })
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => app.quit())
