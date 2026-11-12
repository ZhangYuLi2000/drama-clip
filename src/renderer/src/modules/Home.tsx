import type { ReactElement } from 'react'
import { CheckCircleOutlined, FolderOpenOutlined, StarOutlined, VideoCameraOutlined } from '@ant-design/icons'
import { Card, Col, Row } from 'antd'
import { DRAMAS } from '../mock/data'
import { totalAnalyzed, totalPending, useStore } from '../store'

export default function Home(): ReactElement {
  const hls = useStore((s) => s.hls)
  const pending = useStore(totalPending)
  const analyzed = useStore(totalAnalyzed)
  const goto = useStore((s) => s.goto)

  const totalEps = DRAMAS.reduce((n, d) => n + d.eps, 0)

  const stats = [
    {
      label: '短剧',
      value: DRAMAS.length,
      sub: '部 · 已登记',
      icon: <FolderOpenOutlined />,
      bg: '#e6f4ff',
      color: '#1677ff',
      act: () => goto('episodes', { page: 'tasks', review: null, q: '', filter: 'all', sel: [] })
    },
    {
      label: '剧集',
      value: totalEps,
      sub: `集 · 已分析 ${analyzed} 集`,
      icon: <VideoCameraOutlined />,
      bg: '#e6fffb',
      color: '#13c2c2',
      act: () => goto('episodes', { page: 'tasks', review: null, q: '', filter: 'all', sel: [] })
    },
    {
      label: '待审核候选',
      value: pending,
      sub: '条 · 待人工确认',
      icon: <CheckCircleOutlined />,
      bg: '#fff7e6',
      color: '#fa8c16',
      act: () => goto('episodes', { page: 'eps', drama: 'd1', filter: 'review', review: null, q: '', sel: [] })
    },
    {
      label: '高光资产',
      value: hls.length,
      sub: '条 · 点击查看高光管理',
      icon: <StarOutlined />,
      bg: '#fffbe6',
      color: '#faad14',
      act: () => goto('highlights', { page: 'tasks', drama: 'all', ep: 'all', q: '', tags: [] })
    }
  ]

  return (
    <div>
      <div className="dw-welcome">
        <h2 className="dw-page-title">欢迎使用短剧工作台</h2>
        <p className="dw-page-desc">本地单机处理短剧，素材不出这台机器。这里只看总览，导入、转写和审核在剧集管理里进行。</p>
      </div>

      <Row gutter={[16, 16]}>
        {stats.map((c) => (
          <Col xs={24} sm={12} xl={6} key={c.label}>
            <Card size="small" className="dw-stat" onClick={c.act} hoverable>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <span className="dw-stat-icon" style={{ background: c.bg, color: c.color }}>
                  {c.icon}
                </span>
                <div className="dw-stat-main">
                  <div className="dw-sub">{c.label}</div>
                  <div className="dw-stat-value">{c.value}</div>
                  <div className="dw-stat-sub">{c.sub}</div>
                </div>
              </div>
            </Card>
          </Col>
        ))}
      </Row>
    </div>
  )
}