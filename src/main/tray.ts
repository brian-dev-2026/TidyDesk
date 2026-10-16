import { app, Menu, nativeImage, Tray } from 'electron'
import path from 'path'

export function iconPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'icon.png')
    : path.join(__dirname, '../../build/icon.png')
}

export function createTray(show: () => void, quit: () => void): Tray {
  const tray = new Tray(nativeImage.createFromPath(iconPath()).resize({ width: 16, height: 16 }))
  tray.setToolTip('TidyDesk')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open TidyDesk', click: show },
      { type: 'separator' },
      { label: 'Quit', click: quit }
    ])
  )
  tray.on('double-click', show)
  tray.on('click', show)
  return tray
}
