import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import {
  IconCopy,
  IconTrash,
  IconFlask,
  IconFlame,
  IconFolderOpen,
  IconGlobe,
  IconImport,
  IconInbox,
  IconBack,
  IconPlus,
  IconScript,
  IconReload,
  IconScan,
  IconCut,
  IconSliders,
  IconStop,
  IconBolt,
  IconVideo
} from '../icons'
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
import type { CutMode, CutStyle, CutStyleConfig, Drama, GlobalScript, PromoCut } from '../../../shared/types'
import { DEFAULT_CUT_STYLES, withPublishTags } from '../../../shared/types'
import { findDrama, fmtSec, useLibrary } from '../library'
import { toast, useStore } from '../store'
import ReviewPlayer from '../ReviewPlayer'
import type { ReviewSegment, SeekRequest } from '../ReviewPlayer'
import { ReplicaCreateForm, ReplicaWorkspace } from './Replica'
import type { ReplicaFormHandle } from './Replica'

const STYLE_COLOR: Record<string, string> = {
  auto: 'default',
  conflict: 'red',
  reversal: 'gold',
  suspense: 'cyan'
}

const resolveStyleMeta = (styles: CutStyleConfig[], id?: string): { name: string; color: string } => {
  if (!id || id === 'auto') return { name: '自由定调', color: 'default' }
  const found = styles.find((s) => s.id === id) ?? DEFAULT_CUT_STYLES.find((s) => s.id === id)
  return {
    name: found?.name ?? id,
    color: STYLE_COLOR[id] ?? 'blue'
  }
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

const DURATION_OPTIONS = [
  { value: 0, label: '不限时长', short: '不限' },
  { value: 30, label: '30 秒', short: '30秒' },
  { value: 45, label: '45 秒', short: '45秒' },
  { value: 55, label: '55 秒', short: '55秒' },
  { value: 60, label: '60 秒', short: '60秒' },
  { value: 75, label: '75 秒', short: '75秒' },
  { value: 90, label: '90 秒', short: '90秒' },
  { value: 120, label: '2 分钟', short: '2分' },
  { value: 180, label: '3 分钟', short: '3分' },
  { value: 300, label: '5 分钟', short: '5分' },
  { value: 600, label: '10 分钟', short: '10分' }
]

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

function NewCutModal({
  d,
  open,
  onClose,
  initialMode
}: {
  d: Drama
  open: boolean
  onClose: () => void
  initialMode?: CutMode | 'replica'
}): ReactElement {
  const generateCut = useLibrary((s) => s.generateCut)
  const pickVideoFile = useLibrary((s) => s.pickVideoFile)
  const styles = useLibrary((s) => s.settings?.styles ?? DEFAULT_CUT_STYLES)
  const goto = useStore((s) => s.goto)
  const analyzed = d.global?.status === 'done'

  const [mode, setMode] = useState<CutMode | 'replica'>('independent')
  const [replicaBusy, setReplicaBusy] = useState(false)
  const replicaFormRef = useRef<ReplicaFormHandle>(null)

  useEffect(() => {
    if (open) setMode(initialMode ?? (d.global?.status === 'done' ? 'independent' : 'replica'))
  }, [open, initialMode])
  const [style, setStyle] = useState<CutStyle>('auto')
  const [targetSec, setTargetSec] = useState(45)
  const [ratio, setRatio] = useState<'9:16' | '16:9'>('9:16')
  const [count, setCount] = useState(1)
  const [prompt, setPrompt] = useState('')
  const [refVideoPath, setRefVideoPath] = useState('')
  const [refCopy, setRefCopy] = useState('')
  const [busy, setBusy] = useState(false)

  const changeMode = (nextMode: CutMode | 'replica'): void => {
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
    if (mode === 'replica') return
    if (mode === 'viral-clone' && !refVideoPath && !refCopy.trim() && !prompt.trim()) {
      toast('请选择参考视频，或填写参考文案 / 套用下方爆款结构', 'info')
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
            ? `已开始生成 ${effectiveCount} 条多钩子测试切片`
            : mode === 'viral-clone'
              ? '已开始解析对标爆款并复刻生成'
              : `已加入智剪队列（共 ${effectiveCount} 条）`
        toast(msg)
        setPrompt('')
        onClose()
      })
      .catch((e: unknown) => toast(e instanceof Error ? e.message : '发起失败', 'info'))
      .finally(() => setBusy(false))
  }

  const selectedStyle = styles.find((s) => s.id === style)

  return (
    <Modal
      title="新建成片"
      open={open}
      onCancel={onClose}
      onOk={() => (mode === 'replica' ? replicaFormRef.current?.submit() : submit())}
      okText={
        mode === 'replica'
          ? '开始重拼'
          : mode === 'hook-matrix'
            ? `生成 ${Math.max(2, count)} 条测试`
            : mode === 'viral-clone'
              ? '开始对标复刻'
              : `生成 ${count} 条成片`
      }
      cancelText="取消"
      confirmLoading={mode === 'replica' ? replicaBusy : busy}
      width={mode === 'replica' ? 600 : 580}
    >
      <Segmented
        block
        value={mode}
        onChange={(v) => changeMode(v as CutMode | 'replica')}
        options={[
          { value: 'independent', label: '标准智剪', icon: <IconBolt />, disabled: !analyzed },
          { value: 'hook-matrix', label: '多钩子测试', icon: <IconFlask />, disabled: !analyzed },
          { value: 'viral-clone', label: '对标爆款', icon: <IconFlame />, disabled: !analyzed },
          { value: 'replica', label: '溯源重拼', icon: <IconImport /> }
        ]}
        style={{ marginBottom: 6 }}
      />
      <p className="dw-sub" style={{ marginTop: 0, marginBottom: 14 }}>
        {mode === 'independent' && 'AI 自动挑选高冲突主线，生成独立引流切片。'}
        {mode === 'hook-matrix' && '同一条主线故事，自动搭配多个不同的前 3 秒开场用于投流测试。'}
        {mode === 'viral-clone' && '上传参考视频或套用爆款结构，AI 提取节拍后 1:1 复刻到本剧。'}
        {mode === 'replica' &&
          '导入本剧剪辑产物作参考，逐帧溯源出处后用原片原画幅、原生帧率、原声对白重拼干净成片（无水印/无字幕/无镜像）。'}
        {!analyzed && ' 全局分析未完成，前三种智剪模式暂不可用；溯源重拼不依赖分析。'}
      </p>

      {mode !== 'replica' && (
        <>
          <div className="dw-field-grid is-compact" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
            <div className="dw-field">
              <span className="dw-field-label">{mode === 'hook-matrix' ? '开场钩子数' : '生成条数'}</span>
              <div className="dw-field-control">
                <Select
                  value={mode === 'hook-matrix' ? Math.max(2, count) : count}
                  onChange={setCount}
                  options={(mode === 'hook-matrix' ? [2, 3, 4, 5] : [1, 2, 3, 4, 5]).map((v) => ({
                    value: v,
                    label: mode === 'hook-matrix' ? `${v} 个版本` : `${v} 条`
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
                  options={DURATION_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
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

          <div style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <span className="dw-field-label" style={{ marginBottom: 0 }}>
                叙事风格（可选）
              </span>
              <Button
                size="small"
                type="link"
                icon={<IconSliders />}
                style={{ paddingInline: 0, height: 'auto' }}
                onClick={() => {
                  onClose()
                  goto('settings')
                }}
              >
                自定义风格
              </Button>
            </div>
            <Select
              style={{ width: '100%' }}
              value={style}
              onChange={(v) => {
                setStyle(v)
                const found = styles.find((s) => s.id === v)
                if (found && found.defaultTarget >= 0) setTargetSec(found.defaultTarget)
              }}
              options={[
                { value: 'auto', label: 'AI 自动定调（不限定风格）' },
                ...styles.map((s) => ({ value: s.id, label: s.name }))
              ]}
            />
            {selectedStyle?.desc && (
              <p className="dw-sub" style={{ marginTop: 4, marginBottom: 0 }}>
                {selectedStyle.desc}
              </p>
            )}
          </div>

          {mode === 'viral-clone' && (
            <>
              <div className="dw-copy-block" style={{ marginBottom: 12 }}>
                <div className="dw-field-label">参考视频（可选）</div>
                <div className="dw-dir" style={{ marginBottom: 8 }}>
                  <span className="dw-dir-path" title={refVideoPath}>
                    {refVideoPath || '未选择参考视频（也可仅靠下方文案或母版复刻）'}
                  </span>
                  {refVideoPath && (
                    <Button size="small" type="text" onClick={() => setRefVideoPath('')}>
                      清除
                    </Button>
                  )}
                  <Button size="small" icon={<IconVideo />} onClick={pickRefVideo}>
                    选择视频
                  </Button>
                </div>
                <div className="dw-field-label">参考台词或结构描述（可选）</div>
                <Input.TextArea
                  className="dw-auto-textarea"
                  value={refCopy}
                  onChange={(e) => setRefCopy(e.target.value)}
                  placeholder="粘贴对标爆款的台词文案或分镜节奏，AI 将按相同情绪曲线复刻"
                />
              </div>

              <div className="dw-field-label">常用爆款结构（可选 · 点击填入）</div>
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
            </>
          )}

          <div className="dw-field-label">补充要求（可选）</div>
          <Input.TextArea
            className="dw-auto-textarea"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="例如：重点突出女主亮明身份打脸反派，把第 6 集的耳光放最前面做钩子"
          />
        </>
      )}

      {mode === 'replica' && (
        <ReplicaCreateForm ref={replicaFormRef} d={d} active={open} onDone={onClose} onBusyChange={setReplicaBusy} />
      )}
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
  const stopTasks = useLibrary((s) => s.stopTasks)
  const setPublishTags = useLibrary((s) => s.setPublishTags)
  const styles = useLibrary((s) => s.settings?.styles ?? DEFAULT_CUT_STYLES)

  const linesRef = useRef<HTMLDivElement>(null)
  const seekSeqRef = useRef(0)
  const [currentIdx, setCurrentIdx] = useState(0)
  const [seekRequest, setSeekRequest] = useState<SeekRequest | null>(null)
  const [inspectorTab, setInspectorTab] = useState<'craft' | 'clips'>('craft')

  const [instruction, setInstruction] = useState('')
  const [nextStyle, setNextStyle] = useState<CutStyle>(cut.style || 'auto')
  const [nextTarget, setNextTarget] = useState<number>(cut.targetSec)
  const [regenBusy, setRegenBusy] = useState(false)
  const [tagInput, setTagInput] = useState('')

  useEffect(() => {
    setCurrentIdx(0)
    setSeekRequest(null)
    setNextStyle(cut.style || 'auto')
    setNextTarget(cut.targetSec)
    setInstruction('')
  }, [cut.id, cut.revision, cut.output])

  const playable = cut.status === 'ready' && Boolean(cut.output)
  const styleMeta = resolveStyleMeta(styles, cut.style)

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

  const publishTags = d.publishTags ?? []
  const fullPublishCopy = withPublishTags(cut.publishCopy, publishTags)

  const saveTags = (next: string[]): void => {
    setPublishTags(d.id, next).catch((e: unknown) => toast(e instanceof Error ? e.message : '标签保存失败', 'info'))
  }

  const commitTagInput = (): void => {
    const parts = tagInput.split(/[\s,，、]+/).filter(Boolean)
    setTagInput('')
    if (parts.length > 0) saveTags([...publishTags, ...parts])
  }

  const { segments, totalSegDur, reviewSegments } = useMemo(() => {
    let accOffset = 0
    const segs = cut.clips.map((c, idx) => {
      const segDur = Math.max(0.5, c.out - c.in)
      const startAt = accOffset
      accOffset += segDur
      return { c, idx, segDur, startAt }
    })
    const rSegs: ReviewSegment[] = cut.clips.map((c, idx) => ({
      key: `${c.epId}-${c.in}-${idx}`,
      label: c.role,
      color: ROLE_HEX[c.role] ?? '#3b82f6',
      seconds: Math.max(0.5, c.out - c.in),
      ep: `第 ${c.epN} 集`,
      sub: c.quote || c.why,
      quote: c.quote,
      why: c.why,
      sourceRange: `${fmtSec(c.in)}–${fmtSec(c.out)}`,
      title: `#${idx + 1} 第 ${c.epN} 集 ${fmtSec(c.in)}–${fmtSec(c.out)} · [${c.role}] ${c.why}`
    }))
    return { segments: segs, totalSegDur: accOffset || 1, reviewSegments: rSegs }
  }, [cut.clips])

  const currentSeg = segments[Math.min(currentIdx, Math.max(0, segments.length - 1))] ?? segments[0]

  const seekToSeg = (idx: number, startAt: number): void => {
    setCurrentIdx(idx)
    seekSeqRef.current += 1
    setSeekRequest({ time: startAt, idx, seq: seekSeqRef.current })
  }

  useEffect(() => {
    const box = linesRef.current
    const row = box?.children[currentIdx] as HTMLElement | undefined
    if (!box || !row) return
    const r = row.getBoundingClientRect()
    const b = box.getBoundingClientRect()
    if (r.top < b.top) box.scrollTop += r.top - b.top - 4
    else if (r.bottom > b.bottom) box.scrollTop += r.bottom - b.bottom + 4
  }, [currentIdx, cut.id])

  return (
    <>
      {/* 中央审查监视器 */}
      <ReviewPlayer
        src={cut.output}
        playable={playable}
        ratio={cut.ratio}
        resetKey={`${cut.id}-${cut.output ?? ''}-${cut.revision}`}
        segments={reviewSegments}
        duration={totalSegDur}
        seekRequest={seekRequest}
        onActiveIdxChange={setCurrentIdx}
        timelineTitle="成片结构时间轴"
        timelineHint={`共 ${cut.clips.length} 段`}
        ariaLabel="成片监视器"
        headerLeft={
          <Space size={6} wrap style={{ minWidth: 0 }}>
            <span className="dw-panel-title" title={cut.title}>
              {cut.title}
            </span>
            <Tag color={styleMeta.color} style={{ marginInlineEnd: 0 }}>
              {styleMeta.name}
            </Tag>
            {cut.mode === 'hook-matrix' && (
              <Tag color="purple" style={{ marginInlineEnd: 0 }}>
                多钩子
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
        }
        headerRight={
          <span className="dw-sub dw-mono">
            {cut.ratio} · {fmtSec(cut.actualSec)}
          </span>
        }
        emptyContent={
          cut.status === 'rendering' ? (
            <>
              <Spin />
              <span className="dw-sub" style={{ color: '#e4e4e7' }}>
                正在渲染纯净成片 {cut.pct ?? 0}%…
              </span>
              <Progress percent={cut.pct ?? 0} size="small" style={{ width: '78%' }} showInfo={false} />
              <Button
                size="small"
                danger
                icon={<IconStop />}
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
              <Button size="small" type="primary" icon={<IconReload />} onClick={() => renderCut(d.id, cut.id)}>
                重新渲染
              </Button>
            </>
          )
        }
      />

      {/* 右侧：精简双标签工作台（目录 + AI重剪与文案 / 分镜明细） */}
      <aside className="dw-inspector" aria-label="AI 剪辑大师与交付文案">
        <div className="dw-panel" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Button
            type="primary"
            style={{ flex: 1 }}
            icon={<IconFolderOpen />}
            disabled={!playable}
            onClick={() => cut.output && openOutput(cut.output)}
          >
            打开切片目录
          </Button>
          <Popconfirm
            title="删除这条成片方案？"
            description="将同时删除已渲染的视频与字幕文件"
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={() => deleteCut(d.id, cut.id)}
          >
            <Button danger icon={<IconTrash />} title="删除成片" aria-label="删除成片" />
          </Popconfirm>
        </div>

        <div className="dw-panel" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Segmented
            block
            value={inspectorTab}
            onChange={(v) => setInspectorTab(v as 'craft' | 'clips')}
            options={[
              { value: 'craft', label: 'AI 重剪 & 文案' },
              { value: 'clips', label: `分镜明细 (${cut.clips.length})` }
            ]}
          />

          {inspectorTab === 'craft' ? (
            <>
              <div>
                <div className="dw-panel-head" style={{ marginBottom: 6 }}>
                  <span className="dw-panel-title">AI 重剪指令</span>
                  <span className="dw-sub">⌘/Ctrl + Enter</span>
                </div>
                <Input.TextArea
                  className="dw-auto-textarea"
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  placeholder="例如：开头 3 秒不够炸，把第 5 集反击提前；留空则换个思路重出"
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
                    style={{ width: 108 }}
                    options={[
                      { value: 'auto', label: '自由定调' },
                      ...styles.map((s) => ({ value: s.id, label: s.name }))
                    ]}
                  />
                  <Select
                    size="small"
                    value={nextTarget}
                    onChange={setNextTarget}
                    style={{ width: 84 }}
                    options={DURATION_OPTIONS.map((o) => ({ value: o.value, label: o.short }))}
                  />
                  <span className="dw-spacer" />
                  <Button
                    type="primary"
                    icon={<IconBolt />}
                    loading={regenBusy}
                    disabled={cut.status === 'rendering'}
                    onClick={() => doRegen()}
                  >
                    重新生成
                  </Button>
                </div>
              </div>

              <div className="dw-copy-block">
                <div className="dw-copy-head">
                  <span className="dw-field-label">开场 3 秒花字</span>
                  <Button size="small" type="link" icon={<IconCopy />} onClick={() => copyText(cut.hookHeadline, '花字标题')}>
                    复制
                  </Button>
                </div>
                <div className="dw-hook-box">{cut.hookHeadline || '—'}</div>
              </div>

              <div className="dw-copy-block">
                <div className="dw-copy-head">
                  <span className="dw-field-label">引流发布文案</span>
                  <Button size="small" type="link" icon={<IconCopy />} onClick={() => copyText(fullPublishCopy, '发布文案')}>
                    复制
                  </Button>
                </div>
                <p className="dw-reason" style={{ whiteSpace: 'pre-wrap' }}>
                  {cut.publishCopy || '—'}
                </p>
                <div className="dw-tag-row">
                  {publishTags.map((t) => (
                    <Tag
                      key={t}
                      color="blue"
                      closable
                      onClose={(e) => {
                        e.preventDefault()
                        saveTags(publishTags.filter((x) => x !== t))
                      }}
                    >
                      {t}
                    </Tag>
                  ))}
                  <Input
                    size="small"
                    className="dw-tag-input"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onPressEnter={(e) => {
                      if (e.nativeEvent.isComposing || e.keyCode === 229) return
                      commitTagInput()
                    }}
                    onBlur={commitTagInput}
                    placeholder={publishTags.length > 0 ? '继续添加标签' : '添加标签，如 #爽剧'}
                    aria-label="添加本剧话题标签"
                    maxLength={60}
                  />
                </div>
                <div className="dw-tag-hint">本剧通用标签 · 自动追加到该剧所有发布文案末尾，复制时一并带上</div>
              </div>

              <Collapse
                ghost
                size="small"
                items={[
                  {
                    key: 'notes',
                    label: <span className="dw-sub">导演笔记与节拍自检</span>,
                    children: (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <p className="dw-sub" style={{ margin: 0, lineHeight: 1.55, overflowWrap: 'anywhere' }}>
                          {cut.conflictSummary}
                          {cut.directorNote ? ` · ${cut.directorNote}` : ''}
                        </p>
                        {cut.beats && cut.beats.length > 0 && (
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
                        )}
                      </div>
                    )
                  }
                ]}
              />
            </>
          ) : (
            <div className="dw-lines" style={{ maxHeight: 'calc(100dvh - 300px)' }} ref={linesRef}>
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
          )}
        </div>
      </aside>
    </>
  )
}

const REPLICA_STATUS_LABEL = {
  queue: '排队中',
  indexing: '建索引',
  tracing: '溯源中',
  cutting: '重剪中',
  ready: '已就绪',
  fail: '失败'
} as const

function DramaStudio({ d }: { d: Drama }): ReactElement {
  const backToProjects = useStore((s) => s.backToProjects)
  const selectedCutId = useStore((s) => s.selectedCutId)
  const selectCut = useStore((s) => s.selectCut)
  const selectedReplicaId = useStore((s) => s.selectedReplicaId)
  const selectReplica = useStore((s) => s.selectReplica)
  const rescan = useLibrary((s) => s.rescan)
  const stopTasks = useLibrary((s) => s.stopTasks)
  const styles = useLibrary((s) => s.settings?.styles ?? DEFAULT_CUT_STYLES)

  const [analyzeOpen, setAnalyzeOpen] = useState(false)
  const [newCutOpen, setNewCutOpen] = useState(false)
  const [newCutInitialMode, setNewCutInitialMode] = useState<CutMode | 'replica' | undefined>(undefined)
  const [scriptOpen, setScriptOpen] = useState(false)
  const [rescanning, setRescanning] = useState(false)

  const openNewCut = (mode?: CutMode | 'replica'): void => {
    setNewCutInitialMode(mode)
    setNewCutOpen(true)
  }

  const cuts = d.cuts ?? []
  const replicas = d.replicas ?? []
  const g = d.global

  const schemeItems = useMemo(() => {
    const list = [
      ...cuts.map((c) => ({ kind: 'cut' as const, id: c.id, createdAt: c.createdAt, cut: c })),
      ...replicas.map((r) => ({ kind: 'replica' as const, id: r.id, createdAt: r.createdAt, replica: r }))
    ]
    list.sort((a, b) => b.createdAt - a.createdAt)
    return list
  }, [cuts, replicas])

  const activeReplica =
    (selectedReplicaId ? replicas.find((r) => r.id === selectedReplicaId) : undefined) ??
    (!selectedCutId && schemeItems[0]?.kind === 'replica' ? schemeItems[0].replica : null)
  const activeCut =
    !activeReplica
      ? (selectedCutId ? cuts.find((c) => c.id === selectedCutId) : undefined) ??
        (schemeItems[0]?.kind === 'cut' ? schemeItems[0].cut : cuts[0] ?? null)
      : null

  const readyCount =
    cuts.filter((c) => c.status === 'ready').length + replicas.filter((r) => r.status === 'ready').length

  const doRescan = (): void => {
    setRescanning(true)
    rescan(d.id)
      .then(({ added }) => toast(added > 0 ? `新增 ${added} 集` : '没有发现新剧集文件', added > 0 ? 'success' : 'info'))
      .catch((e: unknown) => toast(e instanceof Error ? e.message : '扫描失败', 'info'))
      .finally(() => setRescanning(false))
  }

  return (
    <div>
      <div className="dw-studio-head">
        <div className="dw-studio-head-left">
          <Button icon={<IconBack />} onClick={backToProjects} aria-label="返回项目列表" title="返回项目列表" />
          <div className="dw-studio-title-wrap">
            <div className="dw-studio-title-row">
              <h2 className="dw-page-title" title={d.title}>{d.title}</h2>
              <span className="dw-sub dw-mono">{d.episodes.length} 集</span>
            </div>
            {d.synthesis?.logline && (
              <p className="dw-studio-logline" title={d.synthesis.logline}>
                {d.synthesis.logline}
              </p>
            )}
          </div>
        </div>

        <div className="dw-studio-head-right">
          <Space size={6} wrap>
            <Button
              icon={<IconScan />}
              loading={rescanning}
              onClick={doRescan}
              title="重新扫描剧集目录"
              aria-label="重新扫描"
            />
            <Button
              icon={<IconScript />}
              disabled={g?.status !== 'done'}
              onClick={() => setScriptOpen(true)}
            >
              剧本
            </Button>
            <Button
              icon={<IconGlobe />}
              loading={g?.status === 'run' || g?.status === 'queue'}
              onClick={() => setAnalyzeOpen(true)}
            >
              {g?.status === 'done' ? '重分析' : '全局分析'}
            </Button>
            <Button
              type="primary"
              icon={<IconPlus />}
              onClick={() => openNewCut()}
            >
              新建成片
            </Button>
          </Space>
        </div>
      </div>

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
              icon={<IconStop />}
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

      {schemeItems.length === 0 ? (
        <div className="dw-panel" style={{ padding: '48px 20px', textAlign: 'center' }}>
          <Empty
            image={<IconCut style={{ fontSize: 42, color: 'var(--text-muted)' }} />}
            description={
              g?.status === 'done'
                ? '全剧已分析完成，可立即新建成片：AI 智剪或导入参考切片溯源重拼'
                : '尚未生成成片方案：可一键分析全剧自动出片，或先导入参考切片溯源重拼（无需分析）'
            }
          >
            <Space>
              {g?.status === 'done' ? (
                <Button type="primary" icon={<IconBolt />} onClick={() => openNewCut()}>
                  AI 智剪第一批成片
                </Button>
              ) : (
                <>
                  <Button
                    type="primary"
                    icon={<IconBolt />}
                    loading={g?.status === 'run' || g?.status === 'queue'}
                    onClick={() => setAnalyzeOpen(true)}
                  >
                    一键 AI 全局分析并出片
                  </Button>
                  <Button icon={<IconImport />} onClick={() => openNewCut('replica')}>
                    溯源重拼（无需分析）
                  </Button>
                </>
              )}
            </Space>
          </Empty>
        </div>
      ) : (
        <div className="dw-nle-grid">
          <aside className="dw-panel" aria-label="成片方案列表">
            <div className="dw-panel-head">
              <span className="dw-panel-title">成片方案</span>
              <span className="dw-sub dw-mono">
                {readyCount}/{schemeItems.length} 就绪
              </span>
            </div>
            <div className="dw-cut-list">
              {schemeItems.map((item) => {
                if (item.kind === 'cut') {
                  const c = item.cut
                  const stMeta = resolveStyleMeta(styles, c.style)
                  const isActive = activeCut?.id === c.id
                  return (
                    <button
                      type="button"
                      key={c.id}
                      className={`dw-cut-item${isActive ? ' is-active' : ''}`}
                      onClick={() => {
                        selectReplica(null)
                        selectCut(c.id)
                      }}
                    >
                      <div className="dw-cut-item-top">
                        <span className="dw-cut-item-title" style={{ marginTop: 0, flex: 1 }} title={c.title}>
                          {c.title}
                        </span>
                        {c.status === 'ready' && <Tag color="success" style={{ marginInlineEnd: 0 }}>已就绪</Tag>}
                        {c.status === 'rendering' && <Tag color="processing" style={{ marginInlineEnd: 0 }}>渲染 {c.pct ?? 0}%</Tag>}
                        {c.status === 'draft' && <Tag style={{ marginInlineEnd: 0 }}>待渲染</Tag>}
                        {c.status === 'fail' && <Tag color="error" style={{ marginInlineEnd: 0 }}>失败</Tag>}
                      </div>
                      <div className="dw-cut-item-meta">
                        <Tag color={stMeta.color} style={{ marginInlineEnd: 0 }}>
                          {stMeta.name}
                        </Tag>
                        {c.mode === 'hook-matrix' && (
                          <Tag color="purple" style={{ marginInlineEnd: 0 }}>
                            多钩子
                          </Tag>
                        )}
                        {c.mode === 'viral-clone' && (
                          <Tag color="volcano" style={{ marginInlineEnd: 0 }}>
                            复刻
                          </Tag>
                        )}
                        <span className="dw-spacer" />
                        <span className="dw-sub dw-mono">
                          v{c.revision} · {c.clips.length}段 · {fmtSec(c.actualSec)}
                        </span>
                      </div>
                    </button>
                  )
                }

                const r = item.replica
                const isActive = activeReplica?.id === r.id
                const running = r.status !== 'ready' && r.status !== 'fail' && r.status !== 'queue'
                return (
                  <button
                    type="button"
                    key={r.id}
                    className={`dw-cut-item${isActive ? ' is-active' : ''}`}
                    onClick={() => {
                      selectCut(null)
                      selectReplica(r.id)
                    }}
                  >
                    <div className="dw-cut-item-top">
                      <span className="dw-cut-item-title" style={{ marginTop: 0, flex: 1 }} title={r.clipTitle}>
                        {r.clipTitle}
                      </span>
                      <Tag
                        color={r.status === 'ready' ? 'success' : r.status === 'fail' ? 'error' : r.status === 'queue' ? 'default' : 'processing'}
                        style={{ marginInlineEnd: 0 }}
                      >
                        {REPLICA_STATUS_LABEL[r.status]}
                        {running ? ` ${r.pct}%` : ''}
                      </Tag>
                    </div>
                    <div className="dw-cut-item-meta">
                      <Tag color="purple" style={{ marginInlineEnd: 0 }}>
                        溯源重拼
                      </Tag>
                      <span className="dw-spacer" />
                      <span className="dw-sub dw-mono">
                        {r.stats ? `${r.stats.segments}段 · ${fmtSec(r.stats.totalSeconds)}` : (r.stageNote ?? '')}
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>
          </aside>

          {activeReplica ? <ReplicaWorkspace d={d} task={activeReplica} /> : activeCut ? <CutWorkspace d={d} cut={activeCut} /> : null}
        </div>
      )}

      <GlobalAnalyzeModal d={d} open={analyzeOpen} onClose={() => setAnalyzeOpen(false)} />
      <NewCutModal d={d} open={newCutOpen} initialMode={newCutInitialMode} onClose={() => setNewCutOpen(false)} />
      <GlobalScriptDrawer d={d} open={scriptOpen} onClose={() => setScriptOpen(false)} />
    </div>
  )
}

function ProjectList(): ReactElement {
  const dramas = useLibrary((s) => s.dramas)
  const autoAnalyze = useLibrary((s) => s.autoAnalyze)
  const removeDrama = useLibrary((s) => s.removeDrama)
  const openDrama = useStore((s) => s.openDrama)
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
        <Button type="primary" icon={<IconPlus />} onClick={() => setImportOpen(true)}>
          导入短剧
        </Button>
      </div>

      {dramas.length === 0 ? (
        <div className="dw-panel" style={{ padding: '64px 20px', textAlign: 'center' }}>
          <Empty
            image={<IconInbox style={{ fontSize: 44, color: 'var(--text-muted)' }} />}
            description="还没有导入短剧。选择一个包含剧集视频的目录，AI 将全自动完成分析并产出引流成片"
          >
            <Button type="primary" size="large" icon={<IconPlus />} onClick={() => setImportOpen(true)}>
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
                        重拼：<b style={{ color: replicaReady > 0 ? '#7c3aed' : undefined }}>{replicaReady}</b> / {replicaTotal}
                      </span>
                    </>
                  )}
                </div>

                <div className="dw-project-actions">
                  <Button type="primary" style={{ flex: 1 }} onClick={() => openDrama(d.id)}>
                    进入成片室
                  </Button>
                  {st !== 'done' && (
                    <Button
                      icon={<IconBolt />}
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
                    <Button danger icon={<IconTrash />} aria-label={`移除 ${d.title}`} />
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
