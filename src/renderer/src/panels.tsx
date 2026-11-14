import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import {
  CaretRightOutlined,
  CheckOutlined,
  CopyOutlined,
  MutedOutlined,
  PauseOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  SoundOutlined,
  UnorderedListOutlined
} from '@ant-design/icons'
import { Alert, Button, Drawer, Empty, Form, Input, Slider, Space, Spin, Table, Tag } from 'antd'
import type { ScanResult } from '../../shared/types'
import { fmtSize, findDrama, mediaUrl, useHighlights, useLibrary } from './library'
import { TAGSET, fmt } from './mock/data'
import { toast, useStore } from './store'
import DirField from './DirField'

function ImportDrawer({ open, onClose }: { open: boolean; onClose: () => void }): ReactElement {
  const scan = useLibrary((s) => s.scan)
  const importDrama = useLibrary((s) => s.importDrama)
  const goto = useStore((s) => s.goto)
  const [dir, setDir] = useState('')
  const [title, setTitle] = useState('')
  const [result, setResult] = useState<ScanResult | null>(null)
  const [scanning, setScanning] = useState(false)
  const [importing, setImporting] = useState(false)

  const changeDir = (next: string): void => {
    setDir(next)
    setResult(null)
  }

  const doScan = (): void => {
    if (!dir.trim()) {
      toast('请先选择素材目录', 'info')
      return
    }
    setScanning(true)
    scan(dir.trim())
      .then((r) => {
        setResult(r)
        setTitle((t) => t || r.title)
        if (r.matched === 0) toast('没有识别到带集数的视频文件（文件名需形如「第3集.mp4」）', 'info')
      })
      .catch((e: unknown) => toast(e instanceof Error ? e.message : '扫描失败', 'info'))
      .finally(() => setScanning(false))
  }

  const doImport = (): void => {
    if (!result) return
    setImporting(true)
    importDrama(result.dir, title.trim() || result.title)
      .then((r) => {
        onClose()
        setResult(null)
        toast(`已导入《${title.trim() || result.title}》${r.count} 集，正在读取时长并生成缩略图`)
        goto('episodes', { page: 'eps', drama: r.dramaId, review: null, q: '', filter: 'all', sel: [] })
      })
      .catch((e: unknown) => toast(e instanceof Error ? e.message : '导入失败', 'info'))
      .finally(() => setImporting(false))
  }

  const unmatched = result?.files.filter((f) => f.n === null) ?? []

  return (
    <Drawer title="导入短剧" placement="right" width={600} open={open} onClose={onClose}>
      <Form layout="vertical">
        <Form.Item label="素材目录（仅登记索引，原文件不搬家）">
          <DirField value={dir} onChange={changeDir} />
        </Form.Item>
        <Form.Item label="短剧名称">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="扫描后默认使用目录名，可修改"
            allowClear
          />
        </Form.Item>
      </Form>
      {result && (
        <>
          <Alert
            type={result.matched > 0 ? 'success' : 'warning'}
            showIcon
            style={{ marginBottom: 12 }}
            message={`扫描完成：识别 ${result.matched} 个剧集文件 · 共 ${fmtSize(result.totalSize)}${
              result.unmatched > 0 ? ` · ${result.unmatched} 个文件无法识别集数，将跳过` : ''
            }`}
          />
          {unmatched.length > 0 && (
            <p className="dw-sub" style={{ marginTop: 0 }}>
              跳过：{unmatched.map((f) => f.fileName).join('、')}
            </p>
          )}
          {result.matched > 0 && (
            <Table
              size="small"
              rowKey="file"
              style={{ marginBottom: 12 }}
              pagination={false}
              scroll={{ y: 260 }}
              dataSource={result.files.filter((f) => f.n !== null)}
              columns={[
                { title: '集数', dataIndex: 'n', width: 80, render: (n: number) => `第 ${n} 集` },
                { title: '文件名', dataIndex: 'fileName' },
                { title: '大小', dataIndex: 'size', width: 100, render: (v: number) => fmtSize(v) }
              ]}
            />
          )}
        </>
      )}
      <Space>
        <Button icon={<SearchOutlined />} loading={scanning} onClick={doScan}>
          扫描目录
        </Button>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          loading={importing}
          disabled={!result || result.matched === 0}
          onClick={doImport}
        >
          开始导入
        </Button>
      </Space>
    </Drawer>
  )
}

