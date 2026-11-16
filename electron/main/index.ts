import { app, BrowserWindow, dialog, ipcMain, nativeImage, protocol } from 'electron'
import path from 'path'
import { initDb } from './db'
import { registerIpc, registerMediaProtocol } from './ipc'
import { repairMissingMedia } from './jobs'
import { initSettings } from './settings'

const devUrl = process.env['ELECTRON_RENDERER_URL']

const appIcon = nativeImage.createFromPath(
  path.join(app.getAppPath(), 'vibe_images', 'longlong-mark-final_1794838613208_7fe282a0.png')
)

// 热更新会整页重载或重启 Electron。Windows 上 CalculateNativeWinOcclusion
// 会把刚重载的窗口当成被挡住，停在白帧；同时上一个进程还占着 GPU 磁盘缓存。
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
if (!app.isPackaged) {
  app.commandLine.appendSwitch('disable-gpu-shader-disk-cache')
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'dw-media', privileges: { stream: true, supportFetchAPI: true, bypassCSP: true } }
])

function loadRenderer(win: BrowserWindow): void {
  if (!app.isPackaged && devUrl) void win.loadURL(devUrl)
  else void win.loadFile(path.join(__dirname, '../renderer/index.html'))
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    title: '龙龙智剪',
    icon: appIcon.isEmpty() ? undefined : appIcon,
    backgroundColor: '#09090b',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  const showWin = (): void => {
    if (!win.isDestroyed() && !win.isVisible()) win.show()
  }
  win.once('ready-to-show', showWin)
  win.webContents.once('did-finish-load', showWin)
  setTimeout(showWin, 1500)

  if (!app.isPackaged) {
    let recovering = false
    const recover = (why: string): void => {
      if (recovering || win.isDestroyed()) return
      recovering = true
      console.error(`[dev] renderer recover: ${why}`)
      setTimeout(() => {
        if (win.isDestroyed()) return
        loadRenderer(win)
        recovering = false
      }, 400)
    }
    win.webContents.on('did-fail-load', (_event, code, desc, url) => {
      if (code === -3) return
      recover(`did-fail-load ${code} ${desc} ${url}`)
    })
    win.webContents.on('render-process-gone', (_event, details) => {
      recover(`render-process-gone ${details.reason}`)
    })
  }

  loadRenderer(win)
}

ipcMain.handle('get-app-info', () => ({ name: app.getName(), version: app.getVersion() }))

ipcMain.handle('select-directory', async () => {
  const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const result = await dialog.showOpenDialog(parent, {
    title: '选择目录',
    properties: ['openDirectory']
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
})

app.whenReady().then(() => {
  if (process.platform === 'darwin' && !appIcon.isEmpty()) {
    app.dock?.setIcon(appIcon)
  }
  initDb()
  initSettings()
  registerMediaProtocol()
  registerIpc()
  repairMissingMedia()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})