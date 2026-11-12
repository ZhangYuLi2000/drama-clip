import type { ReactElement } from 'react'
import {
  CheckOutlined,
  InboxOutlined,
  LeftOutlined,
  PlusOutlined,
  ReloadOutlined,
  ThunderboltOutlined
} from '@ant-design/icons'
import { Alert, Button, Card, Empty, Input, Select, Space, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useShallow } from 'zustand/react/shallow'
import { DRAMAS, dramaById, epCat } from '../mock/data'
import type { Episode } from '../mock/data'
import { useStore, visibleEps } from '../store'
import type { EpFilter } from '../store'
import Review from './Review'

function AsrTag({ e }: { e: Episode }): ReactElement {
  if (e.asr === 'done') return <Tag color="success">完成</Tag>
  if (e.asr === 'run') return <Tag color="processing">{e.asrPct}%</Tag>
  if (e.asr === 'queue') return <Tag>排队</Tag>
  if (e.asr === 'fail') return <Tag color="error">失败</Tag>
  return <Tag>未开始</Tag>
}

function AnaTag({ e }: { e: Episode }): ReactElement {
  if (e.ana === 'done') {
    return (e.pending ?? 0) > 0 ? <Tag color="warning">待审 {e.pending}</Tag> : <Tag color="success">完成</Tag>
  }
  if (e.ana === 'run') return <Tag color="processing">分析中</Tag>
  if (e.asr === 'run' || e.asr === 'queue') return <Tag>等待转写</Tag>
  if (e.asr === 'fail') return <Tag color="error">已降级</Tag>
  return <Tag>未分析</Tag>
}

const FILTERS: { key: EpFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'review', label: '待审核' },
  { key: 'running', label: '分析中' },
  { key: 'failed', label: '失败' },
  { key: 'idle', label: '未分析' },
  { key: 'done', label: '已完成' }
]

