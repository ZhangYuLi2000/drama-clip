import React from 'react'
import ReactDOM from 'react-dom/client'
import { ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import App from './App'
import './styles.css'

const container = document.getElementById('root')!
type Host = HTMLElement & { __dwRoot?: ReactDOM.Root }
const host = container as Host
const root = host.__dwRoot ?? ReactDOM.createRoot(container)
host.__dwRoot = root

function render(): void {
  root.render(
    <React.StrictMode>
      <ConfigProvider locale={zhCN} theme={{ token: { colorPrimary: '#1677ff', borderRadius: 8 } }}>
        <App />
      </ConfigProvider>
    </React.StrictMode>
  )
}

render()

if (import.meta.hot) {
  const reloadKey = 'dw-hmr-reload'
  const reloadOnce = (): void => {
    if (sessionStorage.getItem(reloadKey) === '1') return
    sessionStorage.setItem(reloadKey, '1')
    window.location.reload()
  }
  import.meta.hot.accept(() => render())
  import.meta.hot.on('vite:error', reloadOnce)
  import.meta.hot.on('vite:afterUpdate', () => {
    sessionStorage.removeItem(reloadKey)
    requestAnimationFrame(() => {
      if (container.childElementCount === 0) reloadOnce()
    })
  })
}