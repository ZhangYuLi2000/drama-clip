import type { ReactElement } from 'react'
import { CheckCircleOutlined, FolderOpenOutlined, StarOutlined, VideoCameraOutlined } from '@ant-design/icons'
import { Card, Col, Row } from 'antd'
import { useHighlights, useLibrary } from '../library'
import { totalAnalyzed, totalPending, toast, useStore } from '../store'

export default function Home(): ReactElement {
  const hls = useHighlights()
  const pending = useStore(totalPending)
  const analyzed = useStore(totalAnalyzed)
  const goto = useStore((s) => s.goto)
  const dramas = useLibrary((s) => s.dramas)

  const totalEps = dramas.reduce((n, d) => n + d.episodes.length, 0)

  const openFirstPending = (): void => {
    const target = dramas.find((d) => d.episodes.some((e) => e.pending > 0))
    if (target) {
      goto('episodes', { page: 'eps', drama: target.id, filter: 'review', review: null, q: '', sel: [] })
    } else {
      toast('当前没有待审核候选。AI 分析上线后，候选会出现在这里', 'info')
    }
  }

  const stats = [
    {
      label: '短剧',
      value: dramas.length,
      sub: '部 · 已导入',
      icon: <FolderOpenOutlined />,
      bg: '#e6f4ff',
      color: '#1677ff',
      act: () => goto('episodes', { page: 'tasks', review: null, q: '', filter: 'all', sel: [] })
    },
    {
      label: '剧集',
      value: totalEps,
      sub: `集 · 已转写 ${analyzed} 集`,
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
      act: openFirstPending
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