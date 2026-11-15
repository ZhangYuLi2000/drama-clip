import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import {
  CaretRightOutlined,
  DeleteOutlined,
  FolderOpenOutlined,
  ImportOutlined,
  MutedOutlined,
  PauseOutlined,
  PlusOutlined,
  ReloadOutlined,
  SoundOutlined,
  StopOutlined,
  ThunderboltOutlined
} from '@ant-design/icons'
import {
  Alert,
  Button,
  Collapse,
  Empty,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Progress,
  Segmented,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tag
} from 'antd'
import type { CreateReplicaParams, Drama, ReplicaEdlRow, ReplicaTask } from '../../../shared/types'
import { fmtSec, mediaUrl, useLibrary } from '../library'
import { toast, useStore } from '../store'
import { CRF_TIP, ParamTip, RADIUS_TIP } from '../paramTips'
import TimelineScrubber from '../TimelineScrubber'

const STATUS_LABEL: Record<ReplicaTask['status'], string> = {
  queue: '排队中',
  indexing: '建索引',
  tracing: '溯源中',
  cutting: '重剪中',
  ready: '可导出',
  fail: '失败'
}

const KIND_COLOR: Record<string, string> = {
  continuous: '#3b82f6',
  still: '#a855f7',
  gap: '#52525b'
}

const KIND_LABEL: Record<string, string> = {
  continuous: '连续',
  still: '静帧',
  gap: '无出处'
}

// ---------------------------------------------------------------- 导入弹窗

