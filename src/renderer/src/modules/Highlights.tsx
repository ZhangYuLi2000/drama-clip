import type { ReactElement } from 'react'
import {
  AppstoreOutlined,
  CaretRightOutlined,
  CheckOutlined,
  DeleteOutlined,
  EyeOutlined,
  InboxOutlined,
  LeftOutlined,
  PlusOutlined,
  ScissorOutlined,
  TableOutlined
} from '@ant-design/icons'
import { Badge, Button, Card, Empty, Input, Popconfirm, Segmented, Select, Space, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useShallow } from 'zustand/react/shallow'
import { DRAMAS, TAGSET, dramaById } from '../mock/data'
import type { Highlight } from '../mock/data'
import { filteredHls, hlEpOptions, useStore } from '../store'
import type { HlSort } from '../store'

function HlActions({ h }: { h: Highlight }): ReactElement {
  const basket = useStore((s) => s.basket)
  const openPreview = useStore((s) => s.openPreview)
  const addToBasket = useStore((s) => s.addToBasket)
  const hlSource = useStore((s) => s.hlSource)
  const inBasket = basket.includes(h.id)
  return (
    <Space size={4} wrap className="dw-hl-actions">
      <Button size="small" icon={<EyeOutlined />} onClick={() => openPreview(h.id)}>
        预览
      </Button>
      <Button
        size="small"
        type={inBasket ? 'default' : 'primary'}
        icon={inBasket ? <CheckOutlined /> : <PlusOutlined />}
        disabled={inBasket}
        onClick={() => addToBasket(h.id)}
      >
        {inBasket ? '已选' : '混剪'}
      </Button>
      <Button size="small" onClick={() => hlSource(h.id)}>
        来源
      </Button>
    </Space>
  )
}

function HlDetail(): ReactElement {
  const drama = useStore((s) => s.hl.drama)
  const ep = useStore((s) => s.hl.ep)
  const tags = useStore((s) => s.hl.tags)
  const q = useStore((s) => s.hl.q)
  const sort = useStore((s) => s.hl.sort)
  const view = useStore((s) => s.hl.view)
  const hls = useStore((s) => s.hls)
  const basketN = useStore((s) => s.basket.length)
  const list = useStore(useShallow(filteredHls))
  const epOpts = useStore(useShallow(hlEpOptions))
  const setHlEp = useStore((s) => s.setHlEp)
  const backHl = useStore((s) => s.backHl)
  const setHlQ = useStore((s) => s.setHlQ)
  const setHlSort = useStore((s) => s.setHlSort)
  const toggleHlTag = useStore((s) => s.toggleHlTag)
  const setHlView = useStore((s) => s.setHlView)
  const deleteHl = useStore((s) => s.deleteHl)
  const openPreview = useStore((s) => s.openPreview)
  const goto = useStore((s) => s.goto)

  const mine = hls.filter((h) => h.d === drama)
  const totalDur = mine.reduce((n, h) => n + h.dur, 0)
  const avg = mine.length ? Math.round(mine.reduce((n, h) => n + h.score, 0) / mine.length) : 0
  const dramaTitle = dramaById(drama).title

  const columns: ColumnsType<Highlight> = [
    { title: '标题', dataIndex: 'title' },
    {
      title: '来源',
      render: (_, h) => `《${dramaById(h.d).title}》第 ${h.ep} 集`
    },
    { title: '时长', width: 90, render: (_, h) => `${h.dur.toFixed(1)}s` },
    { title: '评分', width: 80, render: (_, h) => <span className="dw-score">{h.score}</span> },
    {
      title: '标签',
      render: (_, h) => (
        <Space size={4} wrap>
          {h.tags.map((t) => (
            <Tag key={t}>{t}</Tag>
          ))}
        </Space>
      )
    },
    { title: '操作', width: 240, render: (_, h) => <HlActions h={h} /> }
  ]

  return (
    <div>
      <div className="dw-page-head">
        <Button icon={<LeftOutlined />} onClick={backHl}>
          返回任务列表
        </Button>
        <div>
          <h2 className="dw-page-title">{dramaTitle}</h2>
          <p className="dw-page-desc">本剧已入库高光。可预览、改标签、加入混剪素材篮。</p>
        </div>
        <span className="dw-spacer" />
        <Badge count={basketN} size="small" offset={[-2, 2]}>
          <Button type="primary" icon={<ScissorOutlined />} onClick={() => goto('mix', { page: 'detail', drama })}>
            去混剪
          </Button>
        </Badge>
      </div>
      <p className="dw-sub" style={{ marginTop: 0 }}>
        共 {mine.length} 条 · 总时长 {Math.round(totalDur)} 秒 · 平均评分 {avg} · 素材篮已选 {basketN} 条
      </p>
      <Card style={{ marginBottom: 16 }} styles={{ body: { padding: 16, paddingBottom: 8 } }}>
        <Space wrap style={{ marginBottom: 10 }}>
          <Select
            value={ep}
            onChange={setHlEp}
            style={{ width: 130 }}
            options={[{ value: 'all', label: '全部剧集' }, ...epOpts.map((n) => ({ value: String(n), label: `第 ${n} 集` }))]}
          />
          <Input
            allowClear
            placeholder="搜索：逆袭打脸 / 甜宠名场面…"
            value={q}
            onChange={(e) => setHlQ(e.target.value)}
            style={{ width: 240 }}
            aria-label="搜索高光"
          />
          <Select
            value={sort}
            onChange={(v: HlSort) => setHlSort(v)}
            style={{ width: 120 }}
            options={[
              { value: 'score', label: '按评分' },
              { value: 'dur', label: '按时长' },
              { value: 'new', label: '最新入库' }
            ]}
          />
          <Segmented
            value={view}
            onChange={(v) => setHlView(v as 'grid' | 'table')}
            options={[
              { value: 'grid', label: '卡片', icon: <AppstoreOutlined /> },
              { value: 'table', label: '表格', icon: <TableOutlined /> }
            ]}
          />
        </Space>
        <Space size={4} wrap style={{ marginBottom: 8 }}>
          {TAGSET.map((t) => (
            <Tag.CheckableTag key={t} checked={tags.includes(t)} onChange={() => toggleHlTag(t)}>
              {t}
            </Tag.CheckableTag>
          ))}
        </Space>
      </Card>

      {list.length === 0 ? (
        <Empty image={<InboxOutlined style={{ fontSize: 36, color: '#c3c8d2' }} />} description="没有匹配的高光">
          <Button type="primary" onClick={() => goto('episodes', { page: 'tasks', review: null })}>
            去剧集管理审核入库
          </Button>
        </Empty>
      ) : view === 'grid' ? (
        <div className="dw-hl-grid">
          {list.map((h) => {
            const d = dramaById(h.d)
            return (
              <Card
                key={h.id}
                size="small"
                styles={{ body: { padding: 12 } }}
                cover={
                  <div
                    className="dw-thumb"
                    style={{ background: d.tint }}
                    role="button"
                    tabIndex={0}
                    aria-label={`预览 ${h.title}`}
                    onClick={() => openPreview(h.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') openPreview(h.id)
                    }}
                  >
                    <span className="dw-score">{h.score}</span>
                    <span className="dw-thumb-scene">{h.scene}</span>
                    <span className="dw-dur">{h.dur.toFixed(1)}s</span>
                    <span className="dw-thumb-play">
                      <CaretRightOutlined />
                    </span>
                    <Popconfirm
                      title="删除这条高光？"
                      description="将同时从素材篮移除"
                      okText="删除"
                      cancelText="取消"
                      okButtonProps={{ danger: true }}
                      onConfirm={() => deleteHl(h.id)}
                    >
                      <Button
                        size="small"
                        danger
                        className="dw-thumb-del"
                        icon={<DeleteOutlined />}
                        aria-label={`删除 ${h.title}`}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </Popconfirm>
                  </div>
                }
              >
                <div className="dw-hl-title">{h.title}</div>
                <div className="dw-sub" style={{ margin: '2px 0 6px' }}>
                  《{d.title}》第 {h.ep} 集
                </div>
                <Space size={4} wrap style={{ marginBottom: 8 }}>
                  {h.tags.map((t) => (
                    <Tag key={t}>{t}</Tag>
                  ))}
                </Space>
                <HlActions h={h} />
              </Card>
            )
          })}
        </div>
      ) : (
        <Card styles={{ body: { padding: 0 } }}>
          <Table<Highlight> rowKey="id" size="middle" columns={columns} dataSource={list} pagination={false} />
        </Card>
      )}
    </div>
  )
}

