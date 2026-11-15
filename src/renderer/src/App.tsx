import { useEffect } from 'react'
import type { ReactElement } from 'react'
import {
  ClockCircleOutlined,
  DesktopOutlined,
  MoonOutlined,
  ScissorOutlined,
  SettingOutlined,
  StopOutlined,
  SunOutlined,
  ThunderboltOutlined
} from '@ant-design/icons'
import { Badge, Breadcrumb, Button, Segmented, Space, Tooltip } from 'antd'
import { findDrama, startLibrarySync, useLibrary } from './library'
import { toast, useStore, type ThemeMode } from './store'
import Queue from './modules/Queue'
import Settings from './modules/Settings'
import Studio from './modules/Studio'
import Panels from './panels'

const THEME_LABEL: Record<ThemeMode, string> = {
  dark: '暗色主题',
  light: '亮色主题',
  system: '跟随系统'
}

export default function App(): ReactElement {
  const screen = useStore((s) => s.screen)
  const selectedDramaId = useStore((s) => s.selectedDramaId)
  const goto = useStore((s) => s.goto)
  const backToProjects = useStore((s) => s.backToProjects)
  const themeMode = useStore((s) => s.themeMode)
  const setThemeMode = useStore((s) => s.setThemeMode)
  const cycleThemeMode = useStore((s) => s.cycleThemeMode)
  const running = useLibrary((s) => s.running)
  const stopTasks = useLibrary((s) => s.stopTasks)
  const dramas = useLibrary((s) => s.dramas)
  const currentDrama = findDrama(dramas, selectedDramaId)

  useEffect(() => startLibrarySync(), [])

  const crumbItems =
    screen === 'studio'
      ? currentDrama
        ? [
            {
              title: (
                <a
                  onClick={(e) => {
                    e.preventDefault()
                    backToProjects()
                  }}
                >
                  短剧项目
                </a>
              )
            },
            { title: currentDrama.title }
          ]
        : [{ title: '短剧项目' }]
      : screen === 'queue'
        ? [{ title: '任务队列' }]
        : [{ title: '系统设置' }]

  const themeIcon =
    themeMode === 'light' ? <SunOutlined /> : themeMode === 'system' ? <DesktopOutlined /> : <MoonOutlined />

  return (
    <div className="dw-shell">
      <aside className="dw-rail" aria-label="主导航">
        <button type="button" className="dw-rail-logo" onClick={backToProjects} title="短剧智剪">
          <span className="dw-logo-mark">
            <ThunderboltOutlined />
          </span>
        </button>

        <nav className="dw-rail-nav">
          <Tooltip title="AI 智剪" placement="right">
            <button
              type="button"
              className={`dw-rail-btn${screen === 'studio' ? ' is-active' : ''}`}
              onClick={backToProjects}
              aria-label="AI 智剪"
            >
              <ScissorOutlined />
              <span>智剪</span>
            </button>
          </Tooltip>

          <Tooltip title="任务队列" placement="right">
            <button
              type="button"
              className={`dw-rail-btn${screen === 'queue' ? ' is-active' : ''}`}
              onClick={() => goto('queue')}
              aria-label="任务队列"
            >
              <Badge count={running} size="small" offset={[4, -2]}>
                <ClockCircleOutlined style={{ fontSize: 18, color: 'inherit' }} />
              </Badge>
              <span>队列</span>
            </button>
          </Tooltip>
        </nav>

        <div className="dw-rail-foot">
          <Tooltip title={`当前：${THEME_LABEL[themeMode]}（点击切换）`} placement="right">
            <button
              type="button"
              className="dw-rail-btn"
              onClick={cycleThemeMode}
              aria-label="切换外观主题"
            >
              {themeIcon}
              <span>{themeMode === 'light' ? '亮色' : themeMode === 'system' ? '自动' : '暗色'}</span>
            </button>
          </Tooltip>

          <Tooltip title="系统设置" placement="right">
            <button
              type="button"
              className={`dw-rail-btn${screen === 'settings' ? ' is-active' : ''}`}
              onClick={() => goto('settings')}
              aria-label="系统设置"
            >
              <SettingOutlined />
              <span>设置</span>
            </button>
          </Tooltip>
        </div>
      </aside>

      <div className="dw-main">
        <header className="dw-topbar">
          <Breadcrumb className="dw-crumbs" items={crumbItems} />
          <span className="dw-spacer" />
          <Space size={10}>
            {running > 0 && (
              <Space size={6}>
                <Button size="small" type="text" className="dw-running-pill" onClick={() => goto('queue')}>
                  <span className="dw-pulse-dot" />
                  后台任务运行中 ({running})
                </Button>
                <Tooltip title="立即终止所有运行中与排队任务">
                  <Button
                    size="small"
                    danger
                    type="text"
                    icon={<StopOutlined />}
                    aria-label="终止任务"
                    onClick={() =>
                      stopTasks()
                        .then(({ cleared }) => toast(`已终止 ${cleared} 个任务`, 'info'))
                        .catch(() => toast('终止失败', 'info'))
                    }
                  />
                </Tooltip>
              </Space>
            )}
            <Segmented
              size="small"
              value={themeMode}
              onChange={(v) => setThemeMode(v as ThemeMode)}
              options={[
                { value: 'dark', icon: <MoonOutlined />, title: '暗色主题' },
                { value: 'light', icon: <SunOutlined />, title: '亮色主题' },
                { value: 'system', icon: <DesktopOutlined />, title: '跟随系统' }
              ]}
              aria-label="切换界面主题"
            />
          </Space>
        </header>

        <main className="dw-content">
          {screen === 'studio' && <Studio />}
          {screen === 'queue' && <Queue />}
          {screen === 'settings' && <Settings />}
        </main>
      </div>
      <Panels />
    </div>
  )
}