export function NewReplicaModal({ d, open, onClose }: { d: Drama; open: boolean; onClose: () => void }): ReactElement {
  const createReplica = useLibrary((s) => s.createReplica)
  const selectVideoFile = useLibrary((s) => s.selectVideoFile)
  const settings = useLibrary((s) => s.settings)
  const selectReplica = useStore((s) => s.selectReplica)
  const rs = settings?.replica

  const [clipFile, setClipFile] = useState('')
  const [title, setTitle] = useState('')
  const [audio, setAudio] = useState<'source' | 'clip' | 'none'>('source')
  const [indexFps, setIndexFps] = useState(12)
  const [crf, setCrf] = useState(16)
  const [despike, setDespike] = useState(true)
  const [refine, setRefine] = useState(true)
  const [boundsRadius, setBoundsRadius] = useState(6)
  const [maskTop, setMaskTop] = useState(0.08)
  const [maskBottom, setMaskBottom] = useState(0.28)
  const [maskBand, setMaskBand] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open && rs) {
      setAudio(rs.audio)
      setIndexFps(rs.indexFps)
      setCrf(rs.crf)
      setDespike(rs.despike)
      setRefine(rs.refine)
      setBoundsRadius(rs.boundsRadius)
      setMaskTop(rs.maskTop)
      setMaskBottom(rs.maskBottom)
      setMaskBand(rs.maskBand)
    }
  }, [open, rs])

  const pickFile = (): void => {
    selectVideoFile()
      .then((r) => {
        if (!r.canceled && r.file) {
          setClipFile(r.file)
          if (!title.trim()) {
            const base = r.file.replace(/\\/g, '/').split('/').pop() ?? ''
            setTitle(base.replace(/\.[^.]+$/, ''))
          }
        }
      })
      .catch(() => toast('选择文件失败', 'info'))
  }

  const submit = (): void => {
    if (!clipFile) {
      toast('请先选择爆款切片视频', 'info')
      return
    }
    const params: CreateReplicaParams = {
      clipFile,
      clipTitle: title.trim() || undefined,
      audio,
      crf,
      despike,
      refine,
      boundsRadius,
      indexFps,
      maskTop,
      maskBottom,
      maskBand
    }
    setBusy(true)
    createReplica(d.id, params)
      .then((r) => {
        toast('已加入爆款复刻队列（无需全局分析，直接用原剧集重剪）')
        selectReplica(r.replicaId)
        setClipFile('')
        setTitle('')
        onClose()
      })
      .catch((e: unknown) => toast(e instanceof Error ? e.message : '发起失败', 'info'))
      .finally(() => setBusy(false))
  }

  return (
    <Modal
      title="导入爆款切片 · 用本剧原片复刻干净成片"
      open={open}
      onCancel={onClose}
      onOk={submit}
      okText="开始复刻"
      cancelText="取消"
      confirmLoading={busy}
      width={600}
    >
      <div className="dw-field-label">爆款切片视频</div>
      <Space.Compact block style={{ marginBottom: 12 }}>
        <Input value={clipFile} readOnly placeholder="选择要复刻的爆款视频（mp4/mov/mkv…）" />
        <Button icon={<FolderOpenOutlined />} onClick={pickFile}>
          选择文件
        </Button>
      </Space.Compact>
      <div className="dw-field-label">任务名称</div>
      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="默认使用文件名"
        style={{ marginBottom: 12 }}
      />
      <div className="dw-field-grid is-compact">
        <div className="dw-field">
          <span className="dw-field-label">音轨</span>
          <div className="dw-field-control">
            <Select
              value={audio}
              onChange={setAudio}
              options={[
                { value: 'source', label: '原剧集对白原声' },
                { value: 'clip', label: '切片解说音' },
                { value: 'none', label: '无声' }
              ]}
            />
          </div>
        </div>
        <div className="dw-field">
          <span className="dw-field-label">索引精度</span>
          <div className="dw-field-control">
            <Select
              value={indexFps}
              onChange={setIndexFps}
              options={[
                { value: 8, label: '8fps · 快速' },
                { value: 12, label: '12fps · 精准' },
                { value: 24, label: '24fps · 极致' }
              ]}
            />
          </div>
        </div>
      </div>
      <Collapse
        size="small"
        items={[
          {
            key: 'adv',
            label: '高级参数（字幕带遮罩 / 画质 / 去抖与精修）',
            children: (
              <div className="dw-field-grid is-compact">
                <div className="dw-field">
                  <span className="dw-field-label">顶部遮罩</span>
                  <div className="dw-field-control">
                    <InputNumber min={0} max={0.75} step={0.01} value={maskTop} onChange={(v) => setMaskTop(v ?? 0)} />
                  </div>
                  <span className="dw-field-hint">台标/角标</span>
                </div>
                <div className="dw-field">
                  <span className="dw-field-label">底部遮罩</span>
                  <div className="dw-field-control">
                    <InputNumber min={0} max={0.75} step={0.01} value={maskBottom} onChange={(v) => setMaskBottom(v ?? 0.25)} />
                  </div>
                  <span className="dw-field-hint">字幕带</span>
                </div>
                <div className="dw-field">
                  <span className="dw-field-label">中部字幕带</span>
                  <div className="dw-field-control">
                    <Input value={maskBand} onChange={(e) => setMaskBand(e.target.value)} placeholder="如 0.63,0.78" />
                  </div>
                  <span className="dw-field-hint">留空则不遮罩</span>
                </div>
                <div className="dw-field">
                  <span className="dw-field-label">
                    画质 CRF
                    <ParamTip tip={CRF_TIP} />
                  </span>
                  <div className="dw-field-control">
                    <InputNumber min={10} max={28} value={crf} onChange={(v) => setCrf(v ?? 16)} />
                  </div>
                  <span className="dw-field-hint">越低越接近原画质</span>
                </div>
                <div className="dw-field">
                  <span className="dw-field-label">去量化平滑</span>
                  <div className="dw-field-control">
                    <Switch checked={despike} onChange={setDespike} />
                  </div>
                  <span className="dw-field-hint">抑制 0/2 抖动</span>
                </div>
                <div className="dw-field">
                  <span className="dw-field-label">边界精修</span>
                  <div className="dw-field-control">
                    <Switch checked={refine} onChange={setRefine} />
                  </div>
                  <span className="dw-field-hint">±N 帧吸附</span>
                </div>
                <div className="dw-field">
                  <span className="dw-field-label">
                    精修半径
                    <ParamTip tip={RADIUS_TIP} />
                  </span>
                  <div className="dw-field-control">
                    <InputNumber min={0} max={16} value={boundsRadius} onChange={(v) => setBoundsRadius(v ?? 6)} />
                  </div>
                  <span className="dw-field-hint">单位：帧</span>
                </div>
              </div>
            )
          }
        ]}
      />
      <p className="dw-sub" style={{ marginTop: 12, marginBottom: 0 }}>
        逐帧溯源爆款画面出自本剧哪一集哪一帧，再用原片原画幅、原生帧率、原声对白重剪出干净成片（无水印/无字幕/无镜像）。
      </p>
    </Modal>
  )
}

