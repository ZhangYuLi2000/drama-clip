import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import {
  CaretRightOutlined,
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  FolderOpenOutlined,
  GlobalOutlined,
  ImportOutlined,
  InboxOutlined,
  LeftOutlined,
  MutedOutlined,
  PauseOutlined,
  PlusOutlined,
  ProfileOutlined,
  ReloadOutlined,
  ScanOutlined,
  ScissorOutlined,
  SoundOutlined,
  StopOutlined,
  ThunderboltOutlined
} from '@ant-design/icons'
import {
  Alert,
  Button,
  Collapse,
  Drawer,
  Empty,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Progress,
  Segmented,
  Select,
  Slider,
  Space,
  Spin,
  Table,
  Tabs,
  Tag,
  Tooltip
} from 'antd'
import type { CutStyle, Drama, GlobalScript, PromoCut } from '../../../shared/types'
import { CUT_STYLES } from '../../../shared/types'
import { findDrama, fmtSec, mediaUrl, useLibrary } from '../library'
import { toast, useStore } from '../store'
import ReplicaPanel, { NewReplicaModal } from './Replica'

const STYLE_COLOR: Record<CutStyle, string> = {
  conflict: 'red',
  reversal: 'gold',
  suspense: 'cyan'
}

const ROLE_HEX: Record<string, string> = {
  钩子: '#ef4444',
  铺垫: '#3b82f6',
  冲突: '#f97316',
  升级: '#f59e0b',
  反击: '#10b981',
  高潮: '#eab308',
  反转: '#8b5cf6',
  悬念: '#06b6d4'
}

const QUICK_PROMPTS = [
  { label: '开头再炸一点', text: '开头前 3 秒不够炸，换个最狠的冲突或巴掌名场面直接开场' },
  { label: '节奏压缩加快', text: '节奏再紧凑一点，删掉多余铺垫，控制在 40 秒内' },
  { label: '结尾留强悬念', text: '结尾停在反转即将揭晓或反派刚开口的强悬念处' },
  { label: '换个思路重剪', text: '换一个完全不同的剪辑思路和选段组合重新生成' }
]

function GlobalAnalyzeModal({ d, open, onClose }: { d: Drama; open: boolean; onClose: () => void }): ReactElement {
  const autoAnalyze = useLibrary((s) => s.autoAnalyze)
  const [from, setFrom] = useState(1)
  const [to, setTo] = useState(1)
  const [autoCutCount, setAutoCutCount] = useState(3)
  const [starting, setStarting] = useState(false)

  useEffect(() => {
    if (open && d.episodes.length > 0) {
      setFrom(d.episodes[0].n)
      setTo(d.episodes[d.episodes.length - 1].n)
    }
  }, [open, d])

  const eps = d.episodes.filter((e) => e.n >= from && e.n <= to)
  const totalSec = eps.reduce((s, e) => s + (e.duration ?? 0), 0)
  const acts = Math.max(1, Math.ceil(totalSec / 800))

  const start = (): void => {
    setStarting(true)
    autoAnalyze(d.id, from, to, autoCutCount)
      .then(() => {
        toast('已加入全局分析队列')
        onClose()
      })
      .catch((e: unknown) => toast(e instanceof Error ? e.message : '启动失败', 'info'))
      .finally(() => setStarting(false))
  }

  return (
    <Modal
      title={`全剧分析 · 《${d.title}》`}
      open={open}
      onCancel={onClose}
      onOk={start}
      okText="开始分析并出片"
      cancelText="取消"
      confirmLoading={starting}
      okButtonProps={{ disabled: eps.length === 0 }}
      width={520}
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 14 }}
        message="重度视频分析只需跑 1 次，后续生成任意多条切片都直接复用本地缓存"
        description="整剧自动分幕提取剧情、人物、高光与句级台词，后续无论是「新剪一条」还是「大师重剪」均无需重新扫视频。"
      />
      <Space style={{ marginBottom: 10 }}>
        <span>分析范围：第</span>
        <InputNumber
          min={1}
          max={d.episodes[d.episodes.length - 1]?.n ?? 1}
          value={from}
          onChange={(v) => setFrom(v ?? 1)}
          style={{ width: 84 }}
        />
        <span>集 到 第</span>
        <InputNumber
          min={1}
          max={d.episodes[d.episodes.length - 1]?.n ?? 1}
          value={to}
          onChange={(v) => setTo(v ?? 1)}
          style={{ width: 84 }}
        />
        <span>集</span>
      </Space>
      <div className="dw-sub" style={{ marginBottom: 12 }}>
        共 {eps.length} 集 · 预计分 {acts} 幕 · 输入约 ~{Math.round((totalSec * 108) / 1000)}K tokens
      </div>
      <Space>
        <span>分析完成后自动产出引流成片：</span>
        <Select
          value={autoCutCount}
          onChange={setAutoCutCount}
          style={{ width: 160 }}
          options={[
            { value: 0, label: '0 条（稍后手动点生成）' },
            { value: 1, label: '1 条（冲突爆破）' },
            { value: 2, label: '2 条（冲突+反转）' },
            { value: 3, label: '3 条（全风格覆盖）' },
            { value: 5, label: '5 条（批量投流裂变）' }
          ]}
        />
      </Space>
    </Modal>
  )
}

