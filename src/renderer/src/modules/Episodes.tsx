import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import {
  DeleteOutlined,
  FileTextOutlined,
  GlobalOutlined,
  InboxOutlined,
  LeftOutlined,
  PlusOutlined,
  ProfileOutlined,
  ReadOutlined,
  RobotOutlined,
  ScanOutlined,
  TeamOutlined,
  VideoCameraOutlined
} from '@ant-design/icons'
import { Alert, Button, Card, Collapse, Drawer, Empty, Input, InputNumber, Modal, Select, Space, Table, Tabs, Tag, Tooltip } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useShallow } from 'zustand/react/shallow'
import type { Drama, Episode, GlobalScript } from '../../../shared/types'
import { epCat, findDrama, fmtDur, fmtSize, mediaUrl, useLibrary } from '../library'
import { toast, useStore, visibleEps } from '../store'
import type { EpFilter } from '../store'
import Review from './Review'

function AsrTag({ e }: { e: Episode }): ReactElement {
  if (e.asr === 'done') {
    return e.asrNote ? (
      <Tooltip title={e.asrNote}>
        <Tag color="success">完成</Tag>
      </Tooltip>
    ) : (
      <Tag color="success">完成</Tag>
    )
  }
  if (e.asr === 'run') return <Tag color="processing">{e.asrPct ?? 0}%</Tag>
  if (e.asr === 'queue') return <Tag>排队</Tag>
  if (e.asr === 'fail') {
    return (
      <Tooltip title={e.asrNote ?? '转写失败'}>
        <Tag color="error">失败</Tag>
      </Tooltip>
    )
  }
  return <Tag>未开始</Tag>
}

function Thumb({ e }: { e: Episode }): ReactElement {
  const [err, setErr] = useState(false)
  if (!e.thumb || err) {
    return (
      <span className="dw-thumb-ph">
        <VideoCameraOutlined />
      </span>
    )
  }
  return (
    <img
      src={mediaUrl(e.thumb)}
      alt={`第 ${e.n} 集缩略图`}
      width={40}
      height={71}
      loading="lazy"
      decoding="async"
      style={{ width: 40, height: 71, objectFit: 'cover', borderRadius: 4, display: 'block' }}
      onError={() => setErr(true)}
    />
  )
}

const FILTERS: { key: EpFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'review', label: '待审核' },
  { key: 'running', label: '转写中' },
  { key: 'failed', label: '失败' },
  { key: 'idle', label: '未转写' },
  { key: 'done', label: '已转写' }
]

function GlobalAnalyzeModal({ d, open, onClose }: { d: Drama; open: boolean; onClose: () => void }): ReactElement {
  const startGlobal = useLibrary((s) => s.startGlobal)
  const [from, setFrom] = useState(1)
  const [to, setTo] = useState(1)
  const [starting, setStarting] = useState(false)

  useEffect(() => {
    if (open) {
      setFrom(d.episodes[0]?.n ?? 1)
      setTo(d.episodes[d.episodes.length - 1]?.n ?? 1)
    }
  }, [open, d])

  const eps = d.episodes.filter((e) => e.n >= from && e.n <= to)
  const totalSec = eps.reduce((s, e) => s + (e.duration ?? 0), 0)
  const tokens = Math.round(totalSec * 108)
  const acts = Math.max(1, Math.ceil(totalSec / 800))

  const start = (): void => {
    setStarting(true)
    startGlobal(d.id, from, to)
      .then(() => {
        toast('已加入全局分析队列', 'info')
        onClose()
      })
      .catch((e: unknown) => toast(e instanceof Error ? e.message : '加入队列失败', 'info'))
      .finally(() => setStarting(false))
  }

  return (
    <Modal
      title={`全局分析 · 《${d.title}》`}
      open={open}
      onCancel={onClose}
      onOk={start}
      okText="开始分析"
      cancelText="取消"
      confirmLoading={starting}
      okButtonProps={{ disabled: eps.length === 0 }}
      width={560}
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="整剧自动分幕合并为代理，每幕一次调用产出全局剧本 / 人物 / 高光库"
        description="人物与剧本跨幕自动合并；相同请求重试可命中缓存。高光进入现有审核流程，批准后才切片入库。注意：范围内剧集的现有候选与切片将被覆盖。"
      />
      <Space style={{ marginBottom: 8 }}>
        <span>分析范围：第</span>
        <InputNumber min={1} max={d.episodes[d.episodes.length - 1]?.n ?? 1} value={from} onChange={(v) => setFrom(v ?? 1)} style={{ width: 90 }} />
        <span>集 到 第</span>
        <InputNumber min={1} max={d.episodes[d.episodes.length - 1]?.n ?? 1} value={to} onChange={(v) => setTo(v ?? 1)} style={{ width: 90 }} />
        <span>集</span>
      </Space>
      <div className="dw-sub" style={{ marginBottom: 8 }}>
        共 {eps.length} 集 · 预计分 {acts} 幕 · 输入 ~{Math.round(tokens / 1000)}K tokens（108 tokens/秒视频）
      </div>
    </Modal>
  )
}