// ---------------------------------------------------------------- 工作区

function ReplicaWorkspace({ d, task }: { d: Drama; task: ReplicaTask }): ReactElement {
  const retryReplica = useLibrary((s) => s.retryReplica)
  const recutReplica = useLibrary((s) => s.recutReplica)
  const deleteReplica = useLibrary((s) => s.deleteReplica)
  const openReplicaOutput = useLibrary((s) => s.openReplicaOutput)
  const getReplicaEdl = useLibrary((s) => s.getReplicaEdl)
  const stopTasks = useLibrary((s) => s.stopTasks)
  const selectReplica = useStore((s) => s.selectReplica)

  const videoRef = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const [t, setT] = useState(0)
  const [dur, setDur] = useState(0)
  const [muted, setMuted] = useState(false)
  const [videoErr, setVideoErr] = useState(false)
  const [view, setView] = useState<'output' | 'clip'>('output')
  const [edl, setEdl] = useState<ReplicaEdlRow[]>([])
  const [recutAudio, setRecutAudio] = useState(task.audio)
  const [recutCrf, setRecutCrf] = useState(task.crf)
  const [recutDespike, setRecutDespike] = useState(task.despike)
  const [recutRefine, setRecutRefine] = useState(task.refine)
  const [recutRadius, setRecutRadius] = useState(task.boundsRadius)
  const [busy, setBusy] = useState(false)

  const running = task.status === 'queue' || task.status === 'indexing' || task.status === 'tracing' || task.status === 'cutting'
  const ready = task.status === 'ready' && Boolean(task.output)

  useEffect(() => {
    setPlaying(false)
    setT(0)
    setDur(0)
    setVideoErr(false)
    setView('output')
    setRecutAudio(task.audio)
    setRecutCrf(task.crf)
    setRecutDespike(task.despike)
    setRecutRefine(task.refine)
    setRecutRadius(task.boundsRadius)
  }, [task.id, task.output, task.audio, task.crf, task.despike, task.refine, task.boundsRadius])

  useEffect(() => {
    if (task.edlPath && ready) {
      getReplicaEdl(d.id, task.id)
        .then(setEdl)
        .catch(() => setEdl([]))
    } else {
      setEdl([])
    }
  }, [d.id, task.id, task.edlPath, ready, getReplicaEdl])

  const src = view === 'output' ? task.output : task.clipFile
  const playable = !videoErr && Boolean(src) && (view === 'clip' || ready)

  const togglePlay = (): void => {
    const v = videoRef.current
    if (!v) return
    if (playing) v.pause()
    else void v.play().catch(() => setVideoErr(true))
  }

  const totalSec = edl.reduce((s, x) => s + x.seconds, 0)
  const edlSegments = useMemo(
    () =>
      edl.map((s) => ({
        key: s.segmentId,
        label: KIND_LABEL[s.kind] ?? '片段',
        color: KIND_COLOR[s.kind] ?? '#52525b',
        seconds: s.seconds,
        title: `段${s.segmentId} · ${s.episode || '无出处'} · 原片 ${s.srcInTc || '—'} → ${s.srcOutTc || '—'} · ${fmtSec(s.seconds)}`
      })),
    [edl]
  )

  const hasEdlTimeline = view === 'output' && edl.length > 0
  // 原爆款切片 / EDL 尚未加载时也保留一个可拖拽的单段轴，避免切回原片后失去定位能力。
  const timelineTotal = hasEdlTimeline ? totalSec : dur || task.stats?.totalSeconds || 1
  const timelineSegments = useMemo(
    () =>
      hasEdlTimeline
        ? edlSegments
        : [{
            key: `single-${view}`,
            label: view === 'clip' ? '原爆款切片' : '复刻成片',
            color: '#3b82f6',
            seconds: timelineTotal
          }],
    [hasEdlTimeline, edlSegments, view, timelineTotal]
  )

  const doRecut = (): void => {
    setBusy(true)
    recutReplica(d.id, task.id, {
      audio: recutAudio,
      crf: recutCrf,
      despike: recutDespike,
      refine: recutRefine,
      boundsRadius: recutRadius
    })
      .then(() => toast('已加入重剪队列（复用溯源结果，无需重新检索）'))
      .catch((e: unknown) => toast(e instanceof Error ? e.message : '重剪失败', 'info'))
      .finally(() => setBusy(false))
  }

  const stageText =
    task.status === 'indexing' ? '建立指纹索引' :
    task.status === 'tracing' ? '逐帧溯源' :
    task.status === 'cutting' ? '按原片重剪' : '排队等待'

  return (
    <>
      <section className="dw-stage" aria-label="复刻监视器">
        <div className="dw-panel-head" style={{ marginBottom: 0 }}>
          <Space size={8}>
            <span className="dw-panel-title">{task.clipTitle}</span>
            <Tag color={ready ? 'success' : running ? 'processing' : task.status === 'fail' ? 'error' : 'default'} style={{ marginInlineEnd: 0 }}>
              {STATUS_LABEL[task.status]}
              {running ? ` ${task.pct}%` : ''}
            </Tag>
          </Space>
          <Segmented
            size="small"
            value={view}
            onChange={(v) => {
              setView(v as 'output' | 'clip')
              setT(0)
              setPlaying(false)
            }}
            options={[
              { value: 'output', label: '复刻成片', disabled: !ready },
              { value: 'clip', label: '原爆款切片' }
            ]}
          />
        </div>

        <div className="dw-player">
          {playable ? (
            <>
              <video
                key={`${src}-${view}`}
                ref={videoRef}
                src={mediaUrl(src!)}
                preload="metadata"
                playsInline
                muted={muted}
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
                onLoadedMetadata={(e) => setDur(e.currentTarget.duration)}
                onTimeUpdate={(e) => setT(e.currentTarget.currentTime)}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onEnded={() => setPlaying(false)}
                onError={() => setVideoErr(true)}
              />
              <button type="button" className="dw-play-overlay" onClick={togglePlay} aria-label={playing ? '暂停' : '播放'}>
                {playing ? <PauseOutlined /> : <CaretRightOutlined />}
              </button>
            </>
          ) : (
            <div className="dw-player-empty">
              {running ? (
                <>
                  <Spin />
                  <span className="dw-sub" style={{ color: '#e4e4e7' }}>
                    {stageText} {task.pct}%…
                  </span>
                  <Progress percent={task.pct} size="small" style={{ width: '78%' }} showInfo={false} />
                  {task.stageNote && <span className="dw-sub dw-mono">{task.stageNote}</span>}
                  <Button
                    size="small"
                    danger
                    icon={<StopOutlined />}
                    onClick={() =>
                      stopTasks(d.id)
                        .then(() => toast('已终止复刻任务', 'info'))
                        .catch(() => toast('终止失败', 'info'))
                    }
                  >
                    终止任务
                  </Button>
                </>
              ) : (
                <>
                  <span className="dw-sub">{task.error || '成片尚未生成'}</span>
                  <Button size="small" type="primary" icon={<ReloadOutlined />} onClick={() => retryReplica(d.id, task.id)}>
                    重试复刻
                  </Button>
                </>
              )}
            </div>
          )}
        </div>

        {playable && (
          <div className="dw-transport" role="group" aria-label="播放控制">
            <Button
              size="small"
              type="text"
              icon={playing ? <PauseOutlined /> : <CaretRightOutlined />}
              onClick={togglePlay}
              aria-label={playing ? '暂停' : '播放'}
            />
            <span className="dw-timecode">
              {fmtSec(t)} / {fmtSec(dur || task.stats?.totalSeconds || 0)}
            </span>
            <span className="dw-spacer" />
            <span className="dw-sub">拖动下方时间轴定位</span>
            <Button
              size="small"
              type="text"
              icon={muted ? <MutedOutlined /> : <SoundOutlined />}
              onClick={() => setMuted(!muted)}
              aria-label={muted ? '取消静音' : '静音'}
              aria-pressed={muted}
            />
          </div>
        )}

        {playable && (
          <div>
            <div className="dw-sec-title" style={{ marginBottom: 6 }}>
              {hasEdlTimeline ? '复刻结构时间轴' : view === 'clip' ? '原切片时间轴' : '复刻成片时间轴'}
              <span className="dw-tl-hint">
                {hasEdlTimeline
                  ? `共 ${edl.length} 段 · 蓝=连续 / 紫=静帧 / 灰=无出处 · 拖动或点击定位`
                  : '拖动或点击定位'}
              </span>
            </div>
            <TimelineScrubber
              ariaLabel={hasEdlTimeline ? '复刻结构时间轴，拖动定位播放进度' : '视频时间轴，拖动定位播放进度'}
              duration={timelineTotal}
              value={Math.min(t, timelineTotal)}
              segments={timelineSegments}
              onChange={(v: number) => {
                if (videoRef.current) videoRef.current.currentTime = v
                setT(v)
              }}
            />
          </div>
        )}
      </section>

      <aside className="dw-inspector" aria-label="复刻详情与交付">
        {task.stats && (
          <div className="dw-panel">
            <div className="dw-panel-head">
              <span className="dw-panel-title">溯源与成片概览</span>
            </div>
            <Space wrap size={[6, 6]}>
              <Tag>{task.stats.segments} 段</Tag>
              <Tag color="blue">连续 {task.stats.continuous}</Tag>
              <Tag color="purple">静帧 {task.stats.still}</Tag>
              <Tag>无出处 {task.stats.gap}</Tag>
              <Tag className="dw-mono">{fmtSec(task.stats.totalSeconds)}</Tag>
              <Tag className="dw-mono">{task.stats.resolution}</Tag>
              <Tag className="dw-mono">{task.stats.fps}fps 原生</Tag>
              <Tag color={task.stats.coverage >= 0.9 ? 'success' : 'warning'}>
                覆盖 {(task.stats.coverage * 100).toFixed(1)}%
              </Tag>
            </Space>
            {task.stats.coverage < 0.9 && (
              <p className="dw-sub" style={{ marginTop: 8, marginBottom: 0 }}>
                覆盖率偏低：部分画面不在本剧素材中（片头/自绘卡），已以黑场占位。
              </p>
            )}
          </div>
        )}

        <div className="dw-panel">
          <div className="dw-panel-head">
            <span className="dw-panel-title">重剪参数（复用溯源，秒级发起）</span>
          </div>
          <div className="dw-field-grid is-compact">
            <div className="dw-field">
              <span className="dw-field-label">音轨</span>
              <div className="dw-field-control">
                <Select
                  value={recutAudio}
                  onChange={setRecutAudio}
                  options={[
                    { value: 'source', label: '原剧对白原声' },
                    { value: 'clip', label: '切片解说音' },
                    { value: 'none', label: '无声' }
                  ]}
                />
              </div>
            </div>
            <div className="dw-field">
              <span className="dw-field-label">
                CRF
                <ParamTip tip={CRF_TIP} />
              </span>
              <div className="dw-field-control">
                <InputNumber min={10} max={28} value={recutCrf} onChange={(v) => setRecutCrf(v ?? 16)} />
              </div>
            </div>
            <div className="dw-field">
              <span className="dw-field-label">去抖</span>
              <div className="dw-field-control">
                <Switch checked={recutDespike} onChange={setRecutDespike} />
              </div>
            </div>
            <div className="dw-field">
              <span className="dw-field-label">精修</span>
              <div className="dw-field-control">
                <Switch checked={recutRefine} onChange={setRecutRefine} />
              </div>
            </div>
            <div className="dw-field">
              <span className="dw-field-label">
                半径
                <ParamTip tip={RADIUS_TIP} />
              </span>
              <div className="dw-field-control">
                <InputNumber min={0} max={16} value={recutRadius} onChange={(v) => setRecutRadius(v ?? 6)} />
              </div>
            </div>
          </div>
          <Button
            block
            type="primary"
            icon={<ThunderboltOutlined />}
            style={{ marginTop: 10 }}
            loading={busy}
            disabled={running || !task.tracePath}
            onClick={doRecut}
          >
            仅重剪（不重新溯源）
          </Button>
        </div>

        <div className="dw-panel">
          <div className="dw-panel-head">
            <span className="dw-panel-title">EDL 片段明细</span>
            <span className="dw-sub dw-mono">{edl.length} 段</span>
          </div>
          <Table
            size="small"
            rowKey="segmentId"
            pagination={false}
            scroll={{ y: 300 }}
            dataSource={edl}
            columns={[
              { title: '#', dataIndex: 'segmentId', width: 36 },
              { title: '集', dataIndex: 'episode', width: 50, render: (v: string) => v || '—' },
              {
                title: '原片入出帧',
                width: 110,
                render: (_: unknown, r: ReplicaEdlRow) =>
                  r.srcIn >= 0 ? <span className="dw-mono">{r.srcIn}–{r.srcOut}</span> : '—'
              },
              {
                title: '类型',
                dataIndex: 'kind',
                width: 58,
                render: (v: string) => <Tag color={KIND_COLOR[v]} style={{ marginInlineEnd: 0 }}>{KIND_LABEL[v] ?? v}</Tag>
              },
              { title: '时长', dataIndex: 'seconds', width: 84, render: (v: number) => fmtSec(v) }
            ]}
          />
        </div>

        <div className="dw-panel" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Button
            icon={<FolderOpenOutlined />}
            disabled={!task.output}
            onClick={() => openReplicaOutput(task.output!)}
          >
            打开成片目录
          </Button>
          <Popconfirm
            title="删除该复刻任务？"
            description="成片与溯源产物将一并删除"
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={() =>
              deleteReplica(d.id, task.id)
                .then(() => {
                  selectReplica(null)
                  toast('已删除复刻任务', 'info')
                })
                .catch((e: unknown) => toast(e instanceof Error ? e.message : '删除失败', 'info'))
            }
          >
            <Button danger icon={<DeleteOutlined />} disabled={running}>
              删除任务
            </Button>
          </Popconfirm>
        </div>
      </aside>
    </>
  )
}