function NewCutModal({ d, open, onClose }: { d: Drama; open: boolean; onClose: () => void }): ReactElement {
  const generateCut = useLibrary((s) => s.generateCut)
  const [style, setStyle] = useState<CutStyle>('conflict')
  const [targetSec, setTargetSec] = useState(45)
  const [ratio, setRatio] = useState<'9:16' | '16:9'>('9:16')
  const [count, setCount] = useState(1)
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = (): void => {
    setBusy(true)
    generateCut(d.id, { style, targetSec, ratio, count, prompt: prompt.trim() || undefined })
      .then(() => {
        toast(`已加入 AI 大师编排队列（共 ${count} 条，复用本地全剧缓存秒级编排）`)
        setPrompt('')
        onClose()
      })
      .catch((e: unknown) => toast(e instanceof Error ? e.message : '发起失败', 'info'))
      .finally(() => setBusy(false))
  }

  return (
    <Modal
      title="AI 智剪引流成片（直接复用全剧分析缓存）"
      open={open}
      onCancel={onClose}
      onOk={submit}
      okText={`立即生成 ${count} 条成片`}
      cancelText="取消"
      confirmLoading={busy}
      width={560}
    >
      <div className="dw-field-label">剪辑风格</div>
      <Segmented
        block
        value={style}
        onChange={(v) => {
          const s = v as CutStyle
          setStyle(s)
          setTargetSec(CUT_STYLES[s].defaultTarget)
        }}
        options={(Object.keys(CUT_STYLES) as CutStyle[]).map((k) => ({
          value: k,
          label: CUT_STYLES[k].name
        }))}
        style={{ marginBottom: 6 }}
      />
      <p className="dw-sub" style={{ marginTop: 0, marginBottom: 14 }}>
        {CUT_STYLES[style].desc}
      </p>
      <Space wrap style={{ marginBottom: 14 }}>
        <span className="dw-sub">生成条数</span>
        <Select
          value={count}
          onChange={setCount}
          style={{ width: 110 }}
          options={[1, 2, 3, 4, 5].map((v) => ({ value: v, label: `连出 ${v} 条` }))}
        />
        <span className="dw-sub">目标时长</span>
        <Select
          value={targetSec}
          onChange={setTargetSec}
          style={{ width: 96 }}
          options={[30, 45, 60, 75, 90].map((v) => ({ value: v, label: `${v} 秒` }))}
        />
        <span className="dw-sub">画幅</span>
        <Select
          value={ratio}
          onChange={setRatio}
          style={{ width: 114 }}
          options={[
            { value: '9:16', label: '9:16 竖屏' },
            { value: '16:9', label: '16:9 横屏' }
          ]}
        />
      </Space>
      <div className="dw-field-label">补充剪辑要求（可选 · 自动避开已用过的开场钩子）</div>
      <Input.TextArea
        className="dw-auto-textarea"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="例如：重点突出女主亮明千金身份打脸反派，把第 6 集的耳光放最前面做钩子"
      />
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

  return (
    <Drawer title={`全剧剧情与人物 · 《${d.title}》`} width={680} open={open} onClose={onClose} loading={loading}>
      {script ? (
        <Tabs
          items={[
            {
              key: 'arcs',
              label: '故事线与人物',
              children: (
                <div>
                  <div className="dw-field-label">一句话故事</div>
                  <p style={{ marginTop: 4 }}>{script.logline || '—'}</p>
                  <div className="dw-field-label">叙事地图</div>
                  <p className="dw-sub" style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>
                    {script.arcs || '—'}
                  </p>
                  <div className="dw-field-label" style={{ marginTop: 12 }}>
                    人物表
                  </div>
                  <Table
                    size="small"
                    rowKey="name"
                    pagination={false}
                    dataSource={d.synthesis?.characters ?? []}
                    columns={[
                      { title: '人物', dataIndex: 'name', width: 110 },
                      { title: '定位', dataIndex: 'role', width: 90 },
                      { title: '关系与身份', dataIndex: 'desc' }
                    ]}
                  />
                </div>
              )
            },
            {
              key: 'script',
              label: `分集台词（${script.episodes.length}）`,
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
                            <span className="dw-sub dw-mono" style={{ display: 'inline-block', width: 88 }}>
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
            }
          ]}
        />
      ) : (
        !loading && <Empty description="暂无全剧剧本数据" />
      )}
    </Drawer>
  )
}

function CutWorkspace({ d, cut }: { d: Drama; cut: PromoCut }): ReactElement {
  const regenerateCut = useLibrary((s) => s.regenerateCut)
  const renderCut = useLibrary((s) => s.renderCut)
  const deleteCut = useLibrary((s) => s.deleteCut)
  const openOutput = useLibrary((s) => s.openOutput)
  const exportCutPackage = useLibrary((s) => s.exportCutPackage)
  const stopTasks = useLibrary((s) => s.stopTasks)

  const videoRef = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const [t, setT] = useState(0)
  const [dur, setDur] = useState(0)
  const [muted, setMuted] = useState(false)
  const [videoErr, setVideoErr] = useState(false)

  const [instruction, setInstruction] = useState('')
  const [nextStyle, setNextStyle] = useState<CutStyle>(cut.style)
  const [nextTarget, setNextTarget] = useState<number>(cut.targetSec)
  const [regenBusy, setRegenBusy] = useState(false)
  const [exportBusy, setExportBusy] = useState(false)

  useEffect(() => {
    setPlaying(false)
    setT(0)
    setDur(0)
    setVideoErr(false)
    setNextStyle(cut.style)
    setNextTarget(cut.targetSec)
    setInstruction('')
  }, [cut.id, cut.revision, cut.output])

  const playable = cut.status === 'ready' && Boolean(cut.output) && !videoErr

  const togglePlay = (): void => {
    const v = videoRef.current
    if (!v) return
    if (playing) v.pause()
    else void v.play().catch(() => setVideoErr(true))
  }

  const copyText = (txt: string, label: string): void => {
    void navigator.clipboard
      .writeText(txt)
      .then(() => toast(`已复制${label}`))
      .catch(() => toast('复制失败，请手动选中复制', 'info'))
  }

  const doRegen = (overridePrompt?: string): void => {
    const finalPrompt = (overridePrompt ?? instruction).trim()
    setRegenBusy(true)
    regenerateCut(d.id, cut.id, finalPrompt, nextStyle, nextTarget)
      .then(() => {
        toast('已交给 AI 大师重新剪辑并渲染')
        if (!overridePrompt) setInstruction('')
      })
      .catch((e: unknown) => toast(e instanceof Error ? e.message : '重剪失败', 'info'))
      .finally(() => setRegenBusy(false))
  }

  const doExport = (): void => {
    setExportBusy(true)
    exportCutPackage(d.id, cut.id)
      .then((res) => {
        if (!res.canceled) toast('已导出剪映素材包（MP4 + SRT + 文案）')
      })
      .catch((e: unknown) => toast(e instanceof Error ? e.message : '导出失败', 'info'))
      .finally(() => setExportBusy(false))
  }

  return (
    <>
      {/* 中央监视器 */}
      <section className="dw-stage" aria-label="成片监视器">
        <div className="dw-panel-head" style={{ marginBottom: 0 }}>
          <Space size={8}>
            <span className="dw-panel-title">{cut.title}</span>
            <Tag color={STYLE_COLOR[cut.style]} style={{ marginInlineEnd: 0 }}>
              {CUT_STYLES[cut.style].name}
            </Tag>
            <Tag className="dw-mono" style={{ marginInlineEnd: 0 }}>
              v{cut.revision}
            </Tag>
          </Space>
          <span className="dw-sub dw-mono">
            {cut.ratio} · {cut.actualSec}s
          </span>
        </div>

        <div className={cut.ratio === '9:16' ? 'dw-player' : 'dw-player dw-player-wide'}>
          {playable ? (
            <>
              <video
                key={`${cut.output}-${cut.revision}`}
                ref={videoRef}
                src={mediaUrl(cut.output!)}
                width={cut.ratio === '9:16' ? 310 : 520}
                height={cut.ratio === '9:16' ? 551 : 292}
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
              <span className="dw-ptime">{fmtSec(t)}</span>
              <button type="button" className="dw-play-overlay" onClick={togglePlay} aria-label="播放 / 暂停">
                {playing ? <PauseOutlined /> : <CaretRightOutlined />}
              </button>
            </>
          ) : (
            <div className="dw-player-empty">
              {cut.status === 'rendering' ? (
                <>
                  <Spin />
                  <span className="dw-sub" style={{ color: '#e4e4e7' }}>
                    正在渲染纯净成片 {cut.pct ?? 0}%…
                  </span>
                  <Progress percent={cut.pct ?? 0} size="small" style={{ width: '78%' }} showInfo={false} />
                  <Button
                    size="small"
                    danger
                    icon={<StopOutlined />}
                    onClick={() =>
                      stopTasks(d.id)
                        .then(() => toast('已终止当前渲染任务', 'info'))
                        .catch(() => toast('终止失败', 'info'))
                    }
                  >
                    终止渲染
                  </Button>
                </>
              ) : (
                <>
                  <span className="dw-sub">{cut.error || '成片尚未渲染或文件丢失'}</span>
                  <Button size="small" type="primary" icon={<ReloadOutlined />} onClick={() => renderCut(d.id, cut.id)}>
                    重新渲染
                  </Button>
                </>
              )}
            </div>
          )}
        </div>

        {playable && (
          <div className="dw-transport">
            <Button
              size="small"
              type="text"
              icon={playing ? <PauseOutlined /> : <CaretRightOutlined />}
              onClick={togglePlay}
              aria-label="播放 / 暂停"
            />
            <span className="dw-sub dw-mono" style={{ minWidth: 84 }}>
              {fmtSec(t)} / {fmtSec(dur || cut.actualSec)}
            </span>
            <Slider
              min={0}
              max={dur || cut.actualSec}
              step={0.1}
              value={Math.min(t, dur || cut.actualSec)}
              onChange={(v: number) => {
                if (videoRef.current) videoRef.current.currentTime = v
                setT(v)
              }}
              tooltip={{ formatter: (v) => fmtSec(v ?? 0) }}
              style={{ flex: 1, marginBlock: 0 }}
            />
            <Button
              size="small"
              type="text"
              icon={muted ? <MutedOutlined /> : <SoundOutlined />}
              onClick={() => setMuted(!muted)}
              aria-label="静音切换"
            />
          </div>
        )}

        <div>
          <div className="dw-sec-title" style={{ marginBottom: 6 }}>
            成片结构时间轴（鼠标悬停查看来源）
          </div>
          <div className="dw-tl-strip">
            {cut.clips.map((c, idx) => {
              const segDur = Math.max(0.5, c.out - c.in)
              return (
                <Tooltip
                  key={`${c.epId}-${c.in}-${idx}`}
                  title={`第 ${c.epN} 集 ${c.in.toFixed(1)}–${c.out.toFixed(1)}s · [${c.role}] ${c.why}`}
                >
                  <span
                    className="dw-tl-seg"
                    style={{ flex: segDur, background: ROLE_HEX[c.role] ?? '#3b82f6' }}
                  >
                    {c.role} · {segDur.toFixed(0)}s
                  </span>
                </Tooltip>
              )
            })}
          </div>
        </div>
      </section>

      {/* 右侧：AI 大师重剪与剪映交付 */}
      <aside className="dw-inspector" aria-label="AI 剪辑大师与交付文案">
        <div className="dw-panel">
          <div className="dw-panel-head">
            <span className="dw-panel-title">AI 大师重剪指令</span>
            <span className="dw-sub">⌘/Ctrl + Enter 发送</span>
          </div>
          <Input.TextArea
            className="dw-auto-textarea"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="告诉 AI 哪里需要改，例如：开头 3 秒不够炸，把第 5 集反击提前；留空则直接换个思路重出"
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                if (e.nativeEvent.isComposing || e.keyCode === 229) return
                e.preventDefault()
                doRegen()
              }
            }}
          />
          <Space size={6} wrap style={{ marginTop: 10, marginBottom: 12 }}>
            {QUICK_PROMPTS.map((q) => (
              <Button key={q.label} size="small" onClick={() => setInstruction(q.text)}>
                {q.label}
              </Button>
            ))}
          </Space>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Select
              size="small"
              value={nextStyle}
              onChange={setNextStyle}
              style={{ width: 106 }}
              options={(Object.keys(CUT_STYLES) as CutStyle[]).map((k) => ({
                value: k,
                label: CUT_STYLES[k].name
              }))}
            />
            <Select
              size="small"
              value={nextTarget}
              onChange={setNextTarget}
              style={{ width: 84 }}
              options={[30, 45, 60, 75, 90].map((v) => ({ value: v, label: `${v} 秒` }))}
            />
            <span className="dw-spacer" />
            <Button
              type="primary"
              icon={<ThunderboltOutlined />}
              loading={regenBusy}
              disabled={cut.status === 'rendering'}
              onClick={() => doRegen()}
            >
              AI 重新生成
            </Button>
          </div>
        </div>

        <div className="dw-panel">
          <div className="dw-panel-head">
            <span className="dw-panel-title">剪映花字与发布文案</span>
          </div>

          <div className="dw-copy-block">
            <div className="dw-copy-head">
              <span className="dw-field-label">开场 3 秒花字标题</span>
              <Button size="small" type="link" icon={<CopyOutlined />} onClick={() => copyText(cut.hookHeadline, '花字标题')}>
                复制
              </Button>
            </div>
            <div className="dw-hook-box">{cut.hookHeadline || '—'}</div>
          </div>

          <div className="dw-copy-block" style={{ marginTop: 10 }}>
            <div className="dw-copy-head">
              <span className="dw-field-label">引流发布文案</span>
              <Button size="small" type="link" icon={<CopyOutlined />} onClick={() => copyText(cut.publishCopy, '发布文案')}>
                复制
              </Button>
            </div>
            <p className="dw-reason" style={{ whiteSpace: 'pre-wrap' }}>
              {cut.publishCopy || '—'}
            </p>
          </div>

          <div style={{ marginTop: 10 }}>
            <div className="dw-field-label">冲突拆解与节奏备注</div>
            <p className="dw-sub" style={{ margin: 0, lineHeight: 1.6 }}>
              {cut.conflictSummary}
              {cut.directorNote ? ` · ${cut.directorNote}` : ''}
            </p>
          </div>
        </div>

        <div className="dw-panel">
          <div className="dw-panel-head">
            <span className="dw-panel-title">分镜明细</span>
            <span className="dw-sub dw-mono">
              {cut.clips.length} 段 · {cut.actualSec}s
            </span>
          </div>
          <div className="dw-lines">
            {cut.clips.map((c, idx) => (
              <div className="dw-clip-row" key={`${c.epId}-${c.in}-${idx}`}>
                <span className="dw-clip-order">{idx + 1}</span>
                <Tag style={{ marginInlineEnd: 0 }}>{c.role}</Tag>
                <span style={{ fontWeight: 500 }}>第 {c.epN} 集</span>
                <span className="dw-sub dw-mono">
                  {c.in.toFixed(1)}–{c.out.toFixed(1)}s
                </span>
                <span className="dw-clip-why">{c.why}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="dw-panel" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Button
            type="primary"
            size="large"
            block
            icon={<DownloadOutlined />}
            disabled={!playable}
            loading={exportBusy}
            onClick={doExport}
          >
            导出剪映素材包（MP4 + SRT + 文案）
          </Button>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button
              style={{ flex: 1 }}
              icon={<FolderOpenOutlined />}
              disabled={!playable}
              onClick={() => cut.output && openOutput(cut.output)}
            >
              打开文件位置
            </Button>
            <Popconfirm
              title="删除这条成片方案？"
              description="将同时删除已渲染的视频与字幕文件"
              okText="删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              onConfirm={() => deleteCut(d.id, cut.id)}
            >
              <Button danger icon={<DeleteOutlined />} aria-label="删除成片" />
            </Popconfirm>
          </div>
        </div>
      </aside>
    </>
  )
}

function DramaStudio({ d }: { d: Drama }): ReactElement {
  const backToProjects = useStore((s) => s.backToProjects)
  const selectedCutId = useStore((s) => s.selectedCutId)
  const selectCut = useStore((s) => s.selectCut)
  const studioTab = useStore((s) => s.studioTab)
  const setStudioTab = useStore((s) => s.setStudioTab)
  const rescan = useLibrary((s) => s.rescan)
  const stopTasks = useLibrary((s) => s.stopTasks)

  const [analyzeOpen, setAnalyzeOpen] = useState(false)
  const [newCutOpen, setNewCutOpen] = useState(false)
  const [replicaOpen, setReplicaOpen] = useState(false)
  const [scriptOpen, setScriptOpen] = useState(false)
  const [rescanning, setRescanning] = useState(false)

  const cuts = d.cuts ?? []
  const replicas = d.replicas ?? []
  const activeCut = cuts.find((c) => c.id === selectedCutId) ?? cuts[0] ?? null
  const g = d.global

  const doRescan = (): void => {
    setRescanning(true)
    rescan(d.id)
      .then(({ added }) => toast(added > 0 ? `新增 ${added} 集` : '没有发现新剧集文件', added > 0 ? 'success' : 'info'))
      .catch((e: unknown) => toast(e instanceof Error ? e.message : '扫描失败', 'info'))
      .finally(() => setRescanning(false))
  }

  return (
    <div>
      <div className="dw-page-head">
        <Button icon={<LeftOutlined />} onClick={backToProjects}>
          项目列表
        </Button>
        <div>
          <h2 className="dw-page-title">{d.title}</h2>
          <p className="dw-page-desc">
            {d.synthesis?.logline || `共 ${d.episodes.length} 集 · 导出纯净无字幕无配乐成片，直接进剪映二次精修`}
          </p>
        </div>
        <span className="dw-spacer" />
        <Space wrap>
          <Button icon={<ScanOutlined />} loading={rescanning} onClick={doRescan}>
            重新扫描
          </Button>
          <Button icon={<ProfileOutlined />} disabled={g?.status !== 'done'} onClick={() => setScriptOpen(true)}>
            全剧剧本
          </Button>
          <Button
            icon={<GlobalOutlined />}
            loading={g?.status === 'run' || g?.status === 'queue'}
            onClick={() => setAnalyzeOpen(true)}
          >
            {g?.status === 'done' ? '重新分析' : '全局分析'}
          </Button>
          <Button
            icon={<ImportOutlined />}
            onClick={() => {
              setStudioTab('replica')
              setReplicaOpen(true)
            }}
          >
            爆款复刻
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            disabled={g?.status !== 'done'}
            onClick={() => setNewCutOpen(true)}
          >
            AI 新剪成片
          </Button>
        </Space>
      </div>

      <Segmented
        value={studioTab}
        onChange={(v) => setStudioTab(v as 'cuts' | 'replica')}
        options={[
          { value: 'cuts', label: `AI 智剪成片${cuts.length > 0 ? ` (${cuts.length})` : ''}` },
          { value: 'replica', label: `爆款复刻${replicas.length > 0 ? ` (${replicas.length})` : ''}` }
        ]}
        style={{ marginBottom: 16 }}
      />

      {studioTab === 'replica' && (
        <>
          <ReplicaPanel d={d} onImport={() => setReplicaOpen(true)} />
          <NewReplicaModal d={d} open={replicaOpen} onClose={() => setReplicaOpen(false)} />
        </>
      )}

      {studioTab === 'cuts' && (
        <>

      {(g?.status === 'run' || g?.status === 'queue') && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message={`正在进行全剧分幕分析（${g.pct ?? 0}%）…`}
          description={
            <div style={{ marginTop: 6 }}>
              <Progress percent={g.pct ?? 0} size="small" />
              <span className="dw-sub">分析完成后将自动由 AI 剪辑大师生成引流成片并渲染（已完成的分幕会自动保存断点）。</span>
            </div>
          }
          action={
            <Button
              size="small"
              danger
              icon={<StopOutlined />}
              onClick={() =>
                stopTasks(d.id)
                  .then(() => toast('已终止分析任务（已完成的分幕已保存）', 'info'))
                  .catch(() => toast('终止失败', 'info'))
              }
            >
              终止分析
            </Button>
          }
        />
      )}

      {g?.status === 'fail' && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message="全剧分析失败"
          description={g.note || '请检查设置中的模型 API Key 与网络后重试'}
          action={
            <Button size="small" danger onClick={() => setAnalyzeOpen(true)}>
              重试分析
            </Button>
          }
        />
      )}

      {cuts.length === 0 ? (
        <div className="dw-panel" style={{ padding: '48px 20px', textAlign: 'center' }}>
          <Empty
            image={<ScissorOutlined style={{ fontSize: 42, color: '#52525b' }} />}
            description={
              g?.status === 'done'
                ? '全剧已分析完成，立即让 AI 剪辑大师生成引流成片'
                : '尚未生成引流成片，点击下方按钮一键分析全剧并自动出片'
            }
          >
            {g?.status === 'done' ? (
              <Button type="primary" icon={<ThunderboltOutlined />} onClick={() => setNewCutOpen(true)}>
                AI 智剪第一批成片
              </Button>
            ) : (
              <Button
                type="primary"
                icon={<ThunderboltOutlined />}
                loading={g?.status === 'run' || g?.status === 'queue'}
                onClick={() => setAnalyzeOpen(true)}
              >
                一键 AI 全局分析并出片
              </Button>
            )}
          </Empty>
        </div>
      ) : (
        <div className="dw-nle-grid">
          <aside className="dw-panel" aria-label="成片方案列表">
            <div className="dw-panel-head">
              <span className="dw-panel-title">成片方案</span>
              <span className="dw-sub dw-mono">{cuts.length}</span>
            </div>
            <div className="dw-cut-list">
              {cuts.map((c) => (
                <button
                  type="button"
                  key={c.id}
                  className={`dw-cut-item${activeCut?.id === c.id ? ' is-active' : ''}`}
                  onClick={() => selectCut(c.id)}
                >
                  <div className="dw-cut-item-top">
                    <Tag color={STYLE_COLOR[c.style]} style={{ marginInlineEnd: 0 }}>
                      {CUT_STYLES[c.style].name}
                    </Tag>
                    <Tag className="dw-mono" style={{ marginInlineEnd: 0 }}>
                      v{c.revision}
                    </Tag>
                    <span className="dw-spacer" />
                    <span className="dw-sub dw-mono">{c.actualSec}s</span>
                  </div>
                  <div className="dw-cut-item-title">{c.title}</div>
                  <div className="dw-cut-item-meta">
                    {c.status === 'ready' && <Tag color="success">可导出</Tag>}
                    {c.status === 'rendering' && <Tag color="processing">渲染 {c.pct ?? 0}%</Tag>}
                    {c.status === 'draft' && <Tag>待渲染</Tag>}
                    {c.status === 'fail' && <Tag color="error">失败</Tag>}
                    <span className="dw-cut-hook">{c.hookHeadline}</span>
                  </div>
                </button>
              ))}
            </div>
            <Button
              block
              type="dashed"
              icon={<PlusOutlined />}
              style={{ marginTop: 10 }}
              disabled={g?.status !== 'done'}
              onClick={() => setNewCutOpen(true)}
            >
              AI 再剪新思路（可批量）
            </Button>
          </aside>

          {activeCut && <CutWorkspace d={d} cut={activeCut} />}
        </div>
      )}

        </>
      )}

      <GlobalAnalyzeModal d={d} open={analyzeOpen} onClose={() => setAnalyzeOpen(false)} />
      <NewCutModal d={d} open={newCutOpen} onClose={() => setNewCutOpen(false)} />
      <GlobalScriptDrawer d={d} open={scriptOpen} onClose={() => setScriptOpen(false)} />
    </div>
  )
}