function GlobalScriptDrawer({ d, open, onClose }: { d: Drama; open: boolean; onClose: () => void }): ReactElement {
  const getGlobalScript = useLibrary((s) => s.getGlobalScript)
  const [script, setScript] = useState<GlobalScript | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (open) {
      setLoading(true)
      getGlobalScript(d.id)
        .then(setScript)
        .catch(() => setScript(null))
        .finally(() => setLoading(false))
    }
  }, [open, d.id, getGlobalScript])

  const g = d.global
  return (
    <Drawer title={`全局剧本 · 《${d.title}》`} width={720} open={open} onClose={onClose} loading={loading}>
      {g && (
        <div className="dw-sub" style={{ marginBottom: 12 }}>
          {g.model}
          {g.acts ? ` · ${g.acts} 幕` : ''} · {g.tokens} tokens（缓存命中 {g.cachedTokens}）· {new Date(g.updatedAt).toLocaleString('zh-CN')}
        </div>
      )}
      {script ? (
        <Tabs
          items={[
            {
              key: 'script',
              label: `分集剧本（${script.episodes.length}）`,
              children: (
                <Collapse
                  items={script.episodes.map((ep) => ({
                    key: String(ep.n),
                    label: `第 ${ep.n} 集 · ${ep.summary || '无梗概'}`,
                    children: (
                      <div>
                        {ep.transcript.length === 0 && <span className="dw-sub">本集无转写</span>}
                        {ep.transcript.map((s, i) => (
                          <div key={i} style={{ marginBottom: 4 }}>
                            <span className="dw-sub" style={{ display: 'inline-block', width: 88 }}>
                              {s.start.toFixed(1)}–{s.end.toFixed(1)}s
                            </span>
                            {s.text}
                          </div>
                        ))}
                      </div>
                    )
                  }))}
                />
              )
            },
            {
              key: 'chars',
              label: '人物',
              children: (
                <Table
                  size="small"
                  rowKey="name"
                  pagination={false}
                  dataSource={d.synthesis?.characters ?? []}
                  columns={[
                    { title: '人物', dataIndex: 'name', width: 120 },
                    { title: '角色', dataIndex: 'role', width: 100 },
                    { title: '身份 / 关系', dataIndex: 'desc' }
                  ]}
                />
              )
            },
            {
              key: 'arcs',
              label: '叙事地图',
              children: (
                <div>
                  <div className="dw-field-label">一句话故事</div>
                  <p style={{ marginTop: 4 }}>{script.logline || '—'}</p>
                  <div className="dw-field-label">主线叙事</div>
                  <p className="dw-sub" style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>
                    {script.arcs || '—'}
                  </p>
                </div>
              )
            }
          ]}
        />
      ) : (
        !loading && <Empty description="还没有全局剧本，先跑「全局分析」" />
      )}
    </Drawer>
  )
}

