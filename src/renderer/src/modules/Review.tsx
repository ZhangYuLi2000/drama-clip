import { useEffect } from 'react'
import type { ReactElement } from 'react'
import {
  CaretRightOutlined,
  CheckOutlined,
  CloseOutlined,
  InboxOutlined,
  LeftOutlined,
  PauseOutlined,
  ReloadOutlined,
  RightOutlined,
  StepBackwardOutlined,
  StepForwardOutlined
} from '@ant-design/icons'
import { Button, Card, Empty, Progress, Select, Space, Switch, Tag } from 'antd'
import { EP_DUR, SHOTS, TAGSET, dramaById, fmt } from '../mock/data'
import type { CandLine } from '../mock/data'
import { inReviewDemo, useStore } from '../store'

export default function Review(): ReactElement {
  const drama = useStore((s) => s.ep.drama)
  const n = useStore((s) => s.ep.review)
  const demo = useStore(inReviewDemo)
  const cands = useStore((s) => s.cands)
  const candId = useStore((s) => s.ep.candId)
  const pendingOnly = useStore((s) => s.ep.pendingOnly)
  const time = useStore((s) => s.ep.time)
  const playing = useStore((s) => s.ep.playing)
  const snap = useStore((s) => s.ep.snap)
  const eps = useStore((s) => s.eps[s.ep.drama])
  const reviewBack = useStore((s) => s.reviewBack)
  const gotoDemo = useStore((s) => s.gotoDemo)
  const epStep = useStore((s) => s.epStep)
  const setReviewEp = useStore((s) => s.setReviewEp)
  const selectCand = useStore((s) => s.selectCand)
  const togglePendingOnly = useStore((s) => s.togglePendingOnly)
  const togglePlay = useStore((s) => s.togglePlay)
  const frameStep = useStore((s) => s.frameStep)
  const adjustIn = useStore((s) => s.adjustIn)
  const adjustOut = useStore((s) => s.adjustOut)
  const toggleCandTag = useStore((s) => s.toggleCandTag)
  const setSnap = useStore((s) => s.setSnap)
  const approve = useStore((s) => s.approve)
  const reject = useStore((s) => s.reject)
  const skip = useStore((s) => s.skip)
  const reopen = useStore((s) => s.reopen)

  const d = dramaById(drama)
  const epList = eps ?? []
  const idx = epList.findIndex((e) => e.n === n)
  const cand = cands.find((c) => c.id === candId) ?? cands[0]

  useEffect(() => {
    const s = useStore.getState()
    const c = s.cands.find((x) => x.id === s.ep.candId)
    if (c) useStore.setState({ ep: { ...s.ep, time: c.in } })
  }, [n])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const s = useStore.getState()
      if (!inReviewDemo(s) || s.panel) return
      const tag = ((e.target as HTMLElement | null)?.tagName ?? '').toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'button') return
      if (e.key === ' ') {
        e.preventDefault()
        s.togglePlay()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        s.frameStep(-1)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        s.frameStep(1)
      } else if (e.key === 'i' || e.key === 'I') {
        s.setInAtPlayhead()
      } else if (e.key === 'o' || e.key === 'O') {
        s.setOutAtPlayhead()
      } else if (e.key === 'Enter') {
        s.approve()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  let line: CandLine | null = null
  for (const l of cand.lines) {
    if (l.t <= time) line = l
  }

  const done = cands.filter((c) => c.status !== 'pending').length
  const approved = cands.filter((c) => c.status === 'approved').length
  const visCands = cands.filter((c) => !pendingOnly || c.status === 'pending')

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <Button size="small" icon={<LeftOutlined />} onClick={reviewBack}>
          返回剧集列表
        </Button>
        <b style={{ fontSize: 15 }}>
          《{d.title}》第 {n} 集 · 候选审核
        </b>
        <span className="dw-spacer" />
        <span className="dw-sub">切换剧集</span>
        <Select
          size="small"
          value={n ?? undefined}
          onChange={setReviewEp}
          style={{ width: 110 }}
          options={epList.map((e) => ({ value: e.n, label: `第 ${e.n} 集` }))}
        />
        <Button size="small" icon={<LeftOutlined />} disabled={idx <= 0} onClick={() => epStep(-1)} aria-label="上一集" />
        <Button size="small" icon={<RightOutlined />} disabled={idx < 0 || idx >= epList.length - 1} onClick={() => epStep(1)} aria-label="下一集" />
      </div>

      {!demo ? (
        <Card>
          <Empty
            image={<InboxOutlined style={{ fontSize: 36, color: '#c3c8d2' }} />}
            description="本集暂无候选（原型演示数据仅包含《闪婚总裁契约妻》第 3 集）"
          >
            <Button type="primary" onClick={gotoDemo}>
              跳到第 3 集演示
            </Button>
          </Empty>
        </Card>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
            <span className="dw-sub">
              候选 {cands.length} · 已审 {done} · 通过 {approved}
            </span>
            <Progress percent={Math.round((done / cands.length) * 100)} size="small" style={{ width: 200, margin: 0 }} />
            <span className="dw-sub">通过即自动切片入高光库</span>
          </div>
          <div className="dw-review-grid">
            <Card
              size="small"
              title="候选列表"
              extra={
                <Button size="small" type={pendingOnly ? 'primary' : 'default'} onClick={togglePendingOnly}>
                  只看待审
                </Button>
              }
              styles={{ body: { padding: 12 } }}
            >
              <div className="dw-cand-list">
                {visCands.length === 0 ? (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="待审候选已全部处理完"
                  >
                    <Button size="small" onClick={togglePendingOnly}>
                      查看全部
                    </Button>
                  </Empty>
                ) : (
                  visCands.map((c) => (
                    <button
                      type="button"
                      key={c.id}
                      className={`dw-cand${c.id === candId ? ' is-active' : ''}${c.status === 'rejected' ? ' is-rejected' : ''}`}
                      onClick={() => selectCand(c.id)}
                      aria-pressed={c.id === candId}
                    >
                      <span className="dw-cand-top">
                        <span className="dw-score">{c.score}</span>
                        <span className="dw-cand-title">{c.title}</span>
                      </span>
                      <span className="dw-cand-meta">
                        {c.status === 'approved' && <Tag color="success">已通过</Tag>}
                        {c.status === 'rejected' && <Tag color="error">已驳回</Tag>}
                        {c.status === 'pending' && <Tag color="warning">待审</Tag>}
                        <span>
                          {fmt(c.in)}–{fmt(c.out)} · {(c.out - c.in).toFixed(1)}s
                        </span>
                        <span>来源 {c.src}</span>
                      </span>
                    </button>
                  ))
                )}
              </div>
            </Card>

            <Card size="small" title={`预览 · 第 ${n} 集`} extra={<span className="dw-sub">9:16 竖屏 · 720p 代理</span>}>
              <div className="dw-player">
                <span className="dw-ptime">{fmt(time)}</span>
                <span className="dw-scene">{cand.scene}</span>
                <span className="dw-subtitle">{line ? <span>{line.txt}</span> : null}</span>
                <button type="button" className="dw-play-overlay" onClick={togglePlay} aria-label="播放 / 暂停">
                  {playing ? <PauseOutlined /> : <CaretRightOutlined />}
                </button>
              </div>
              <Space style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
                <Button size="small" icon={<StepBackwardOutlined />} onClick={() => frameStep(-1)} aria-label="后退一帧" />
                <Button size="small" icon={playing ? <PauseOutlined /> : <CaretRightOutlined />} onClick={togglePlay}>
                  播放 / 暂停
                </Button>
                <Button size="small" icon={<StepForwardOutlined />} onClick={() => frameStep(1)} aria-label="前进一帧" />
                <span className="dw-sub" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {fmt(time)} / {fmt(EP_DUR)}
                </span>
              </Space>
              <div className="dw-tl" aria-label="全集时间轴">
                <div className="dw-tl-track" />
                {SHOTS.map((s) => (
                  <span key={s} className="dw-tl-tick" style={{ left: `${(s / EP_DUR) * 100}%` }} />
                ))}
                <div
                  className="dw-tl-region"
                  style={{ left: `${(cand.in / EP_DUR) * 100}%`, width: `${((cand.out - cand.in) / EP_DUR) * 100}%` }}
                />
                <div className="dw-playhead" style={{ left: `${(time / EP_DUR) * 100}%` }} />
              </div>
              <div className="dw-tl-labels">
                <span>00:00.00</span>
                <span>{fmt(EP_DUR)}</span>
              </div>
              <div className="dw-sub" style={{ textAlign: 'center', marginTop: 4 }}>
                竖线为镜头切分点 · 蓝色为候选区间
              </div>
              <div className="dw-kbd-hint">
                <span className="dw-kbd">Space</span>播放
                <span className="dw-kbd">←</span>
                <span className="dw-kbd">→</span>逐帧
                <span className="dw-kbd">I</span>
                <span className="dw-kbd">O</span>入出点
                <span className="dw-kbd">Enter</span>通过
              </div>
            </Card>

            <Card size="small" title="AI 分析详情" styles={{ body: { padding: '8px 16px 16px' } }}>
              <div className="dw-detail-sec">
                <div className="dw-field-label">AI 评分 · 来源 {cand.src}（A 台词 / B 视频）</div>
                <div className="dw-score-big">
                  <b>{cand.score}</b>
                  <span>/ 100</span>
                </div>
              </div>
              <div className="dw-detail-sec">
                <div className="dw-field-label">评分维度</div>
                {Object.entries(cand.bd).map(([k, v]) => (
                  <div className="dw-bd-row" key={k}>
                    <span>{k}</span>
                    <span className="dw-bd-bar">
                      <i style={{ width: `${v}%` }} />
                    </span>
                    <b>{v}</b>
                  </div>
                ))}
              </div>
              <div className="dw-detail-sec">
                <div className="dw-field-label">AI 理由</div>
                <p className="dw-reason">{cand.reason}</p>
              </div>
              <div className="dw-detail-sec">
                <div className="dw-field-label">标签（点击修改）</div>
                <Space size={4} wrap>
                  {TAGSET.map((t) => (
                    <Tag.CheckableTag key={t} checked={cand.tags.includes(t)} onChange={() => toggleCandTag(t)}>
                      {t}
                    </Tag.CheckableTag>
                  ))}
                </Space>
              </div>
              <div className="dw-detail-sec">
                <div className="dw-field-label">入出点 · 时长 {(cand.out - cand.in).toFixed(1)}s</div>
                <div className="dw-inout">
                  <span className="dw-num-field">
                    {fmt(cand.in)}
                    <span className="dw-steppers">
                      <button type="button" onClick={() => adjustIn(0.04)} aria-label="入点前进一帧">
                        ▲
                      </button>
                      <button type="button" onClick={() => adjustIn(-0.04)} aria-label="入点后退一帧">
                        ▼
                      </button>
                    </span>
                  </span>
                  <span className="dw-sub">→</span>
                  <span className="dw-num-field">
                    {fmt(cand.out)}
                    <span className="dw-steppers">
                      <button type="button" onClick={() => adjustOut(0.04)} aria-label="出点前进一帧">
                        ▲
                      </button>
                      <button type="button" onClick={() => adjustOut(-0.04)} aria-label="出点后退一帧">
                        ▼
                      </button>
                    </span>
                  </span>
                </div>
                <Space style={{ marginTop: 8 }}>
                  <Switch size="small" checked={snap} onChange={setSnap} />
                  <span className="dw-sub">入库时吸附最近镜头边界</span>
                </Space>
              </div>
              <div className="dw-detail-sec">
                <div className="dw-field-label">台词转录（bcut · 句级时间戳）</div>
                <div className="dw-lines">
                  {cand.lines.map((l) => (
                    <span key={l.t} className={`dw-line${line === l ? ' is-now' : ''}`}>
                      <b>{fmt(l.t)}</b>
                      {l.txt}
                    </span>
                  ))}
                </div>
              </div>
              <div className="dw-detail-sec">
                {cand.status === 'pending' ? (
                  <Space wrap>
                    <Button type="primary" icon={<CheckOutlined />} onClick={approve}>
                      通过入库
                    </Button>
                    <Button danger icon={<CloseOutlined />} onClick={reject}>
                      驳回
                    </Button>
                    <Button onClick={skip}>跳过</Button>
                  </Space>
                ) : (
                  <Space wrap>
                    <Tag color={cand.status === 'approved' ? 'success' : 'error'}>
                      {cand.status === 'approved' ? '已通过入库' : '已驳回'}
                    </Tag>
                    <Button size="small" icon={<ReloadOutlined />} onClick={reopen}>
                      重新审核
                    </Button>
                  </Space>
                )}
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}