function ProjectList(): ReactElement {
  const dramas = useLibrary((s) => s.dramas)
  const autoAnalyze = useLibrary((s) => s.autoAnalyze)
  const removeDrama = useLibrary((s) => s.removeDrama)
  const openDrama = useStore((s) => s.openDrama)
  const openReplicaTab = useStore((s) => s.openReplicaTab)
  const setImportOpen = useStore((s) => s.setImportOpen)
  const q = useStore((s) => s.q)
  const setQ = useStore((s) => s.setQ)

  const rows = dramas.filter((d) => !q.trim() || d.title.includes(q.trim()))

  return (
    <div>
      <div className="dw-page-head">
        <div>
          <h2 className="dw-page-title">AI 短剧智剪</h2>
          <p className="dw-page-desc">
            导入短剧后全自动分析冲突与人物，产出高转化引流切片与配套文案，拖入剪映即可发布。
          </p>
        </div>
        <span className="dw-spacer" />
        {dramas.length > 0 && (
          <Input
            allowClear
            placeholder="搜索短剧名称"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ width: 220 }}
            aria-label="搜索短剧"
          />
        )}
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setImportOpen(true)}>
          导入短剧
        </Button>
      </div>

      {dramas.length === 0 ? (
        <div className="dw-panel" style={{ padding: '64px 20px', textAlign: 'center' }}>
          <Empty
            image={<InboxOutlined style={{ fontSize: 44, color: '#52525b' }} />}
            description="还没有导入短剧。选择一个包含剧集视频的目录，AI 将全自动完成分析并产出引流成片"
          >
            <Button type="primary" size="large" icon={<PlusOutlined />} onClick={() => setImportOpen(true)}>
              导入第一部短剧
            </Button>
          </Empty>
        </div>
      ) : rows.length === 0 ? (
        <div className="dw-panel" style={{ padding: '48px 20px', textAlign: 'center' }}>
          <Empty description="没有匹配的短剧" />
        </div>
      ) : (
        <div className="dw-project-grid">
          {rows.map((d) => {
            const st = d.global?.status ?? 'idle'
            const readyN = (d.cuts ?? []).filter((c) => c.status === 'ready').length
            const totalN = (d.cuts ?? []).length
            const replicaReady = (d.replicas ?? []).filter((r) => r.status === 'ready').length
            const replicaTotal = (d.replicas ?? []).length
            return (
              <div className="dw-project-card" key={d.id}>
                <div className="dw-project-top">
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="dw-project-title">{d.title}</div>
                    <div className="dw-project-dir" title={d.dir}>
                      {d.dir}
                    </div>
                  </div>
                  {st === 'done' && <Tag color="success">已掌握全剧</Tag>}
                  {(st === 'run' || st === 'queue') && <Tag color="processing">分析 {d.global?.pct ?? 0}%</Tag>}
                  {st === 'fail' && <Tag color="error">分析失败</Tag>}
                  {st === 'idle' && <Tag>待分析</Tag>}
                </div>

                {d.synthesis?.logline && (
                  <p className="dw-sub" style={{ margin: 0, lineHeight: 1.55 }}>
                    {d.synthesis.logline}
                  </p>
                )}

                <div className="dw-project-stats">
                  <span className="dw-mono">{d.episodes.length} 集</span>
                  <span>·</span>
                  <span>
                    引流成片：<b style={{ color: readyN > 0 ? '#60a5fa' : undefined }}>{readyN}</b> / {totalN} 条就绪
                  </span>
                  {replicaTotal > 0 && (
                    <>
                      <span>·</span>
                      <span>
                        复刻：<b style={{ color: replicaReady > 0 ? '#a78bfa' : undefined }}>{replicaReady}</b> / {replicaTotal}
                      </span>
                    </>
                  )}
                </div>

                <div className="dw-project-actions">
                  <Button type="primary" style={{ flex: 1 }} onClick={() => openDrama(d.id)}>
                    进入成片室
                  </Button>
                  <Button icon={<ImportOutlined />} onClick={() => openReplicaTab(d.id)}>
                    爆款复刻
                  </Button>
                  {st !== 'done' && (
                    <Button
                      icon={<ThunderboltOutlined />}
                      disabled={st === 'run' || st === 'queue'}
                      onClick={() =>
                        autoAnalyze(d.id, undefined, undefined, 3)
                          .then(() => {
                            toast('已开始全局分析与自动出片')
                            openDrama(d.id)
                          })
                          .catch((e: unknown) => toast(e instanceof Error ? e.message : '启动失败', 'info'))
                      }
                    >
                      一键智剪
                    </Button>
                  )}
                  <Popconfirm
                    title={`移除《${d.title}》？`}
                    description="仅移除工作台索引与生成的切片，不删除原剧集文件"
                    okText="移除"
                    cancelText="取消"
                    okButtonProps={{ danger: true }}
                    onConfirm={() => removeDrama(d.id).then(() => toast(`已移除《${d.title}》`, 'info'))}
                  >
                    <Button danger icon={<DeleteOutlined />} aria-label={`移除 ${d.title}`} />
                  </Popconfirm>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function Studio(): ReactElement {
  const selectedDramaId = useStore((s) => s.selectedDramaId)
  const dramas = useLibrary((s) => s.dramas)
  const drama = findDrama(dramas, selectedDramaId)
  return drama ? <DramaStudio d={drama} /> : <ProjectList />
}