function EpList(): ReactElement {
  const drama = useStore((s) => s.ep.drama)
  const q = useStore((s) => s.ep.q)
  const filter = useStore((s) => s.ep.filter)
  const dramas = useLibrary((s) => s.dramas)
  const rescan = useLibrary((s) => s.rescan)
  const startAnalyze = useLibrary((s) => s.startAnalyze)
  const startSynthesis = useLibrary((s) => s.startSynthesis)
  const job = useLibrary((s) => s.job)
  const vis = useStore(useShallow(visibleEps))
  const setEpDrama = useStore((s) => s.setEpDrama)
  const setEpQ = useStore((s) => s.setEpQ)
  const setEpFilter = useStore((s) => s.setEpFilter)
  const enterReview = useStore((s) => s.enterReview)
  const backToTasks = useStore((s) => s.backToTasks)
  const goto = useStore((s) => s.goto)
  const sel = useStore((s) => s.ep.sel)
  const setEpSel = useStore((s) => s.setEpSel)
  const clearEpSel = useStore((s) => s.clearEpSel)
  const analyzeSelected = useStore((s) => s.analyzeSelected)
  const [rescanning, setRescanning] = useState(false)
  const [synOpen, setSynOpen] = useState(false)
  const [globalOpen, setGlobalOpen] = useState(false)
  const [scriptOpen, setScriptOpen] = useState(false)

  useEffect(() => {
    if (dramas.length > 0 && !dramas.some((x) => x.id === drama)) setEpDrama(dramas[0].id)
  }, [dramas, drama, setEpDrama])

  const d = findDrama(dramas, drama)
  const list = d?.episodes ?? []
  const counts: Record<EpFilter, number> = { all: list.length, review: 0, running: 0, failed: 0, idle: 0, done: 0 }
  list.forEach((e) => {
    counts[epCat(e)]++
  })

  const doRescan = (): void => {
    if (!d) return
    setRescanning(true)
    rescan(d.id)
      .then(({ added, repaired }) => {
        const parts: string[] = []
        if (added > 0) parts.push(`新增 ${added} 集`)
        if (repaired > 0) parts.push(`补齐 ${repaired} 集的元数据/缩略图`)
        toast(
          parts.length > 0 ? `扫描完成：${parts.join('，')}` : '扫描完成：没有发现新的剧集文件',
          parts.length > 0 ? 'success' : 'info'
        )
      })
      .catch((e: unknown) => toast(e instanceof Error ? e.message : '扫描失败', 'info'))
      .finally(() => setRescanning(false))
  }

  const analyzeVideoEp = (id: string): void => {
    startAnalyze(drama, id)
      .then(() => toast('已加入 B 路视频理解队列', 'info'))
      .catch((e: unknown) => toast(e instanceof Error ? e.message : '加入队列失败', 'info'))
  }

  const columns: ColumnsType<Episode> = [
    { title: '集数', dataIndex: 'n', width: 90, render: (n: number) => `第 ${n} 集` },
    {
      title: '画面',
      width: 72,
      render: (_, e) => <Thumb key={e.thumb ?? 'none'} e={e} />
    },
    { title: '时长', width: 80, render: (_, e) => fmtDur(e.duration) },
    { title: '大小', width: 90, render: (_, e) => fmtSize(e.size) },
    { title: '转写', width: 100, render: (_, e) => <AsrTag e={e} /> },
    {
      title: 'AI 分析',
      width: 110,
      render: (_, e) => {
        if (e.ana === 'run') return <Tag color="processing">{e.anaPct ?? 0}%</Tag>
        if (e.ana === 'queue') return <Tag>排队</Tag>
        if (e.ana === 'fail') {
          return (
            <Tooltip title={e.anaNote ?? '分析失败'}>
              <Tag color="error">失败</Tag>
            </Tooltip>
          )
        }
        if (e.cand > 0) {
          return (
            <Tooltip title={e.anaNote ? `B 路视频理解 · ${e.anaNote}` : 'B 路视频理解'}>
              <Tag color="success">候选 {e.cand}</Tag>
            </Tooltip>
          )
        }
        return (
          <Tooltip title="B 路视频理解：先在「设置」配置 API，再点操作栏「视频理解」">
            <Tag>未分析</Tag>
          </Tooltip>
        )
      }
    },
    {
      title: '候选',
      width: 130,
      render: (_, e) =>
        e.cand > 0 ? (
          <Space size={6}>
            {e.cand} 条{e.pending > 0 && <Tag color="warning">待审 {e.pending}</Tag>}
          </Space>
        ) : (
          <span className="dw-sub">—</span>
        )
    },
    {
      title: '高光',
      width: 80,
      render: (_, e) =>
        e.hl > 0 ? (
          <Button
            type="link"
            size="small"
            style={{ padding: 0 }}
            onClick={() => goto('highlights', { page: 'detail', drama, ep: String(e.n), q: '', tags: [] })}
          >
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
            <Space size={12} wrap>
              {cat === 'running' && (
                <Button type="link" size="small" style={{ padding: 0 }} onClick={() => goto('queue')}>
                  查看进度
                </Button>
              )}
              {(e.ana === 'idle' || e.ana === 'fail' || e.ana === 'done') && (
                <Button
                  type="link"
                  size="small"
                  style={{ padding: 0 }}
                  icon={<RobotOutlined />}
                  onClick={() => analyzeVideoEp(e.id)}
                >
                  {e.ana === 'done' ? '重新分析' : e.ana === 'fail' ? '重试分析' : '视频理解'}
                </Button>
              )}
              {(e.cand > 0 || cat === 'done' || cat === 'review') && (
                <Button type="link" size="small" style={{ padding: 0 }} onClick={() => enterReview(e.n)}>
                  {e.pending > 0 ? '进入审核' : '查看候选'}
                </Button>
              )}
              {(e.segments?.length ?? 0) > 0 && (
                <Button
                  type="link"
                  size="small"
                  style={{ padding: 0 }}
                  icon={<FileTextOutlined />}
                  onClick={() => useStore.setState({ transcriptEp: { dramaId: drama, n: e.n }, panel: 'transcript' })}
                >
                  转写文本
                </Button>
              )}
            </Space>
            {e.asr === 'fail' && e.asrNote && <div className="dw-sub">{e.asrNote}</div>}
            {e.ana === 'fail' && e.anaNote && <div className="dw-sub">{e.anaNote}</div>}
          </div>
        )
      }
    }
  ]

  if (!d) {
    return (
      <Card>
        <Empty description="短剧不存在或已被移除" />
      </Card>
    )
  }

  return (
    <div>
      <div className="dw-page-head">
        <Button icon={<LeftOutlined />} onClick={backToTasks}>
          返回任务列表
        </Button>
        <div>
          <h2 className="dw-page-title">{d.title}</h2>
          <p className="dw-page-desc">本剧的转写与候选审核。原片只登记索引，不搬家、不出机。</p>
        </div>
        <span className="dw-spacer" />
        <Space>
          <Tooltip title="增量添加新集，并补齐缺失的元数据/缩略图">
            <Button icon={<ScanOutlined />} loading={rescanning} onClick={doRescan}>
              重新扫描
            </Button>
          </Tooltip>
          <Tooltip title="把全剧各集物料交给文本模型，统筹人物表与叙事地图（需先在设置配置文本模型）">
            <Button
              icon={<TeamOutlined />}
              loading={job?.kind === 'synthesis' && job.dramaId === drama}
              onClick={() =>
                startSynthesis(drama)
                  .then(() => toast('已加入全剧统筹队列', 'info'))
                  .catch((e: unknown) => toast(e instanceof Error ? e.message : '统筹失败', 'info'))
              }
            >
              全剧统筹
            </Button>
          </Tooltip>
          <Tooltip
            title={
              d.global?.status === 'fail'
                ? `上次全局分析失败：${d.global.note ?? '未知原因'}，点击重试`
                : '整剧合并一次喂给 Gemini：全局剧本/人物/高光（需先在设置配置全局模型）'
            }
          >
            <Button
              icon={<GlobalOutlined />}
              loading={job?.kind === 'global' && job.dramaId === drama}
              onClick={() => setGlobalOpen(true)}
            >
              全局分析
            </Button>
          </Tooltip>
          <Button icon={<ProfileOutlined />} disabled={d.global?.status !== 'done'} onClick={() => setScriptOpen(true)}>
            全局剧本
          </Button>
          <Button icon={<ReadOutlined />} disabled={!d.synthesis} onClick={() => setSynOpen(true)}>
            人物表
          </Button>
        </Space>
      </div>
      <GlobalAnalyzeModal d={d} open={globalOpen} onClose={() => setGlobalOpen(false)} />
      <GlobalScriptDrawer d={d} open={scriptOpen} onClose={() => setScriptOpen(false)} />
      <Modal
        title={`全剧统筹 · 《${d.title}》`}
        open={synOpen}
        onCancel={() => setSynOpen(false)}
        footer={null}
        width={640}
      >
        {d.synthesis ? (
          <div>
            <div className="dw-field-label">一句话故事</div>
            <p style={{ marginTop: 4 }}>{d.synthesis.logline || '—'}</p>
            <div className="dw-field-label">人物表（自动回灌逐集分析做身份锚定）</div>
            <Table
              size="small"
              rowKey="name"
              style={{ marginBottom: 12 }}
              pagination={false}
              dataSource={d.synthesis.characters}
              columns={[
                { title: '人物', dataIndex: 'name', width: 120 },
                { title: '角色', dataIndex: 'role', width: 100 },
                { title: '身份', dataIndex: 'desc' }
              ]}
            />
            <div className="dw-field-label">叙事地图</div>
            <p className="dw-sub" style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>
              {d.synthesis.arcs || '—'}
            </p>
          </div>
        ) : (
          <Empty description="还没有统筹结果，点「全剧统筹」生成" />
        )}
      </Modal>
      <Card styles={{ body: { padding: 16 } }}>
        <Space wrap style={{ marginBottom: 12 }}>
          <Select
            value={drama || undefined}
            onChange={setEpDrama}
            style={{ width: 260 }}
            options={dramas.map((x) => ({ value: x.id, label: `${x.title}（${x.episodes.length} 集）` }))}
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
          <Space style={{ marginBottom: 12 }}>
            <span className="dw-sub">已选 {sel.length} 集</span>
            <Button type="primary" size="small" icon={<RobotOutlined />} onClick={analyzeSelected}>
              批量视频理解
            </Button>
            <Button size="small" onClick={clearEpSel}>
              清空选择
            </Button>
          </Space>
        )}
        <Table<Episode>
          rowKey="id"
          size="middle"
          columns={columns}
          dataSource={vis}
          pagination={false}
          rowSelection={{ selectedRowKeys: sel, onChange: (keys) => setEpSel(keys as string[]) }}
          locale={{
            emptyText: (
              <Empty
                image={<InboxOutlined style={{ fontSize: 32, color: '#c3c8d2' }} />}
                description="没有匹配的剧集，换个筛选条件试试"
              />
            )
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', marginTop: 12, gap: 12 }}>
          <span className="dw-sub">
            《{d.title}》已索引 {list.length} 集 · 共 {fmtSize(list.reduce((n, e) => n + e.size, 0))} · 当前显示 {vis.length} 集
          </span>
        </div>
      </Card>
    </div>
  )
}

