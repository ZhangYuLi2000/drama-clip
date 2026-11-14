import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactElement } from 'react'
import {
  CaretRightOutlined,
  CheckOutlined,
  CloseOutlined,
  InboxOutlined,
  LeftOutlined,
  LoadingOutlined,
  MutedOutlined,
  PauseOutlined,
  ReloadOutlined,
  RightOutlined,
  SoundOutlined,
  StepBackwardOutlined,
  StepForwardOutlined
} from '@ant-design/icons'
import { Alert, Button, Card, Empty, Progress, Select, Slider, Space, Switch, Tag, Tooltip } from 'antd'
import type { AsrSegment } from '../../../shared/types'
import { findDrama, mediaUrl, useLibrary } from '../library'
import { TAGSET, fmt } from '../mock/data'
import type { CandLine } from '../mock/data'
import { useStore } from '../store'

export default function Review(): ReactElement {
  const drama = useStore((s) => s.ep.drama)
  const n = useStore((s) => s.ep.review)
  const cands = useStore((s) => s.cands)
  const candId = useStore((s) => s.ep.candId)
  const pendingOnly = useStore((s) => s.ep.pendingOnly)
  const time = useStore((s) => s.ep.time)
  const playing = useStore((s) => s.ep.playing)
  const snap = useStore((s) => s.ep.snap)
  const pendingSeek = useStore((s) => s.ep.pendingSeek)
  const dramas = useLibrary((s) => s.dramas)
  const reviewBack = useStore((s) => s.reviewBack)
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

  const videoRef = useRef<HTMLVideoElement>(null)
  const tlRef = useRef<HTMLDivElement>(null)
  const scrubRef = useRef<{ wasPlaying: boolean } | null>(null)
  const [videoErr, setVideoErr] = useState(false)
  const [buffering, setBuffering] = useState(false)
  const [rate, setRate] = useState(1)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [hoverT, setHoverT] = useState<number | null>(null)

  const d = findDrama(dramas, drama)
  const epList = d?.episodes ?? []
  const idx = epList.findIndex((e) => e.n === n)
  const ep = idx >= 0 ? epList[idx] : undefined
  const dur = ep?.duration ?? 0
  const cand = cands.find((c) => c.id === candId) ?? cands[0]
  const segments = ep?.segments ?? []
  const shots = ep?.shots ?? []

  useEffect(() => {
    setVideoErr(false)
    setBuffering(false)
    setHoverT(null)
    scrubRef.current = null
    const s = useStore.getState()
    const t = s.ep.pendingSeek ?? 0
    const v = videoRef.current
    if (v) {
      try {
        v.currentTime = t
      } catch {
        // metadata 未就绪时由 onLoadedMetadata 兜底
      }
    }
    useStore.setState({ ep: { ...s.ep, time: t, pendingSeek: null, playing: false } })
  }, [n, drama])

  useEffect(() => {
    if (pendingSeek === null) return
    const v = videoRef.current
    if (v) {
      try {
        v.currentTime = pendingSeek
      } catch {
        // ignore
      }
    }
    useStore.setState((s) => ({ ep: { ...s.ep, time: pendingSeek, pendingSeek: null, playing: false } }))
  }, [pendingSeek])

  useEffect(() => {
    const s = useStore.getState()
    const c = s.cands.find((x) => x.id === candId)
    const v = videoRef.current
    if (c && v) {
      try {
        v.currentTime = c.in
      } catch {
        // ignore
      }
    }
  }, [candId])

  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    if (playing) {
      const s = useStore.getState()
      const c = s.cands.find((x) => x.id === s.ep.candId)
      if (c && v.currentTime >= c.out - 0.05) {
        try {
          v.currentTime = c.in
        } catch {
          // ignore
        }
      }
      void v.play().catch(() => {
        useStore.setState((st) => ({ ep: { ...st.ep, playing: false } }))
      })
    } else {
      v.pause()
    }
  }, [playing])

  useEffect(() => {
    if (!playing) return
    let raf = 0
    const tick = (): void => {
      const v = videoRef.current
      const s = useStore.getState()
      if (!v || !s.ep.playing) return
      const c = s.cands.find((x) => x.id === s.ep.candId)
      if (c && v.currentTime >= c.out) {
        useStore.setState((st) => ({ ep: { ...st.ep, time: c.out, playing: false } }))
        return
      }
      if (Math.abs(v.currentTime - s.ep.time) > 0.02) {
        useStore.setState((st) => ({ ep: { ...st.ep, time: v.currentTime } }))
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing])

  useEffect(() => {
    if (playing) return
    const v = videoRef.current
    if (!v) return
    if (Math.abs(v.currentTime - time) > 0.04) {
      try {
        v.currentTime = time
      } catch {
        // ignore
      }
    }
  }, [time, playing])

  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    v.playbackRate = rate
    v.volume = volume
    v.muted = muted
  }, [rate, volume, muted, n, drama])

  const timeAtPointer = (clientX: number): number => {
    const el = tlRef.current
    if (!el || dur <= 0) return 0
    const r = el.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (clientX - r.left) / r.width))
    return ratio * dur
  }

  const seekTo = (t: number): void => {
    const v = videoRef.current
    if (v) {
      try {
        v.currentTime = t
      } catch {
        // ignore
      }
    }
    useStore.setState((s) => ({ ep: { ...s.ep, time: t } }))
  }

  const onTlPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (dur <= 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const s = useStore.getState()
    scrubRef.current = { wasPlaying: s.ep.playing }
    if (s.ep.playing) useStore.setState((st) => ({ ep: { ...st.ep, playing: false } }))
    seekTo(timeAtPointer(e.clientX))
  }

  const onTlPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (dur <= 0) return
    const t = timeAtPointer(e.clientX)
    setHoverT(t)
    if (scrubRef.current) seekTo(t)
  }

  const onTlPointerUp = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const scrub = scrubRef.current
    if (!scrub) return
    scrubRef.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    if (scrub.wasPlaying) useStore.setState((st) => ({ ep: { ...st.ep, playing: true } }))
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.isComposing || e.keyCode === 229) return
      const s = useStore.getState()
      if (s.screen !== 'episodes' || s.ep.review === null || s.panel) return
      const target = e.target as HTMLElement | null
      const tag = (target?.tagName ?? '').toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'button' || target?.getAttribute('role') === 'slider') return
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

  let line: AsrSegment | null = null
  for (const seg of segments) {
    if (seg.start <= time && time < seg.end) line = seg
  }

  const candLines: CandLine[] = cand
    ? segments
        .filter((sg) => sg.start >= cand.in - 0.5 && sg.start <= cand.out)
        .map((sg) => ({ t: sg.start, txt: sg.text }))
    : []

  const done = cands.filter((c) => c.status !== 'pending').length
  const approved = cands.filter((c) => c.status === 'approved').length
  const visCands = cands.filter((c) => !pendingOnly || c.status === 'pending')

  if (!ep) {
    return (
      <Card>
        <Empty
          image={<InboxOutlined style={{ fontSize: 36, color: '#c3c8d2' }} />}
          description="未找到该剧集，可能已被移除"
        >
          <Button type="primary" onClick={reviewBack}>
            返回剧集列表
          </Button>
        </Empty>
      </Card>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <Button size="small" icon={<LeftOutlined />} onClick={reviewBack}>
          返回剧集列表
        </Button>
        <b style={{ fontSize: 15 }}>
          《{d?.title ?? ''}》第 {n} 集 · {cands.length > 0 ? '候选审核' : '剧集预览'}
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

      {cands.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
          <span className="dw-sub">
            候选 {cands.length} · 已审 {done} · 通过 {approved}
          </span>
          <Progress percent={Math.round((done / cands.length) * 100)} size="small" style={{ width: 200, margin: 0 }} />
          <span className="dw-sub">通过即自动切片入高光库</span>
        </div>
      )}

      <div className="dw-review-grid">
        <Card
          size="small"
          title="候选列表"
          extra={
            <Button
              size="small"
              type={pendingOnly ? 'primary' : 'default'}
              onClick={togglePendingOnly}
              disabled={cands.length === 0}
            >
              只看待审
            </Button>
          }
          styles={{ body: { padding: 12 } }}
        >
          <div className="dw-cand-list">
            {cands.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="本集暂无候选。到剧集列表点「视频理解」跑 B 路分析；A 路台词评分下一阶段接入。"
              />
            ) : visCands.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="待审候选已全部处理完">
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

        <Card size="small" title={`预览 · 第 ${n} 集`} extra={<span className="dw-sub">本地原片 · 实时播放</span>}>
          {videoErr && (
            <Alert
              type="error"
              showIcon
              style={{ marginBottom: 8 }}
              message="视频加载失败"
              description="请确认原文件仍在导入时的位置，或重新导入该剧。"
            />
          )}
          <div className="dw-player">
            <video
              key={ep.id}
              ref={videoRef}
              src={mediaUrl(ep.file)}
              width={320}
              height={569}
              preload="metadata"
              playsInline
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                objectFit: 'contain',
                background: '#000',
                cursor: 'pointer'
              }}
              onClick={togglePlay}
              onLoadedMetadata={(e) => {
                const v = e.currentTarget
                v.playbackRate = rate
                v.volume = volume
                v.muted = muted
                try {
                  v.currentTime = useStore.getState().ep.time
                } catch {
                  // ignore
                }
              }}
              onWaiting={() => setBuffering(true)}
              onPlaying={() => setBuffering(false)}
              onCanPlay={() => setBuffering(false)}
              onEnded={() => {
                const v = videoRef.current
                useStore.setState((s) => ({ ep: { ...s.ep, playing: false, time: v?.duration ?? s.ep.time } }))
              }}
              onError={() => setVideoErr(true)}
            />
            {buffering && !videoErr && (
              <span className="dw-buffering" aria-label="缓冲中">
                <LoadingOutlined spin />
              </span>
            )}
            <span className="dw-ptime">{fmt(time)}</span>
            <span className="dw-subtitle">{line ? <span>{line.text}</span> : null}</span>
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
              {fmt(time)} / {fmt(dur)}
            </span>
          </Space>
          <Space style={{ display: 'flex', justifyContent: 'center', marginTop: 8 }} size={8}>
            <Select
              size="small"
              value={rate}
              onChange={setRate}
              style={{ width: 78 }}
              options={[0.5, 0.75, 1, 1.25, 1.5, 2].map((r) => ({ value: r, label: `${r}x 倍速` }))}
              aria-label="播放速度"
            />
            <Button
              size="small"
              type="text"
              icon={muted || volume === 0 ? <MutedOutlined /> : <SoundOutlined />}
              onClick={() => setMuted(!muted)}
              aria-label="静音切换"
            />
            <Slider
              style={{ width: 72, margin: '0 4px' }}
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              onChange={(v: number) => {
                setVolume(v)
                setMuted(v === 0)
              }}
              ariaLabelForHandle="音量"
            />
          </Space>
          {dur > 0 && (
            <>
              <div
                className="dw-tl"
                ref={tlRef}
                role="slider"
                tabIndex={0}
                aria-label="全集时间轴，点击或拖动定位"
                aria-valuemin={0}
                aria-valuemax={Math.round(dur)}
                aria-valuenow={Math.round(time)}
                aria-valuetext={fmt(time)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowLeft') {
                    e.preventDefault()
                    seekTo(Math.max(0, time - (e.shiftKey ? 5 : 1)))
                  } else if (e.key === 'ArrowRight') {
                    e.preventDefault()
                    seekTo(Math.min(dur, time + (e.shiftKey ? 5 : 1)))
                  } else if (e.key === 'Home') {
                    e.preventDefault()
                    seekTo(0)
                  } else if (e.key === 'End') {
                    e.preventDefault()
                    seekTo(dur)
                  }
                }}
                onPointerDown={onTlPointerDown}
                onPointerMove={onTlPointerMove}
                onPointerUp={onTlPointerUp}
                onPointerCancel={onTlPointerUp}
                onPointerLeave={() => {
                  if (!scrubRef.current) setHoverT(null)
                }}
              >
                <div className="dw-tl-track" />
                {(shots.length > 0 ? shots : segments.map((sg) => sg.start)).slice(0, 300).map((t, i) => (
                  <span key={i} className="dw-tl-tick" style={{ left: `${(t / dur) * 100}%` }} />
                ))}
                {cand && (
                  <div
                    className="dw-tl-region"
                    style={{ left: `${(cand.in / dur) * 100}%`, width: `${((cand.out - cand.in) / dur) * 100}%` }}
                  />
                )}
                <div className="dw-playhead" style={{ left: `${Math.min(100, (time / dur) * 100)}%` }} />
                {hoverT !== null && (
                  <span className="dw-tl-tip" style={{ left: `${Math.min(100, (hoverT / dur) * 100)}%` }}>
                    {fmt(hoverT)}
                  </span>
                )}
              </div>
              <div className="dw-tl-labels">
                <span>00:00.00</span>
                <span>{fmt(dur)}</span>
              </div>
              <div className="dw-sub" style={{ textAlign: 'center', marginTop: 4 }}>
                {shots.length > 0 ? '竖线为镜头边界' : '竖线为转写句边界'} · 蓝色为候选区间 · 点击/拖动定位
              </div>
            </>
          )}
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
          {!cand ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="暂无候选。先在「设置」配置 API，再到剧集列表对该集执行「视频理解」。"
            />
          ) : (
            <>
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
              {cand.quote && (
                <div className="dw-detail-sec">
                  <div className="dw-field-label">金句{cand.conflict ? ` · ${cand.conflict}` : ''}</div>
                  <p className="dw-reason">“{cand.quote}”</p>
                </div>
              )}
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
                  <Tooltip title="通过入库时把入出点对齐到最近镜头切换点（±0.75 秒内才吸，落在台词中间则不吸）">
                    <Switch size="small" checked={snap} onChange={setSnap} />
                  </Tooltip>
                  <span className="dw-sub">
                    入库时吸附最近镜头边界{shots.length > 0 ? `（已检测 ${shots.length} 个）` : '（未检测，重新扫描可补）'}
                  </span>
                </Space>
              </div>
              <div className="dw-detail-sec">
                <div className="dw-field-label">台词转录（句级时间戳）</div>
                <div className="dw-lines">
                  {candLines.length === 0 ? (
                    <span className="dw-sub">该区间暂无转写台词，先对剧集执行转写。</span>
                  ) : (
                    candLines.map((l) => (
                      <span key={l.t} className={`dw-line${line !== null && line.start === l.t ? ' is-now' : ''}`}>
                        <b>{fmt(l.t)}</b>
                        {l.txt}
                      </span>
                    ))
                  )}
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
            </>
          )}
        </Card>
      </div>
    </div>
  )
}