function EpList(): ReactElement {
  const drama = useStore((s) => s.ep.drama)
  const q = useStore((s) => s.ep.q)
  const filter = useStore((s) => s.ep.filter)
  const sel = useStore((s) => s.ep.sel)
  const all = useStore((s) => s.eps[s.ep.drama])
  const vis = useStore(useShallow(visibleEps))
  const setEpDrama = useStore((s) => s.setEpDrama)
  const setEpQ = useStore((s) => s.setEpQ)
  const setEpFilter = useStore((s) => s.setEpFilter)
  const toggleEpSel = useStore((s) => s.toggleEpSel)
  const toggleEpCheckAll = useStore((s) => s.toggleEpCheckAll)
  const clearEpSel = useStore((s) => s.clearEpSel)
  const batchAnalyze = useStore((s) => s.batchAnalyze)
  const analyzeEp = useStore((s) => s.analyzeEp)
  const analyzeAll = useStore((s) => s.analyzeAll)
  const retryEp = useStore((s) => s.retryEp)
  const enterReview = useStore((s) => s.enterReview)
  const backToTasks = useStore((s) => s.backToTasks)
  const goto = useStore((s) => s.goto)

  const list = all ?? []
  const counts: Record<EpFilter, number> = { all: list.length, review: 0, running: 0, failed: 0, idle: 0, done: 0 }
  list.forEach((e) => {
    counts[epCat(e)]++
  })
  const d = dramaById(drama)

  const columns: ColumnsType<Episode> = [
    { title: '集数', dataIndex: 'n', width: 90, render: (n: number) => `第 ${n} 集` },
    { title: '时长', dataIndex: 'dur', width: 80 },
    { title: '转写', width: 100, render: (_, e) => <AsrTag e={e} /> },
    { title: 'AI 分析', width: 110, render: (_, e) => <AnaTag e={e} /> },
    {
      title: '候选',
      width: 140,
      render: (_, e) =>
        (e.cand ?? 0) > 0 ? (
          <Space size={6}>
            {e.cand} 条{(e.pending ?? 0) > 0 && <Tag color="warning">待审 {e.pending}</Tag>}
          </Space>
        ) : (
          <span className="dw-sub">—</span>
        )
    },
    {
      title: '高光',
      width: 90,
      render: (_, e) =>
        (e.hl ?? 0) > 0 ? (
          <Button type="link" size="small" style={{ padding: 0 }} onClick={() => goto('highlights', { page: 'detail', drama, ep: String(e.n), q: '', tags: [] })}>
            {e.hl} 条
          </Button>
        ) : (
          <span className="dw-sub">0</span>
        )
    },
    {
      title: '操作',
      render: (_, e) => {
        const cat = epCat(e)
        return (
          <div>
            {cat === 'review' && (
              <Button type="link" size="small" style={{ padding: 0 }} icon={<CheckOutlined />} onClick={() => enterReview(e.n)}>
                进入审核
              </Button>
            )}
            {cat === 'done' && (
              <Button type="link" size="small" style={{ padding: 0 }} onClick={() => enterReview(e.n)}>
                查看候选
              </Button>
            )}
            {cat === 'running' && (
              <Button type="link" size="small" style={{ padding: 0 }} onClick={() => goto('queue')}>
                查看进度
              </Button>
            )}
            {cat === 'failed' && (
              <Button type="link" size="small" style={{ padding: 0 }} icon={<ReloadOutlined />} onClick={() => retryEp(e.n)}>
                重试
              </Button>
            )}
            {cat === 'idle' && (
              <Button type="link" size="small" style={{ padding: 0 }} icon={<ThunderboltOutlined />} onClick={() => analyzeEp(e.n)}>
                分析
              </Button>
            )}
            {e.note && <div className="dw-sub">{e.note}</div>}
          </div>
        )
      }
    }
  ]

  return (
    <div>
      <div className="dw-page-head">
        <Button icon={<LeftOutlined />} onClick={backToTasks}>
          返回任务列表
        </Button>
        <div>
          <h2 className="dw-page-title">{d.title}</h2>
          <p className="dw-page-desc">本剧的转写、AI 分析和候选审核。通过后切片进入高光库。</p>
        </div>
        <span className="dw-spacer" />
        <Button type="primary" icon={<ThunderboltOutlined />} onClick={analyzeAll}>
          批量分析未处理
        </Button>
      </div>
      <Card styles={{ body: { padding: 16 } }}>
        <Space wrap style={{ marginBottom: 12 }}>
          <Select
            value={drama}
            onChange={setEpDrama}
            style={{ width: 240 }}
            options={DRAMAS.map((x) => ({ value: x.id, label: `${x.title}（${x.eps} 集）` }))}
          />
          <Input
            allowClear
            placeholder="搜索集数，如：3"
            value={q}
            onChange={(e) => setEpQ(e.target.value)}
            style={{ width: 180 }}
            aria-label="搜索集数"
          />
        </Space>
        <Space wrap size={6} className="dw-filters" style={{ marginBottom: 12 }}>
          {FILTERS.map((f) => (
            <Tag.CheckableTag key={f.key} checked={filter === f.key} onChange={() => setEpFilter(f.key)}>
              {f.label} <b>{counts[f.key]}</b>
            </Tag.CheckableTag>
          ))}
        </Space>
        {sel.length > 0 && (
          <Alert
            type="info"
            style={{ marginBottom: 12 }}
            message={
              <Space>
                已选 <b>{sel.length}</b> 集
                <Button size="small" type="primary" icon={<ThunderboltOutlined />} onClick={batchAnalyze}>
                  批量 AI 分析
                </Button>
                <Button size="small" onClick={clearEpSel}>
                  取消选择
                </Button>
              </Space>
            }
          />
        )}
        <Table<Episode>
          rowKey="n"
          size="middle"
          columns={columns}
          dataSource={vis}
          pagination={false}
          rowSelection={{
            selectedRowKeys: sel,
            onSelect: (r) => toggleEpSel(r.n),
            onSelectAll: () => toggleEpCheckAll()
          }}
          locale={{
            emptyText: <Empty image={<InboxOutlined style={{ fontSize: 32, color: '#c3c8d2' }} />} description="没有匹配的剧集，换个筛选条件试试" />
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', marginTop: 12, gap: 12 }}>
          <span className="dw-sub">
            《{d.title}》共 {d.eps} 集 · 当前显示 {vis.length} 集（原型演示前几集）
          </span>
        </div>
      </Card>
    </div>
  )
}

interface TaskRow {
  id: string
  title: string
  eps: number
  shown: number
  done: number
  pending: number
  hl: number
  status: 'run' | 'review' | 'idle' | 'done'
}

function TaskList(): ReactElement {
  const q = useStore((s) => s.ep.q)
  const eps = useStore((s) => s.eps)
  const hls = useStore((s) => s.hls)
  const setEpQ = useStore((s) => s.setEpQ)
  const openDrama = useStore((s) => s.openDrama)
  const openPanel = useStore((s) => s.openPanel)

  const rows: TaskRow[] = DRAMAS.filter((d) => !q.trim() || d.title.includes(q.trim())).map((d) => {
    const list = eps[d.id] ?? []
    const pending = list.reduce((n, e) => n + (e.pending ?? 0), 0)
    let status: TaskRow['status'] = 'idle'
    if (list.some((e) => epCat(e) === 'running' || epCat(e) === 'failed')) status = 'run'
    else if (pending > 0) status = 'review'
    else if (list.some((e) => e.ana === 'done')) status = 'done'
    return {
      id: d.id,
      title: d.title,
      eps: d.eps,
      shown: list.length,
      done: list.filter((e) => e.ana === 'done').length,
      pending,
      hl: hls.filter((h) => h.d === d.id).length,
      status
    }
  })

  const columns: ColumnsType<TaskRow> = [
    { title: '短剧', dataIndex: 'title' },
    { title: '登记集数', width: 100, render: (_, r) => `${r.eps} 集` },
    {
      title: '已分析',
      width: 110,
      render: (_, r) => (
        <span>
          {r.done}/{r.shown}
          <span className="dw-sub"> 集</span>
        </span>
      )
    },
    {
      title: '待审核',
      width: 100,
      render: (_, r) => (r.pending > 0 ? <Tag color="warning">{r.pending}</Tag> : <span className="dw-sub">0</span>)
    },
    { title: '高光', width: 80, render: (_, r) => (r.hl > 0 ? `${r.hl} 条` : <span className="dw-sub">0</span>) },
    {
      title: '状态',
      width: 110,
      render: (_, r) => {
        if (r.status === 'run') return <Tag color="processing">进行中</Tag>
        if (r.status === 'review') return <Tag color="warning">待审核</Tag>
        if (r.status === 'done') return <Tag color="success">已分析</Tag>
        return <Tag>未分析</Tag>
      }
    },
    {
      title: '操作',
      width: 120,
      render: (_, r) => (
        <Button type="link" size="small" style={{ padding: 0 }} onClick={() => openDrama(r.id)}>
          分析剧集
        </Button>
      )
    }
  ]

  return (
    <div>
      <div className="dw-page-head">
        <div>
          <h2 className="dw-page-title">剧集管理</h2>
          <p className="dw-page-desc">已导入的短剧任务。从操作栏「分析剧集」进入该剧的剧集处理。</p>
        </div>
        <span className="dw-spacer" />
        <Button type="primary" icon={<PlusOutlined />} onClick={() => openPanel('import')}>
          导入短剧
        </Button>
      </div>
      <Card styles={{ body: { padding: 16 } }}>
        <Input
          allowClear
          placeholder="搜索短剧名称"
          value={q}
          onChange={(e) => setEpQ(e.target.value)}
          style={{ width: 240, marginBottom: 12 }}
          aria-label="搜索短剧"
        />
        <Table<TaskRow>
          rowKey="id"
          size="middle"
          columns={columns}
          dataSource={rows}
          pagination={false}
          locale={{
            emptyText: <Empty image={<InboxOutlined style={{ fontSize: 32, color: '#c3c8d2' }} />} description="没有匹配的短剧任务" />
          }}
        />
        <div style={{ marginTop: 12 }}>
          <span className="dw-sub">共 {DRAMAS.length} 部 · 当前显示 {rows.length} 部</span>
        </div>
      </Card>
    </div>
  )
}

export default function Episodes(): ReactElement {
  const page = useStore((s) => s.ep.page)
  const review = useStore((s) => s.ep.review)
  if (page === 'eps' && review !== null) return <Review />
  if (page === 'eps') return <EpList />
  return <TaskList />
}