interface TaskRow {
  id: string
  title: string
  dir: string
  eps: number
  done: number
  pending: number
  status: 'run' | 'review' | 'idle' | 'done'
}

function TaskList(): ReactElement {
  const q = useStore((s) => s.ep.q)
  const dramas = useLibrary((s) => s.dramas)
  const removeDrama = useLibrary((s) => s.removeDrama)
  const setEpQ = useStore((s) => s.setEpQ)
  const openDrama = useStore((s) => s.openDrama)
  const openPanel = useStore((s) => s.openPanel)

  const rows: TaskRow[] = dramas
    .filter((d) => !q.trim() || d.title.includes(q.trim()))
    .map((d) => {
      const list = d.episodes
      const pending = list.reduce((n, e) => n + e.pending, 0)
      let status: TaskRow['status'] = 'idle'
      if (list.some((e) => epCat(e) === 'running' || epCat(e) === 'failed')) status = 'run'
      else if (pending > 0) status = 'review'
      else if (list.some((e) => e.asr === 'done')) status = 'done'
      return {
        id: d.id,
        title: d.title,
        dir: d.dir,
        eps: list.length,
        done: list.filter((e) => e.asr === 'done').length,
        pending,
        status
      }
    })

  const confirmRemove = (r: TaskRow): void => {
    Modal.confirm({
      title: `移除《${r.title}》？`,
      content: '只移除工作台里的索引和缓存，不会删除原视频文件。',
      okText: '移除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () =>
        removeDrama(r.id)
          .then(() => toast(`已移除《${r.title}》的索引`, 'info'))
          .catch((e: unknown) => toast(e instanceof Error ? e.message : '移除失败', 'info'))
    })
  }

  const columns: ColumnsType<TaskRow> = [
    {
      title: '短剧',
      dataIndex: 'title',
      render: (_, r) => (
        <div>
          <div>{r.title}</div>
          <div className="dw-sub" style={{ fontSize: 12 }}>
            {r.dir}
          </div>
        </div>
      )
    },
    { title: '已索引', width: 100, render: (_, r) => `${r.eps} 集` },
    {
      title: '已转写',
      width: 110,
      render: (_, r) => (
        <span>
          {r.done}/{r.eps}
          <span className="dw-sub"> 集</span>
        </span>
      )
    },
    {
      title: '待审核',
      width: 100,
      render: (_, r) => (r.pending > 0 ? <Tag color="warning">{r.pending}</Tag> : <span className="dw-sub">0</span>)
    },
    {
      title: '状态',
      width: 110,
      render: (_, r) => {
        if (r.status === 'run') return <Tag color="processing">进行中</Tag>
        if (r.status === 'review') return <Tag color="warning">待审核</Tag>
        if (r.status === 'done') return <Tag color="success">已转写</Tag>
        return <Tag>未转写</Tag>
      }
    },
    {
      title: '操作',
      width: 160,
      render: (_, r) => (
        <Space size={12}>
          <Button type="link" size="small" style={{ padding: 0 }} onClick={() => openDrama(r.id)}>
            分析剧集
          </Button>
          <Button
            type="link"
            size="small"
            danger
            style={{ padding: 0 }}
            icon={<DeleteOutlined />}
            onClick={() => confirmRemove(r)}
          >
            移除
          </Button>
        </Space>
      )
    }
  ]

  return (
    <div>
      <div className="dw-page-head">
        <div>
          <h2 className="dw-page-title">剧集管理</h2>
          <p className="dw-page-desc">已导入的短剧任务。从操作栏「分析剧集」进入该剧的转写与审核。</p>
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
            emptyText: (
              <Empty
                image={<InboxOutlined style={{ fontSize: 32, color: '#c3c8d2' }} />}
                description="还没有短剧，点右上角「导入短剧」开始"
              >
                <Button type="primary" icon={<PlusOutlined />} onClick={() => openPanel('import')}>
                  导入短剧
                </Button>
              </Empty>
            )
          }}
        />
        <div style={{ marginTop: 12 }}>
          <span className="dw-sub">共 {dramas.length} 部 · 当前显示 {rows.length} 部</span>
        </div>
      </Card>
    </div>
  )
}

export default function Episodes(): ReactElement {
  const page = useStore((s) => s.ep.page)
  const review = useStore((s) => s.ep.review)
  const dramas = useLibrary((s) => s.dramas)
  const openPanel = useStore((s) => s.openPanel)
  if (dramas.length === 0) {
    return (
      <div>
        <div className="dw-page-head">
          <div>
            <h2 className="dw-page-title">剧集管理</h2>
            <p className="dw-page-desc">导入本地短剧目录后，这里管理每一集的转写与审核。</p>
          </div>
          <span className="dw-spacer" />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => openPanel('import')}>
            导入短剧
          </Button>
        </div>
        <Card>
          <Empty
            image={<InboxOutlined style={{ fontSize: 40, color: '#c3c8d2' }} />}
            description="媒体库还是空的。导入一个短剧目录试试（文件名形如「第1集.mp4」）"
          >
            <Button type="primary" icon={<PlusOutlined />} onClick={() => openPanel('import')}>
              导入短剧
            </Button>
          </Empty>
        </Card>
      </div>
    )
  }
  if (page === 'eps' && review !== null) return <Review />
  if (page === 'eps') return <EpList />
  return <TaskList />
}