import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import {
  BorderOutlined,
  CaretRightOutlined,
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  ExperimentOutlined,
  FireOutlined,
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
  RetweetOutlined,
  ScanOutlined,
  ScissorOutlined,
  SoundOutlined,
  StepBackwardOutlined,
  StepForwardOutlined,
  StopOutlined,
  ThunderboltOutlined,
  VideoCameraAddOutlined
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
  Space,
  Spin,
  Table,
  Tabs,
  Tag
} from 'antd'
import type { CutMode, CutStyle, Drama, GlobalScript, PromoCut } from '../../../shared/types'
import { CUT_STYLES } from '../../../shared/types'
import { findDrama, fmtSec, mediaUrl, useLibrary } from '../library'
import { toast, useStore } from '../store'
import TimelineScrubber from '../TimelineScrubber'
import ReplicaPanel, { NewReplicaModal } from './Replica'

const STYLE_COLOR: Record<CutStyle, string> = {
  conflict: 'red',
  reversal: 'gold',
  suspense: 'cyan'
}

const ROLE_HEX: Record<string, string> = {
  钩子: '#dc2626',
  铺垫: '#2563eb',
  冲突: '#f97316',
  升级: '#f59e0b',
  反击: '#10b981',
  高潮: '#eab308',
  反转: '#7c3aed',
  悬念: '#06b6d4'
}

// 深底角色色配白字、亮底配深字，保证色块小字 ≥4.5:1
const ROLE_TEXT: Record<string, string> = {
  钩子: '#fff',
  铺垫: '#fff',
  反转: '#fff'
}
const roleText = (role: string): string => ROLE_TEXT[role] ?? '#0f172a'

const QUICK_PROMPTS = [
  { label: '开头再炸一点', text: '开头前 3 秒不够炸，换个最狠的冲突或巴掌名场面直接开场' },
  { label: '节奏压缩加快', text: '节奏再紧凑一点，删掉多余铺垫，控制在 40 秒内' },
  { label: '结尾留强悬念', text: '结尾停在反转即将揭晓或反派刚开口的强悬念处' },
  { label: '同主线深挖', text: '保持开场同一条人物矛盾主线到底，删掉无关支线片段' }
]

const SPEEDS = [1, 1.25, 1.5, 2, 0.75]

