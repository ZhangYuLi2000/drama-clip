import React from 'react'
import type { ReactElement } from 'react'
import ReactDOM from 'react-dom/client'
import { ConfigProvider, theme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import App from './App'
import { useStore } from './store'
import './styles.css'

const container = document.getElementById('root')!
type Host = HTMLElement & { __dwRoot?: ReactDOM.Root }
const host = container as Host
const root = host.__dwRoot ?? ReactDOM.createRoot(container)
host.__dwRoot = root

function RootApp(): ReactElement {
  const resolvedTheme = useStore((s) => s.resolvedTheme)
  const isLight = resolvedTheme === 'light'

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: isLight ? theme.defaultAlgorithm : theme.darkAlgorithm,
        token: isLight
          ? {
              colorPrimary: '#2563eb',
              colorBgBase: '#f4f6f9',
              colorBgContainer: '#ffffff',
              colorBgElevated: '#ffffff',
              colorBorder: 'rgba(15, 23, 42, 0.1)',
              colorBorderSecondary: 'rgba(15, 23, 42, 0.06)',
              colorText: '#0f172a',
              colorTextSecondary: '#475569',
              borderRadius: 10,
              fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Inter', 'PingFang SC', sans-serif"
            }
          : {
              colorPrimary: '#3b82f6',
              colorBgBase: '#09090b',
              colorBgContainer: '#111114',
              colorBgElevated: '#18181c',
              colorBorder: 'rgba(255, 255, 255, 0.08)',
              colorBorderSecondary: 'rgba(255, 255, 255, 0.06)',
              colorText: '#f4f4f5',
              colorTextSecondary: '#a1a1aa',
              borderRadius: 10,
              fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Inter', 'PingFang SC', sans-serif"
            }
      }}
    >
      <App />
    </ConfigProvider>
  )
}

function render(): void {
  root.render(
    <React.StrictMode>
      <RootApp />
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