function TranscriptDrawer({ open, onClose }: { open: boolean; onClose: () => void }): ReactElement {
  const target = useStore((s) => s.transcriptEp)
  const dramas = useLibrary((s) => s.dramas)
  const seekReview = useStore((s) => s.seekReview)
  const goto = useStore((s) => s.goto)
  const d = target ? findDrama(dramas, target.dramaId) : undefined
  const ep = target && d ? d.episodes.find((e) => e.n === target.n) : undefined
  const segments = ep?.segments ?? []

  const copyAll = (): void => {
    const text = segments.map((s) => `${fmt(s.start)} ${s.text}`).join('\n')
    void navigator.clipboard
      .writeText(text)
      .then(() => toast('已复制全部转写文本'))
      .catch(() => toast('复制失败，请手动选择文本', 'info'))
  }

  const jump = (t: number): void => {
    if (!target) return
    onClose()
    goto('episodes', { page: 'eps', drama: target.dramaId })
    seekReview(target.n, t)
  }

  return (
    <Drawer
      title={d && ep ? `转写文本 · 《${d.title}》第 ${ep.n} 集` : '转写文本'}
      placement="right"
      width={560}
      open={open}
      onClose={onClose}
      extra={
        <Button size="small" icon={<CopyOutlined />} disabled={segments.length === 0} onClick={copyAll}>
          复制全部
        </Button>
      }
    >
      {segments.length === 0 ? (
        <Empty description="暂无转写文本" />
      ) : (
        <>
          <p className="dw-sub" style={{ marginTop: 0 }}>
            句级时间戳 · 点击任意句子跳到审核台对应位置
          </p>
          <div className="dw-lines">
            {segments.map((s) => (
              <button
                type="button"
                key={`${s.start}-${s.text}`}
                className="dw-line"
                style={{ cursor: 'pointer', textAlign: 'left', background: 'none', border: 0, font: 'inherit' }}
                onClick={() => jump(s.start)}
              >
                <b>{fmt(s.start)}</b>
                {s.text}
              </button>
            ))}
          </div>
        </>
      )}
    </Drawer>
  )
}

