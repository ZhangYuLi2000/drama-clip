import type { ReactElement } from 'react'
import {
  BellOutlined,
  ClockCircleOutlined,
  HomeOutlined,
  ScissorOutlined,
  SettingOutlined,
  StarOutlined,
  ThunderboltOutlined,
  UnorderedListOutlined
} from '@ant-design/icons'
import { Avatar, Badge, Breadcrumb, Button, Input, Layout, Menu, Tooltip } from 'antd'
import type { MenuProps } from 'antd'
import { dramaById } from './mock/data'
import { totalPending, toast, useStore } from './store'
import type { Screen } from './store'
import Home from './modules/Home'
import Episodes from './modules/Episodes'
import Highlights from './modules/Highlights'
import Mix from './modules/Mix'
import Queue from './modules/Queue'
import Settings from './modules/Settings'
import Panels from './panels'

const SCREEN_NAMES: Record<Screen, string> = {
  home: '首页',
  episodes: '剧集管理',
  highlights: '高光管理',
  mix: '智能混剪',
  queue: '任务队列',
  settings: '设置'
}
const SEARCH_PH: Record<Screen, string> = {
  home: '总览页不搜索',
  episodes: '搜索集数，回车定位',
  highlights: '搜索高光',
  mix: '混剪页不搜索',
  queue: '当前页不搜索',
  settings: '当前页不搜索'
}

export default function App(): ReactElement {
  const screen = useStore((s) => s.screen)
  const pending = useStore(totalPending)
  const basketN = useStore((s) => s.basket.length)
  const cost = useStore((s) => s.cost)
  const epDrama = useStore((s) => s.ep.drama)
  const epReview = useStore((s) => s.ep.review)
  const epPage = useStore((s) => s.ep.page)
  const hlPage = useStore((s) => s.hl.page)
  const hlDrama = useStore((s) => s.hl.drama)
  const mixPage = useStore((s) => s.mix.page)
  const mixDrama = useStore((s) => s.mix.drama)
  const goto = useStore((s) => s.goto)
  const globalSearch = useStore((s) => s.globalSearch)

  const menuItems: MenuProps['items'] = [
    {
      key: 'work',
      type: 'group',
      label: '工作模块',
      children: [
        { key: 'home', icon: <HomeOutlined />, label: '首页' },
        {
          key: 'episodes',
          icon: <UnorderedListOutlined />,
          label: (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              剧集管理
              {pending > 0 && <Badge count={pending} size="small" />}
            </span>
          )
        },
        { key: 'highlights', icon: <StarOutlined />, label: '高光管理' },
        {
          key: 'mix',
          icon: <ScissorOutlined />,
          label: (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              智能混剪
              {basketN > 0 && <Badge count={basketN} size="small" color="#1677ff" />}
            </span>
          )
        }
      ]
    },
    {
      key: 'sys',
      type: 'group',
      label: '系统',
      children: [
        {
          key: 'queue',
          icon: <ClockCircleOutlined />,
          label: (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              任务队列
              <Badge count={2} size="small" />
            </span>
          )
        },
        { key: 'settings', icon: <SettingOutlined />, label: '设置' }
      ]
    }
  ]

  const onMenu: MenuProps['onClick'] = ({ key }) => {
    if (key === 'episodes') goto('episodes', { page: 'tasks', review: null, q: '', filter: 'all', sel: [] })
    else if (key === 'highlights') goto('highlights', { page: 'tasks', drama: 'all', ep: 'all', q: '', tags: [] })
    else if (key === 'mix') goto('mix', { page: 'tasks', q: '' })
    else if (key === 'queue') goto('queue')
    else if (key === 'settings') goto('settings')
    else goto('home')
  }

  const crumbLink = (label: string, go: () => void): { title: ReactElement } => ({
    title: (
      <a
        onClick={(e) => {
          e.preventDefault()
          go()
        }}
      >
        {label}
      </a>
    )
  })

  const crumbItems =
    screen === 'episodes'
      ? epPage === 'tasks'
        ? [{ title: '剧集管理' }]
        : [
            crumbLink('剧集管理', () => goto('episodes', { page: 'tasks', review: null, q: '', filter: 'all', sel: [] })),
            { title: dramaById(epDrama).title },
            ...(epReview !== null ? [{ title: `第 ${epReview} 集审核` }] : [])
          ]
      : screen === 'highlights'
        ? hlPage === 'tasks'
          ? [{ title: '高光管理' }]
          : [crumbLink('高光管理', () => goto('highlights', { page: 'tasks', drama: 'all', ep: 'all', q: '', tags: [] })), { title: dramaById(hlDrama).title }]
        : screen === 'mix'
          ? mixPage === 'tasks'
            ? [{ title: '智能混剪' }]
            : [crumbLink('智能混剪', () => goto('mix', { page: 'tasks', q: '' })), { title: dramaById(mixDrama).title }]
          : [{ title: '工作台' }, { title: SCREEN_NAMES[screen] }]

  return (
    <Layout className="dw-shell">
      <Layout.Sider className="dw-sider" width={220} theme="dark">
        <div className="dw-logo">
          <span className="dw-logo-mark">
            <ThunderboltOutlined />
          </span>
          短剧工作台
        </div>
        <div className="dw-sider-scroll">
          <Menu theme="dark" mode="inline" selectedKeys={[screen]} items={menuItems} onClick={onMenu} />
        </div>
        <div className="dw-sider-foot">v0.1 · 本地单机版</div>
      </Layout.Sider>
      <Layout className="dw-main">
        <Layout.Header className="dw-header">
          <Breadcrumb className="dw-crumbs" items={crumbItems} />
          <span className="dw-spacer" />
          <Input.Search
            allowClear
            className="dw-header-search"
            placeholder={
              screen === 'episodes'
                ? epPage === 'tasks'
                  ? '搜索短剧名称'
                  : '搜索集数，回车定位'
                : screen === 'highlights'
                  ? hlPage === 'tasks'
                    ? '搜索短剧名称'
                    : '搜索高光'
                  : screen === 'mix'
                    ? mixPage === 'tasks'
                      ? '搜索短剧名称'
                      : '混剪页不搜索'
                    : SEARCH_PH[screen]
            }
            onSearch={(v) => globalSearch(v)}
          />
          <Tooltip title="任务通知">
            <Badge dot>
              <Button type="text" icon={<BellOutlined />} onClick={() => goto('queue')} aria-label="任务通知" />
            </Badge>
          </Tooltip>
          <Avatar
            size={28}
            style={{ background: '#1677ff', cursor: 'pointer', flex: 'none' }}
            onClick={() => toast('原型演示：本地单机版，无账号体系', 'info')}
          >
            R
          </Avatar>
        </Layout.Header>
        <Layout.Content className="dw-content">
          {screen === 'home' && <Home />}
          {screen === 'episodes' && <Episodes />}
          {screen === 'highlights' && <Highlights />}
          {screen === 'mix' && <Mix />}
          {screen === 'queue' && <Queue />}
          {screen === 'settings' && <Settings />}
        </Layout.Content>
        <Layout.Footer style={{ textAlign: 'center', color: '#8a919f', fontSize: 12, padding: '12px 20px' }}>
          本地运行 · 素材不出机 · 今日 AI 成本 ¥{cost.toFixed(2)}
        </Layout.Footer>
      </Layout>
      <Panels />
    </Layout>
  )
}