const VIRAL_TEMPLATES: { title: string; desc: string; style: CutStyle; target: number; prompt: string }[] = [
  {
    title: '极度受辱 → 亮牌秒打脸',
    desc: '前3秒当众羞辱/逼签协议，紧接隐忍加码与亮明身份反杀',
    style: 'reversal',
    target: 55,
    prompt: '复刻爆款结构：0-4s最强当众羞辱或逼迫开场 → 反派步步紧逼加码赌注 → 主角亮出真正底牌/大佬护短反击 → 反派震惊悔恨处卡点'
  },
  {
    title: '背叛名场面 → 绝地断亲/反杀',
    desc: '开场抓包背叛或偏心逼迫，主角果断翻脸让对方追悔莫及',
    style: 'conflict',
    target: 45,
    prompt: '复刻爆款结构：开场直接切入背叛/偏心/污蔑最扎心的一句台词 → 主角不再隐忍直接掀桌断绝关系或反制 → 对方慌乱求饶'
  },
  {
    title: '反派叫嚣 → 降维打击卡点',
    desc: '反派狂妄立下毒誓，大人物/真相即将落地前0.5秒断头',
    style: 'suspense',
    target: 60,
    prompt: '复刻爆款结构：开场反派最嚣张的威胁或立Flag → 矛盾层层升级到无法收场 → 在关键人物登场或真相揭晓的最高潮处戛然而止留强悬念'
  },
  {
    title: '真假身份对峙 → 铁证悬念',
    desc: '冒领功劳或身份顶替对峙，拿出核心信物瞬间卡点引流',
    style: 'suspense',
    target: 60,
    prompt: '复刻爆款结构：聚焦身份顶替/冒领恩情的正面冲突主线，前3秒抛出最离谱的颠倒黑白台词，层层对峙后在亮出铁证瞬间卡点'
  }
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
        description="整剧自动分幕提取剧情、人物、高光与句级台词，后续无论是「新剪一条」「前3秒赛马矩阵」还是「对标爆款复刻」均无需重新扫原剧。"
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
          style={{ width: 168 }}
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
  const pickVideoFile = useLibrary((s) => s.pickVideoFile)

  const [mode, setMode] = useState<CutMode>('independent')
  const [style, setStyle] = useState<CutStyle>('conflict')
  const [targetSec, setTargetSec] = useState(45)
  const [ratio, setRatio] = useState<'9:16' | '16:9'>('9:16')
  const [count, setCount] = useState(1)
  const [prompt, setPrompt] = useState('')
  const [refVideoPath, setRefVideoPath] = useState('')
  const [refCopy, setRefCopy] = useState('')
  const [busy, setBusy] = useState(false)

  const changeMode = (nextMode: CutMode): void => {
    setMode(nextMode)
    if (nextMode === 'hook-matrix' && count < 2) setCount(3)
    if (nextMode === 'viral-clone') setCount(1)
  }

  const pickRefVideo = (): void => {
    pickVideoFile()
      .then((file) => {
        if (file) setRefVideoPath(file)
      })
      .catch(() => toast('无法打开视频选择器', 'info'))
  }

  const submit = (): void => {
    if (mode === 'viral-clone' && !refVideoPath && !refCopy.trim() && !prompt.trim()) {
      toast('在「对标爆款 1:1 复刻」模式下，请选择一条对标参考视频或输入对标爆款文案/母版', 'info')
      return
    }
    setBusy(true)
    const effectiveCount = mode === 'hook-matrix' ? Math.max(2, count) : count
    generateCut(d.id, {
      style,
      mode,
      targetSec,
      ratio,
      count: effectiveCount,
      prompt: prompt.trim() || undefined,
      refVideoPath: mode === 'viral-clone' && refVideoPath ? refVideoPath : undefined,
      refCopy: mode === 'viral-clone' && refCopy.trim() ? refCopy.trim() : undefined
    })
      .then(() => {
        const msg =
          mode === 'hook-matrix'
            ? `已启动「1 主体 × ${effectiveCount} 钩子」赛马矩阵（主干片段缓存秒级复用）`
            : mode === 'viral-clone'
              ? '已启动对标爆款 Beat Sheet 解构与 1:1 槽位复刻'
              : `已加入 AI 大师编排队列（共 ${effectiveCount} 条，两阶段因果检索秒级编排）`
        toast(msg)
        setPrompt('')
        onClose()
      })
      .catch((e: unknown) => toast(e instanceof Error ? e.message : '发起失败', 'info'))
      .finally(() => setBusy(false))
  }

  return (
    <Modal
      title="AI 智剪引流成片（因果链聚类 · 赛马矩阵 · 对标爆款复刻）"
      open={open}
      onCancel={onClose}
      onOk={submit}
      okText={
        mode === 'hook-matrix'
          ? `生成 ${Math.max(2, count)} 条钩子赛马矩阵`
          : mode === 'viral-clone'
            ? '解构对标爆款并复刻出片'
            : `立即生成 ${count} 条成片`
      }
      cancelText="取消"
      confirmLoading={busy}
      width={620}
    >
      <div className="dw-field-label">智剪算法模式</div>
      <Segmented
        block
        value={mode}
        onChange={(v) => changeMode(v as CutMode)}
        options={[
          { value: 'independent', label: '多思路独立智剪', icon: <ThunderboltOutlined /> },
          { value: 'hook-matrix', label: '1主体 × N钩子赛马矩阵', icon: <ExperimentOutlined /> },
          { value: 'viral-clone', label: '对标爆款 1:1 复刻', icon: <FireOutlined /> }
        ]}
        style={{ marginBottom: 8 }}
      />
      <p className="dw-sub" style={{ marginTop: 0, marginBottom: 12 }}>
        {mode === 'independent' &&
          '自动聚类全剧跨集因果冲突链，通过两阶段漏斗检索锁定同一条矛盾主线，每条方案独立选材编排。'}
        {mode === 'hook-matrix' &&
          '买量投流标准赛马：固定 1 套高转化同主线爽点主干，自动搭配 N 个不同切入角度的黄金前 3-6 秒钩子，主干渲染缓存秒级复用。'}
        {mode === 'viral-clone' &&
          '上传一条同行跑爆的参考视频（或粘贴爆款文案），AI 自动提取其 Beat Sheet 节拍骨架与情绪极性曲线，并 1:1 映射到本地短剧。'}
      </p>

      <div className="dw-field-label">叙事基调风格</div>
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
      <p className="dw-sub" style={{ marginTop: 0, marginBottom: 12 }}>
        {CUT_STYLES[style].desc}
      </p>

      <div className="dw-field-grid is-compact" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
        <div className="dw-field">
          <span className="dw-field-label">{mode === 'hook-matrix' ? '赛马钩子数' : '生成条数'}</span>
          <div className="dw-field-control">
            <Select
              value={mode === 'hook-matrix' ? Math.max(2, count) : count}
              onChange={setCount}
              options={(mode === 'hook-matrix' ? [2, 3, 4, 5] : [1, 2, 3, 4, 5]).map((v) => ({
                value: v,
                label: mode === 'hook-matrix' ? `${v} 个钩子变体` : `连出 ${v} 条`
              }))}
            />
          </div>
        </div>
        <div className="dw-field">
          <span className="dw-field-label">目标时长</span>
          <div className="dw-field-control">
            <Select
              value={targetSec}
              onChange={setTargetSec}
              options={[30, 45, 55, 60, 75, 90].map((v) => ({ value: v, label: `${v} 秒` }))}
            />
          </div>
        </div>
        <div className="dw-field">
          <span className="dw-field-label">画幅</span>
          <div className="dw-field-control">
            <Select
              value={ratio}
              onChange={setRatio}
              options={[
                { value: '9:16', label: '9:16 竖屏' },
                { value: '16:9', label: '16:9 横屏' }
              ]}
            />
          </div>
        </div>
      </div>

      {mode === 'viral-clone' && (
        <div className="dw-copy-block" style={{ marginBottom: 12 }}>
          <div className="dw-field-label">对标爆款参考视频（可选 · 自动抽帧提取 Beat Sheet 节拍并本地缓存）</div>
          <div className="dw-dir" style={{ marginBottom: 8 }}>
            <span className="dw-dir-path" title={refVideoPath}>
              {refVideoPath || '未选择参考视频（可仅靠下方对标文案/母版复刻）'}
            </span>
            {refVideoPath && (
              <Button size="small" type="text" onClick={() => setRefVideoPath('')}>
                清除
              </Button>
            )}
            <Button size="small" icon={<VideoCameraAddOutlined />} onClick={pickRefVideo}>
              选择对标视频
            </Button>
          </div>
          <div className="dw-field-label">对标爆款台词 / 结构描述（可选）</div>
          <Input.TextArea
            className="dw-auto-textarea"
            value={refCopy}
            onChange={(e) => setRefCopy(e.target.value)}
            placeholder="粘贴外部爆款切片的台词文案或分镜节拍，AI 将提取其情绪曲线与钩子机制并复刻到本剧"
          />
        </div>
      )}

      <div className="dw-field-label">一键套用爆款复刻母版（点击自动填入结构与参数）</div>
      <div className="dw-tpl-grid">
        {VIRAL_TEMPLATES.map((tpl) => (
          <button
            type="button"
            key={tpl.title}
            className="dw-tpl-btn"
            onClick={() => {
              setStyle(tpl.style)
              setTargetSec(tpl.target)
              setPrompt(tpl.prompt)
            }}
          >
            <span className="dw-tpl-title">{tpl.title}</span>
            <span className="dw-tpl-desc">{tpl.desc}</span>
          </button>
        ))}
      </div>

      <div className="dw-field-label">补充剪辑 / 主线锁定要求（可选 · 自动预筛未使用的黄金钩子）</div>
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
                              {fmtSec(s.start)}–{fmtSec(s.end)}
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
  const linesRef = useRef<HTMLDivElement>(null)
  const [playing, setPlaying] = useState(false)
  const [t, setT] = useState(0)
  const [dur, setDur] = useState(0)
  const [muted, setMuted] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [loopSeg, setLoopSeg] = useState(false)
  const [safeZone, setSafeZone] = useState(false)
  const [videoErr, setVideoErr] = useState(false)
  const [inspectedIdx, setInspectedIdx] = useState(0)

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
    setInspectedIdx(0)
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

  // 计算每段在合成时间轴上的起止偏移与当前命中段
  const totalSegDur = cut.clips.reduce((sum, c) => sum + Math.max(0.5, c.out - c.in), 0) || 1
  let accOffset = 0
  const segments = cut.clips.map((c, idx) => {
    const segDur = Math.max(0.5, c.out - c.in)
    const startAt = accOffset
    accOffset += segDur
    const active = playable && t >= startAt && (t < startAt + segDur - 0.02 || (idx === cut.clips.length - 1 && t >= startAt))
    return { c, idx, segDur, startAt, active }
  })
  const playingSeg = segments.find((s) => s.active)
  const currentSeg = playingSeg ?? segments[Math.min(inspectedIdx, Math.max(0, segments.length - 1))] ?? segments[0]

  // 时间轴元数据与播放状态分离：播放 / 拖动只更新游标，不重建 TimelineRow。
  const timelineSegments = useMemo(
    () =>
      cut.clips.map((c, idx) => ({
        key: `${c.epId}-${c.in}-${idx}`,
        label: c.role,
        color: ROLE_HEX[c.role] ?? '#3b82f6',
        seconds: Math.max(0.5, c.out - c.in),
        ep: `第 ${c.epN} 集`,
        sub: c.quote || c.why,
        title: `#${idx + 1} 第 ${c.epN} 集 ${fmtSec(c.in)}–${fmtSec(c.out)} · [${c.role}] ${c.why}`
      })),
    [cut.clips]
  )

  const seekToSeg = (idx: number, startAt: number): void => {
    setInspectedIdx(idx)
    const v = videoRef.current
    if (!v || !playable) return
    v.currentTime = startAt
    setT(startAt)
  }

  const currentIdx = currentSeg?.idx ?? 0
  useEffect(() => {
    const box = linesRef.current
    const row = box?.children[currentIdx] as HTMLElement | undefined
    if (!box || !row) return
    const r = row.getBoundingClientRect()
    const b = box.getBoundingClientRect()
    if (r.top < b.top) box.scrollTop += r.top - b.top - 4
    else if (r.bottom > b.bottom) box.scrollTop += r.bottom - b.bottom + 4
  }, [currentIdx, cut.id])

  const cycleSpeed = (): void => setSpeed((s) => SPEEDS[(SPEEDS.indexOf(s) + 1) % SPEEDS.length])

  const jumpSeg = (delta: number): void => {
    if (segments.length === 0) return
    const idx = Math.min(segments.length - 1, Math.max(0, currentIdx + delta))
    seekToSeg(idx, segments[idx].startAt)
  }

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = speed
  }, [speed, cut.output, cut.revision])

  const keyHandlerRef = useRef<(e: KeyboardEvent) => void>(() => {})
  keyHandlerRef.current = (e) => {
    const target = e.target as HTMLElement
    if (target.closest('input, textarea, select, [contenteditable="true"], .ant-modal, .ant-drawer')) return
    if (e.code === 'Space') {
      if (target.closest('button')) return
      e.preventDefault()
      togglePlay()
    } else if (e.key === '[') {
      jumpSeg(-1)
    } else if (e.key === ']') {
      jumpSeg(1)
    } else if (e.key === 'l' || e.key === 'L') {
      setLoopSeg((v) => !v)
    } else if (e.key === 's' || e.key === 'S') {
      if (cut.ratio === '9:16') setSafeZone((v) => !v)
    }
  }
  useEffect(() => {
    const h = (e: KeyboardEvent): void => keyHandlerRef.current(e)
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  const seekTimeline = (value: number): void => {
    const nextIdx = segments.findIndex(
      (s) => value >= s.startAt && (value < s.startAt + s.segDur || s.idx === segments.length - 1)
    )
    if (nextIdx >= 0) setInspectedIdx(nextIdx)
    const v = videoRef.current
    if (v && playable) v.currentTime = value
    setT(value)
  }

  return (
    <>
      {/* 中央监视器 */}
      <section className="dw-stage" aria-label="成片监视器">
        <div className="dw-panel-head" style={{ marginBottom: 0 }}>
          <Space size={6} wrap style={{ minWidth: 0, flex: 1 }}>
            <span className="dw-panel-title" title={cut.title}>
              {cut.title}
            </span>
            <Tag color={STYLE_COLOR[cut.style]} style={{ marginInlineEnd: 0 }}>
              {CUT_STYLES[cut.style].name}
            </Tag>
            {cut.mode === 'hook-matrix' && (
              <Tag color="purple" style={{ marginInlineEnd: 0 }}>
                赛马矩阵
              </Tag>
            )}
            {cut.mode === 'viral-clone' && (
              <Tag color="volcano" style={{ marginInlineEnd: 0 }}>
                对标复刻
              </Tag>
            )}
            <Tag className="dw-mono" style={{ marginInlineEnd: 0 }}>
              v{cut.revision}
            </Tag>
          </Space>
          <span className="dw-sub dw-mono" style={{ flex: 'none' }}>
            {cut.ratio} · {fmtSec(cut.actualSec)}
          </span>
        </div>

        {segments.length > 0 && (
          <div className="dw-stage-hud">
            <span className="dw-now-pill">
              <span
                className="dw-tl-dot"
                style={{ background: ROLE_HEX[currentSeg?.c.role ?? ''] ?? '#3b82f6' }}
              />
              <span className="dw-now-text">
                正在预览：#{(currentSeg?.idx ?? 0) + 1} {currentSeg?.c.role} · 第 {currentSeg?.c.epN} 集
              </span>
            </span>
            <span className="dw-kbd-tips">
              <span className="dw-kbd-chip">Space 播放</span>
              <span className="dw-kbd-chip">[ / ] 切换段落</span>
              <span className="dw-kbd-chip">L 单段循环</span>
              <span className="dw-kbd-chip">S 安全区</span>
            </span>
          </div>
        )}

        <div
          className={cut.ratio === '9:16' ? 'dw-player' : 'dw-player dw-player-wide'}
          style={
            { '--player-glow': `${ROLE_HEX[currentSeg?.c.role ?? ''] ?? '#3b82f6'}26` } as CSSProperties
          }
        >
          {playable ? (
            <>
              <video
                key={`${cut.output}-${cut.revision}`}
                ref={videoRef}
                src={mediaUrl(cut.output!)}
                width={cut.ratio === '9:16' ? 296 : 520}
                height={cut.ratio === '9:16' ? 526 : 292}
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
                onLoadedMetadata={(e) => {
                  setDur(e.currentTarget.duration)
                  e.currentTarget.playbackRate = speed
                }}
                onTimeUpdate={(e) => {
                  const v = e.currentTarget
                  let ct = v.currentTime
                  if (loopSeg && segments.length > 0) {
                    const seg =
                      segments.find((s) => ct >= s.startAt && ct < s.startAt + s.segDur) ??
                      segments[segments.length - 1]
                    if (ct >= seg.startAt + seg.segDur - 0.05) {
                      v.currentTime = seg.startAt
                      ct = seg.startAt
                    }
                  }
                  setT(ct)
                }}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onEnded={() => {
                  if (loopSeg && segments.length > 0 && videoRef.current) {
                    videoRef.current.currentTime = segments[segments.length - 1].startAt
                    void videoRef.current.play().catch(() => setVideoErr(true))
                  } else {
                    setPlaying(false)
                  }
                }}
                onError={() => setVideoErr(true)}
              />
              <button
                type="button"
                className={`dw-play-overlay${playing ? ' is-playing' : ''}`}
                onClick={togglePlay}
                aria-label={playing ? '暂停' : '播放'}
              >
                {playing ? <PauseOutlined /> : <CaretRightOutlined />}
              </button>
              <div className="dw-beat-badge">
                <span
                  className="dw-tl-dot"
                  style={{ background: ROLE_HEX[currentSeg?.c.role ?? ''] ?? '#3b82f6' }}
                />
                #{(currentSeg?.idx ?? 0) + 1} {currentSeg?.c.role}
              </div>
              {currentSeg?.c.quote && (
                <div className="dw-subtitle-wrap">
                  <span className="dw-subtitle">「{currentSeg.c.quote}」</span>
                </div>
              )}
              <div className={`dw-safezone${safeZone && cut.ratio === '9:16' ? ' is-visible' : ''}`}>
                <div className="dw-sz-top">顶部频道导航遮挡区</div>
                <div className="dw-sz-right">
                  <span className="dw-sz-dot" />
                  <span className="dw-sz-dot" />
                  <span className="dw-sz-dot" />
                  <span className="dw-sz-dot" />
                </div>
                <div className="dw-sz-bottom">底部剧名与引导挂载安全避让区</div>
              </div>
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

        <div className="dw-transport" role="group" aria-label="播放控制">
          <span className="dw-timecode">
            <span className="dw-time-cur">{fmtSec(t)}</span>
            <span className="dw-time-tot"> / {fmtSec(dur || cut.actualSec)}</span>
          </span>
          <div className="dw-ctrl-group">
            <Button
              size="small"
              type="text"
              icon={<StepBackwardOutlined />}
              disabled={!playable || segments.length === 0}
              onClick={() => jumpSeg(-1)}
              aria-label="上一段"
              title="上一段 ([)"
            />
            <button
              type="button"
              className="dw-btn-play-main"
              onClick={togglePlay}
              disabled={!playable}
              aria-label={playing ? '暂停' : '播放'}
              title="播放 / 暂停 (Space)"
            >
              {playing ? <PauseOutlined /> : <CaretRightOutlined />}
            </button>
            <Button
              size="small"
              type="text"
              icon={<StepForwardOutlined />}
              disabled={!playable || segments.length === 0}
              onClick={() => jumpSeg(1)}
              aria-label="下一段"
              title="下一段 (])"
            />
          </div>
          <div className="dw-ctrl-group">
            <button type="button" className="dw-speed-chip dw-mono" onClick={cycleSpeed} title="播放倍速">
              {speed}x
            </button>
            <Button
              size="small"
              type="text"
              className={loopSeg ? 'dw-ctrl-on' : undefined}
              icon={<RetweetOutlined />}
              onClick={() => setLoopSeg((v) => !v)}
              aria-label="循环当前段"
              aria-pressed={loopSeg}
              title="循环当前段 (L)"
            />
            <Button
              size="small"
              type="text"
              className={safeZone ? 'dw-ctrl-on' : undefined}
              icon={<BorderOutlined />}
              disabled={cut.ratio !== '9:16'}
              onClick={() => setSafeZone((v) => !v)}
              aria-label="安全区参考"
              aria-pressed={safeZone}
              title="抖音/TikTok 安全区参考 (S)"
            />
            <Button
              size="small"
              type="text"
              icon={muted ? <MutedOutlined /> : <SoundOutlined />}
              onClick={() => setMuted(!muted)}
              aria-label={muted ? '取消静音' : '静音'}
              aria-pressed={muted}
            />
          </div>
        </div>

        <div className="dw-tl-box">
          <div className="dw-tl-head">
            <span className="dw-sec-title" style={{ marginBottom: 0 }}>
              成片结构时间轴
              <span className="dw-tl-hint">共 {cut.clips.length} 段</span>
            </span>
            <span className="dw-sub dw-mono">
              当前 #{(currentSeg?.idx ?? 0) + 1}/{cut.clips.length}
            </span>
          </div>

          <TimelineScrubber
            ariaLabel="成片结构时间轴，拖动定位播放进度"
            duration={totalSegDur}
            value={Math.min(t, totalSegDur)}
            segments={timelineSegments}
            onChange={seekTimeline}
          />

          {currentSeg && (
            <div className="dw-tl-active-card">
              <div className="dw-tl-active-top">
                <Tag
                  style={{
                    marginInlineEnd: 0,
                    borderColor: 'transparent',
                    background: ROLE_HEX[currentSeg.c.role] ?? '#3b82f6',
                    color: roleText(currentSeg.c.role)
                  }}
                >
                  #{currentSeg.idx + 1} {currentSeg.c.role}
                </Tag>
                <span style={{ fontWeight: 600 }}>第 {currentSeg.c.epN} 集</span>
                <span className="dw-sub dw-mono">
                  {fmtSec(currentSeg.c.in)}–{fmtSec(currentSeg.c.out)}（{fmtSec(currentSeg.segDur)}）
                </span>
              </div>
              <div className="dw-tl-active-why">
                {currentSeg.c.why || '叙事关键推进片段'}
                {currentSeg.c.quote ? ` · 「${currentSeg.c.quote}」` : ''}
              </div>
            </div>
          )}

        </div>
      </section>

      {/* 右侧：AI 大师重剪与剪映交付 */}
      <aside className="dw-inspector" aria-label="AI 剪辑大师与交付文案">
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
              size="small"
              style={{ flex: 1 }}
              icon={<FolderOpenOutlined />}
              disabled={!playable}
              onClick={() => cut.output && openOutput(cut.output)}
            >
              打开成片目录
            </Button>
            <Popconfirm
              title="删除这条成片方案？"
              description="将同时删除已渲染的视频与字幕文件"
              okText="删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              onConfirm={() => deleteCut(d.id, cut.id)}
            >
              <Button size="small" danger icon={<DeleteOutlined />} aria-label="删除成片">
                删除
              </Button>
            </Popconfirm>
          </div>
        </div>

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
          <Space size={6} wrap style={{ marginTop: 8, marginBottom: 10 }}>
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
              options={[30, 45, 55, 60, 75, 90].map((v) => ({ value: v, label: `${v} 秒` }))}
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

          <div className="dw-copy-block" style={{ marginTop: 8 }}>
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

          <div style={{ marginTop: 8 }}>
            <div className="dw-field-label">冲突主线与节奏自检</div>
            <p className="dw-sub" style={{ margin: 0, lineHeight: 1.55, overflowWrap: 'anywhere' }}>
              {cut.conflictSummary}
              {cut.directorNote ? ` · ${cut.directorNote}` : ''}
            </p>
          </div>

          {cut.beats && cut.beats.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div className="dw-field-label">对标爆款 Beat Sheet 节拍骨架</div>
              <div className="dw-tl-legend" style={{ maxHeight: 88 }}>
                {cut.beats.map((b, i) => (
                  <span key={i} className="dw-tl-pill" title={`${b.emotion} · ${b.desc}`}>
                    <span className="dw-tl-dot" style={{ background: ROLE_HEX[b.role] ?? '#3b82f6' }} />
                    <span className="dw-mono">B{i + 1}</span>
                    <span>{b.role}</span>
                    <span className="dw-mono">{fmtSec(b.sec)}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="dw-panel">
          <div className="dw-panel-head">
            <span className="dw-panel-title">分镜明细（点击定位播放）</span>
            <span className="dw-sub dw-mono">
              {cut.clips.length} 段 · {fmtSec(cut.actualSec)}
            </span>
          </div>
          <div className="dw-lines" ref={linesRef}>
            {segments.map(({ c, idx, startAt }) => {
              const isSelected = currentSeg?.idx === idx
              return (
                <button
                  type="button"
                  className={`dw-clip-row${isSelected ? ' is-now' : ''}`}
                  key={`${c.epId}-${c.in}-${idx}`}
                  onClick={() => seekToSeg(idx, startAt)}
                >
                  <span className="dw-clip-order">{idx + 1}</span>
                  <div className="dw-clip-body">
                    <div className="dw-clip-meta">
                      <Tag style={{ marginInlineEnd: 0 }}>{c.role}</Tag>
                      <span style={{ fontWeight: 500 }}>第 {c.epN} 集</span>
                      <span className="dw-sub dw-mono">
                        {fmtSec(c.in)}–{fmtSec(c.out)}
                      </span>
                    </div>
                    <div className="dw-clip-why">{c.why}</div>
                  </div>
                </button>
              )
            })}
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
        <div className="dw-page-head-main">
          <h2 className="dw-page-title">{d.title}</h2>
          <p className="dw-page-desc">
            {d.synthesis?.logline || `共 ${d.episodes.length} 集 · 导出纯净无字幕无配乐成片，直接进剪映二次精修`}
          </p>
        </div>
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
            image={<ScissorOutlined style={{ fontSize: 42, color: 'var(--text-muted)' }} />}
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
              <span className="dw-sub dw-mono">
                {cuts.filter((c) => c.status === 'ready').length}/{cuts.length} 就绪
              </span>
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
                    {c.mode === 'hook-matrix' && (
                      <Tag color="purple" style={{ marginInlineEnd: 0 }}>
                        赛马
                      </Tag>
                    )}
                    {c.mode === 'viral-clone' && (
                      <Tag color="volcano" style={{ marginInlineEnd: 0 }}>
                        复刻
                      </Tag>
                    )}
                    <Tag className="dw-mono" style={{ marginInlineEnd: 0 }}>
                      v{c.revision}
                    </Tag>
                    <span className="dw-spacer" />
                    <span className="dw-sub dw-mono">
                      {c.clips.length}段 · {fmtSec(c.actualSec)}
                    </span>
                  </div>
                  <div className="dw-cut-item-title" title={c.title}>
                    {c.title}
                  </div>
                  <div className="dw-cut-item-meta">
                    {c.status === 'ready' && <Tag color="success" style={{ marginInlineEnd: 0 }}>可导出</Tag>}
                    {c.status === 'rendering' && <Tag color="processing" style={{ marginInlineEnd: 0 }}>渲染 {c.pct ?? 0}%</Tag>}
                    {c.status === 'draft' && <Tag style={{ marginInlineEnd: 0 }}>待渲染</Tag>}
                    {c.status === 'fail' && <Tag color="error" style={{ marginInlineEnd: 0 }}>失败</Tag>}
                    <span className="dw-cut-hook" title={c.hookHeadline}>
                      {c.hookHeadline}
                    </span>
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
              AI 再剪新思路 / 赛马 / 复刻
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
        <div className="dw-page-head-main">
          <h2 className="dw-page-title">AI 短剧智剪</h2>
          <p className="dw-page-desc">
            导入短剧后全自动分析冲突与人物，产出高转化引流切片与配套文案，拖入剪映即可发布。
          </p>
        </div>
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
            image={<InboxOutlined style={{ fontSize: 44, color: 'var(--text-muted)' }} />}
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
            const totalHl = d.episodes.reduce((s, e) => s + (e.candidates?.length ?? 0), 0)
            return (
              <div className="dw-project-card" key={d.id}>
                <div className="dw-project-top">
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <button
                      type="button"
                      className="dw-project-title-btn"
                      onClick={() => openDrama(d.id)}
                      title={d.title}
                    >
                      {d.title}
                    </button>
                    <div className="dw-project-dir" title={d.dir}>
                      {d.dir}
                    </div>
                  </div>
                  {st === 'done' && <Tag color="success" style={{ marginInlineEnd: 0 }}>已掌握全剧</Tag>}
                  {(st === 'run' || st === 'queue') && (
                    <Tag color="processing" style={{ marginInlineEnd: 0 }}>分析 {d.global?.pct ?? 0}%</Tag>
                  )}
                  {st === 'fail' && <Tag color="error" style={{ marginInlineEnd: 0 }}>分析失败</Tag>}
                  {st === 'idle' && <Tag style={{ marginInlineEnd: 0 }}>待分析</Tag>}
                </div>

                {d.synthesis?.logline && (
                  <p className="dw-sub" style={{ margin: 0, lineHeight: 1.55, overflowWrap: 'anywhere' }}>
                    {d.synthesis.logline}
                  </p>
                )}

                <div className="dw-project-stats">
                  <span className="dw-mono">{d.episodes.length} 集</span>
                  {totalHl > 0 && (
                    <>
                      <span>·</span>
                      <span className="dw-mono">高光 {totalHl} 处</span>
                    </>
                  )}
                  <span>·</span>
                  <span>
                    引流成片：<b style={{ color: readyN > 0 ? 'var(--accent)' : undefined }}>{readyN}</b> / {totalN} 条就绪
                  </span>
                  {replicaTotal > 0 && (
                    <>
                      <span>·</span>
                      <span>
                        复刻：<b style={{ color: replicaReady > 0 ? '#7c3aed' : undefined }}>{replicaReady}</b> / {replicaTotal}
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