function PreviewDrawer({ open, onClose }: { open: boolean; onClose: () => void }): ReactElement | null {
  const previewId = useStore((s) => s.previewId)
  const hls = useHighlights()
  const dramas = useLibrary((s) => s.dramas)
  const basket = useStore((s) => s.basket)
  const addToBasket = useStore((s) => s.addToBasket)
  const hlSource = useStore((s) => s.hlSource)
  const updateCandidate = useLibrary((s) => s.updateCandidate)
  const resliceHighlight = useLibrary((s) => s.resliceHighlight)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const [t, setT] = useState(0)
  const [dur, setDur] = useState(0)
  const [videoErr, setVideoErr] = useState(false)
  const [muted, setMuted] = useState(false)
  const [reslicing, setReslicing] = useState(false)

  useEffect(() => {
    setPlaying(false)
    setT(0)
    setDur(0)
    setVideoErr(false)
  }, [previewId])

  useEffect(() => {
    if (!open) {
      videoRef.current?.pause()
      setPlaying(false)
    }
  }, [open])

  const h = hls.find((x) => x.id === previewId)
  if (!h) return null
  const d = findDrama(dramas, h.dramaId)
  const inBasket = basket.includes(h.id)
  const playable = Boolean(h.clip) && !videoErr

  const togglePlay = (): void => {
    const v = videoRef.current
    if (!v) return
    if (playing) v.pause()
    else void v.play().catch(() => setVideoErr(true))
  }

  const toggleTag = (tag: string): void => {
    const tags = h.tags.includes(tag) ? h.tags.filter((x) => x !== tag) : [...h.tags, tag]
    updateCandidate(h.dramaId, h.episodeId, h.id, { tags }).catch((e: unknown) =>
      toast(e instanceof Error ? e.message : '标签保存失败', 'info')
    )
  }

  const reslice = (): void => {
    setReslicing(true)
    resliceHighlight(h.dramaId, h.episodeId, h.id)
      .then(() => toast('已加入切片队列，完成后即可预览', 'info'))
      .catch((e: unknown) => toast(e instanceof Error ? e.message : '重新切片失败', 'info'))
      .finally(() => setReslicing(false))
  }

  return (
    <Drawer title="高光预览" placement="right" width={760} open={open} onClose={onClose}>
      <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 20, alignItems: 'start' }}>
        <div>
          <div className="dw-player" style={{ maxWidth: 260 }}>
            {playable ? (
              <>
                <video
                  key={h.clip}
                  ref={videoRef}
                  src={mediaUrl(h.clip!)}
                  width={260}
                  height={462}
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
                <span className="dw-ptime">{fmt(t)}</span>
                <button type="button" className="dw-play-overlay" onClick={togglePlay} aria-label="播放 / 暂停">
                  {playing ? <PauseOutlined /> : <CaretRightOutlined />}
                </button>
              </>
            ) : (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 10,
                  padding: 16,
                  textAlign: 'center'
                }}
              >
                {videoErr ? (
                  <span>切片播放失败，可尝试重新切片</span>
                ) : (
                  <>
                    <Spin />
                    <span className="dw-sub">切片生成中，可在任务队列查看进度</span>
                  </>
                )}
              </div>
            )}
          </div>
          {playable ? (
            <>
              <Slider
                min={0}
                max={dur || h.dur}
                step={0.1}
                value={Math.min(t, dur || h.dur)}
                onChange={(v: number) => {
                  const v2 = videoRef.current
                  if (v2) v2.currentTime = v
                  setT(v)
                }}
                tooltip={{ formatter: (v) => fmt(v ?? 0) }}
                style={{ marginTop: 8 }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="dw-sub" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {fmt(t)} / {fmt(dur || h.dur)}
                </span>
                <span className="dw-spacer" />
                <Button
                  size="small"
                  type="text"
                  icon={muted ? <MutedOutlined /> : <SoundOutlined />}
                  onClick={() => setMuted(!muted)}
                  aria-label="静音切换"
                />
              </div>
            </>
          ) : (
            <Button
              block
              icon={<ReloadOutlined />}
              loading={reslicing}
              style={{ marginTop: 8 }}
              onClick={reslice}
            >
              重新切片
            </Button>
          )}
        </div>
        <div>
          <p style={{ fontWeight: 500, marginTop: 0 }}>{h.title}</p>
          <p className="dw-sub">
            《{d?.title ?? '?'}》第 {h.ep} 集 · 评分 {h.score} · 时长 {h.dur.toFixed(1)}s
          </p>
          <p className="dw-sub">
            原片区间 {fmt(h.in)}–{fmt(h.out)}
          </p>
          <div className="dw-field-label">标签（点击修改）</div>
          <Space size={4} wrap style={{ marginBottom: 12 }}>
            {TAGSET.map((tag) => (
              <Tag.CheckableTag key={tag} checked={h.tags.includes(tag)} onChange={() => toggleTag(tag)}>
                {tag}
              </Tag.CheckableTag>
            ))}
          </Space>
          {h.reason && (
            <>
              <div className="dw-field-label">AI 理由</div>
              <p className="dw-sub">{h.reason}</p>
            </>
          )}
          <p className="dw-sub">切片文件：{h.clip ?? '生成中'}（帧精确重编码）</p>
          <Space>
            <Button type="primary" icon={inBasket ? <CheckOutlined /> : <PlusOutlined />} disabled={inBasket} onClick={() => addToBasket(h.id)}>
              {inBasket ? '已在素材篮' : '加入混剪'}
            </Button>
            <Button icon={<UnorderedListOutlined />} onClick={() => hlSource(h.id)}>
              定位来源剧集
            </Button>
          </Space>
        </div>
      </div>
    </Drawer>
  )
}

export default function Panels(): ReactElement {
  const panel = useStore((s) => s.panel)
  const closePanel = useStore((s) => s.closePanel)
  return (
    <>
      <ImportDrawer open={panel === 'import'} onClose={closePanel} />
      <PreviewDrawer open={panel === 'preview'} onClose={closePanel} />
      <TranscriptDrawer open={panel === 'transcript'} onClose={closePanel} />
    </>
  )
}