// ---------------------------------------------------------------- 面板

export default function ReplicaPanel({ d, onImport }: { d: Drama; onImport: () => void }): ReactElement {
  const replicas = d.replicas ?? []
  const selectedReplicaId = useStore((s) => s.selectedReplicaId)
  const selectReplica = useStore((s) => s.selectReplica)
  const active = replicas.find((r) => r.id === selectedReplicaId) ?? replicas[0] ?? null

  if (replicas.length === 0) {
    return (
      <div className="dw-panel" style={{ padding: '48px 20px', textAlign: 'center' }}>
        <Empty
          image={<ImportOutlined style={{ fontSize: 42, color: 'var(--text-muted)' }} />}
          description="导入一条爆款切片，用本剧原片复刻出干净成片（无需全局分析）"
        >
          <Button type="primary" icon={<PlusOutlined />} onClick={onImport}>
            导入第一条爆款
          </Button>
        </Empty>
      </div>
    )
  }

  return (
    <div className="dw-nle-grid">
      <aside className="dw-panel" aria-label="复刻任务列表">
        <div className="dw-panel-head">
          <span className="dw-panel-title">复刻任务</span>
          <span className="dw-sub dw-mono">{replicas.length}</span>
        </div>
        <div className="dw-cut-list">
          {replicas.map((r) => (
            <button
              type="button"
              key={r.id}
              className={`dw-cut-item${active?.id === r.id ? ' is-active' : ''}`}
              onClick={() => selectReplica(r.id)}
            >
              <div className="dw-cut-item-top">
                <Tag
                  color={r.status === 'ready' ? 'success' : r.status === 'fail' ? 'error' : r.status === 'queue' ? 'default' : 'processing'}
                  style={{ marginInlineEnd: 0 }}
                >
                  {STATUS_LABEL[r.status]}
                  {r.status !== 'ready' && r.status !== 'fail' && r.status !== 'queue' ? ` ${r.pct}%` : ''}
                </Tag>
                <span className="dw-spacer" />
                <span className="dw-sub dw-mono">{r.stats ? fmtSec(r.stats.totalSeconds) : ''}</span>
              </div>
              <div className="dw-cut-item-title">{r.clipTitle}</div>
              <div className="dw-cut-item-meta">
                {r.stats && <Tag className="dw-mono">{r.stats.segments} 段</Tag>}
                <span className="dw-cut-hook">
                  {r.status === 'fail' ? (r.error ?? '') : r.stageNote ?? (r.stats ? `${r.stats.resolution} · ${r.stats.fps}fps` : '')}
                </span>
              </div>
            </button>
          ))}
        </div>
        <Button block type="dashed" icon={<PlusOutlined />} style={{ marginTop: 10 }} onClick={onImport}>
          导入爆款视频
        </Button>
      </aside>
      {active && <ReplicaWorkspace d={d} task={active} />}
    </div>
  )
}