interface HlTask {
  id: string
  title: string
  n: number
  dur: number
  avg: number
}

function HlTasks(): ReactElement {
  const q = useStore((s) => s.hl.q)
  const hls = useStore((s) => s.hls)
  const setHlQ = useStore((s) => s.setHlQ)
  const openHl = useStore((s) => s.openHl)
  const rows: HlTask[] = DRAMAS.filter((d) => !q.trim() || d.title.includes(q.trim())).map((d) => {
    const mine = hls.filter((h) => h.d === d.id)
    const dur = mine.reduce((n, h) => n + h.dur, 0)
    const avg = mine.length ? Math.round(mine.reduce((n, h) => n + h.score, 0) / mine.length) : 0
    return { id: d.id, title: d.title, n: mine.length, dur, avg }
  })
  const columns: ColumnsType<HlTask> = [
    { title: '短剧', dataIndex: 'title' },
    { title: '高光', width: 100, render: (_, r) => (r.n > 0 ? `${r.n} 条` : <span className="dw-sub">暂无</span>) },
    { title: '总时长', width: 110, render: (_, r) => (r.n > 0 ? `${Math.round(r.dur)} 秒` : <span className="dw-sub">—</span>) },
    { title: '平均分', width: 90, render: (_, r) => (r.n > 0 ? <span className="dw-score">{r.avg}</span> : <span className="dw-sub">—</span>) },
    {
      title: '操作',
      width: 120,
      render: (_, r) => (
        <Button type="link" size="small" style={{ padding: 0 }} disabled={r.n === 0} onClick={() => openHl(r.id)}>
          处理高光
        </Button>
      )
    }
  ]
  return (
    <div>
      <div className="dw-page-head">
        <div>
          <h2 className="dw-page-title">高光管理</h2>
          <p className="dw-page-desc">按短剧查看已入库高光。从操作栏进入该剧的处理页。</p>
        </div>
      </div>
      <Card styles={{ body: { padding: 16 } }}>
        <Input
          allowClear
          placeholder="搜索短剧名称"
          value={q}
          onChange={(e) => setHlQ(e.target.value)}
          style={{ width: 240, marginBottom: 12 }}
          aria-label="搜索短剧"
        />
        <Table<HlTask>
          rowKey="id"
          size="middle"
          columns={columns}
          dataSource={rows}
          pagination={false}
          locale={{
            emptyText: <Empty image={<InboxOutlined style={{ fontSize: 32, color: '#c3c8d2' }} />} description="没有匹配的短剧" />
          }}
        />
      </Card>
    </div>
  )
}

export default function Highlights(): ReactElement {
  const page = useStore((s) => s.hl.page)
  return page === 'detail' ? <HlDetail /> : <HlTasks />
}