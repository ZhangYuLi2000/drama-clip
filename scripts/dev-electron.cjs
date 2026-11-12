const { spawn } = require('child_process')
const path = require('path')

// 从 Electron 宿主（例如 DSH）里启动时会继承 ELECTRON_RUN_AS_NODE=1，
// 此时 require('electron') 只返回 exe 路径，ipcMain/app 全是 undefined。
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const root = path.join(__dirname, '..')
const bin = path.join(root, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js')
const args = [bin, ...process.argv.slice(2)]

const child = spawn(process.execPath, args, {
  cwd: root,
  env,
  stdio: 'inherit',
  windowsHide: false
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code == null ? 1 : code)
})

child.on('error', (err) => {
  console.error(err)
  process.exit(1)
})
