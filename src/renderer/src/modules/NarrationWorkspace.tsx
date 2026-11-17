import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { IconCopy, IconFolderOpen, IconPause, IconPlay, IconReload, IconStop, IconTrash, IconVideo, IconVolume } from '../icons'
import { Button, Empty, Input, InputNumber, Popconfirm, Progress, Segmented, Space, Spin, Tag } from 'antd'
import type { Drama, NarrationCut } from '../../../shared/types'
import { withPublishTags } from '../../../shared/types'
import { fmtSec, mediaUrl, useLibrary } from '../library'
import { toast } from '../store'
import ReviewPlayer from '../ReviewPlayer'
import type { ReviewSegment, SeekRequest } from '../ReviewPlayer'

const ROLE_COLOR: Record<string, string> = {
  钩子: 'red',
  剧情: 'blue',
  升级: 'orange',
  高潮: 'gold',
  反转: 'purple',
  悬念: 'cyan',
  引导: 'green'
}

const ROLE_HEX: Record<string, string> = {
  钩子: '#dc2626',
  剧情: '#2563eb',
  升级: '#f59e0b',
  高潮: '#eab308',
  反转: '#7c3aed',
  悬念: '#06b6d4',
  引导: '#10b981'
}

const STATUS_LABEL: Record<NarrationCut['status'], string> = {
  draft: '待生成',
  generating: '写稿中',
  voicing: '配音中',
  rendering: '渲染中',
  ready: '已就绪',
  fail: '失败'
}

interface SegDraft {
  text: string
  in: number
  out: number
  role: string
}

export function NarrationWorkspace({ d, cut }: { d: Drama; cut: NarrationCut }): ReactElement {
  const updateNarration = useLibrary((s) => s.updateNarration)
  const revoiceNarration = useLibrary((s) => s.revoiceNarration)
  const renderNarration = useLibrary((s) => s.renderNarration)
  const deleteNarration = useLibrary((s) => s.deleteNarration)
  const openNarrationOutput = useLibrary((s) => s.openNarrationOutput)
  const stopTasks = useLibrary((s) => s.stopTasks)

  const [title, setTitle] = useState(cut.title)
  const [hookHeadline, setHookHeadline] = useState(cut.hookHeadline)
  const [publishCopy, setPublishCopy] = useState(cut.publishCopy)
  const [draft, setDraft] = useState<Record<string, SegDraft>>({})
  const [saving, setSaving] = useState(false)
  const [playingKey, setPlayingKey] = useState<string | null>(null)
  const [inspectorTab, setInspectorTab] = useState<'segments' | 'copy'>('segments')
  const [currentIdx, setCurrentIdx] = useState(0)
  const [seekRequest, setSeekRequest] = useState<SeekRequest | null>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const linesRef = useRef<HTMLDivElement>(null)
  const seekSeqRef = useRef(0)

  useEffect(() => {
    setTitle(cut.title)
    setHookHeadline(cut.hookHeadline)
    setPublishCopy(cut.publishCopy)
    const next: Record<string, SegDraft> = {}
    for (const s of cut.segments) next[s.id] = { text: s.text, in: s.in, out: s.out, role: s.role }
    setDraft(next)
    setPlayingKey(null)
    setCurrentIdx(0)
    setSeekRequest(null)
    audioRef.current?.pause()
  }, [cut.id, cut.revision, cut.segments.length, cut.output])

  const busy = cut.status === 'generating' || cut.status === 'voicing' || cut.status === 'rendering'
  const readySegs = cut.segments.filter((s) => s.status === 'ready' && s.audioFile).length
  const playable = cut.status === 'ready' && Boolean(cut.output)
  const ratio = cut.ratio ?? '9:16'

  const { offsets, totalDur, reviewSegments } = useMemo(() => {
    let acc = 0
    const off: number[] = []
    const rSegs: ReviewSegment[] = cut.segments.map((s) => {
      const sec = Math.max(0.5, s.durationSec || Math.max(0.5, s.out - s.in))
      off.push(acc)
      acc += sec
      return {
        key: s.id,
        label: s.role || '解说',
        color: ROLE_HEX[s.role] ?? '#3b82f6',
        seconds: sec,
        ep: `第 ${s.epN} 集`,
        sub: s.text,
        why: s.reason || s.text,
        sourceRange: `${fmtSec(s.in)}–${fmtSec(s.out)}`,
        title: `第 ${s.epN} 集 ${fmtSec(s.in)}–${fmtSec(s.out)} · [${s.role}] ${s.text}`
      }
    })
    return { offsets: off, totalDur: acc || 1, reviewSegments: rSegs }
  }, [cut.segments])

  useEffect(() => {
    const box = linesRef.current
    const row = box?.children[currentIdx] as HTMLElement | undefined
    if (!box || !row) return
    const r = row.getBoundingClientRect()
    const b = box.getBoundingClientRect()
    if (r.top < b.top) box.scrollTop += r.top - b.top - 4
    else if (r.bottom > b.bottom) box.scrollTop += r.bottom - b.bottom + 4
  }, [currentIdx, cut.id])

  const seekToSeg = (idx: number): void => {
    setCurrentIdx(idx)
    seekSeqRef.current += 1
    setSeekRequest({ time: offsets[idx] ?? 0, idx, seq: seekSeqRef.current })
  }

  const patchSeg = (id: string, p: Partial<SegDraft>): void => {
    setDraft((prev) => ({ ...prev, [id]: { ...prev[id], ...p } }))
  }

  const playAudio = (key: string, file?: string): void => {
    const audio = audioRef.current
    if (!audio || !file) return
    if (playingKey === key) {
      audio.pause()
      setPlayingKey(null)
      return
    }
    audio.src = mediaUrl(file)
    audio.currentTime = 0
    void audio.play().then(() => setPlayingKey(key)).catch(() => toast('音频播放失败', 'info'))
  }

  const saveAll = (): Promise<void> => {
    setSaving(true)
    return updateNarration(d.id, cut.id, {
      title,
      hookHeadline,
      publishCopy,
      segments: cut.segments.map((s) => ({ id: s.id, ...(draft[s.id] ?? { text: s.text, in: s.in, out: s.out, role: s.role }) }))
    })
      .then(() => toast('解说文案已保存'))
      .catch((e: unknown) => toast(e instanceof Error ? e.message : '保存失败', 'info'))
      .finally(() => setSaving(false))
  }

  const revoiceOne = (id: string): void => {
    const seg = draft[id]
    updateNarration(d.id, cut.id, { segments: [{ id, text: seg?.text, in: seg?.in, out: seg?.out, role: seg?.role }] })
      .then(() => revoiceNarration(d.id, cut.id, id))
      .then(() => toast('已加入单段重配与视频合成队列'))
      .catch((e: unknown) => toast(e instanceof Error ? e.message : '重配失败', 'info'))
  }

  const revoiceAll = (): void => {
    saveAll()
      .then(() => revoiceNarration(d.id, cut.id))
      .then(() => toast('已加入整稿重配与视频合成队列'))
      .catch((e: unknown) => toast(e instanceof Error ? e.message : '重配失败', 'info'))
  }

  const rerenderVideo = (): void => {
    saveAll()
      .then(() => renderNarration(d.id, cut.id))
      .then(() => toast('已加入解说视频渲染队列'))
      .catch((e: unknown) => toast(e instanceof Error ? e.message : '渲染发起失败', 'info'))
  }

  const copyText = (txt: string, label: string): void => {
    void navigator.clipboard.writeText(txt).then(() => toast(`已复制${label}`)).catch(() => toast('复制失败', 'info'))
  }

  const fullPublishCopy = withPublishTags(publishCopy, d.publishTags)
  const outputTarget = cut.output || cut.fullAudio

  return (
    <>
      <ReviewPlayer
        src={cut.output}
        playable={playable}
        ratio={ratio}
        resetKey={`${cut.id}-${cut.output ?? ''}-${cut.revision}`}
        segments={reviewSegments}
        duration={totalDur}
        seekRequest={seekRequest}
        onActiveIdxChange={setCurrentIdx}
        timelineTitle="解说成片时间轴"
        timelineHint={`共 ${cut.segments.length} 段 · ${cut.voice}`}
        ariaLabel="解说成片监视器"
        headerLeft={
          <Space size={6} wrap style={{ minWidth: 0 }}>
            <span className="dw-panel-title" title={cut.title}>
              {cut.title || '解说成片'}
            </span>
            <Tag color="cyan" style={{ marginInlineEnd: 0 }}>解说</Tag>
            <Tag color={cut.status === 'ready' ? 'success' : cut.status === 'fail' ? 'error' : 'processing'} style={{ marginInlineEnd: 0 }}>
              {STATUS_LABEL[cut.status]}{busy ? ` ${cut.pct ?? 0}%` : ''}
            </Tag>
          </Space>
        }
        headerRight={
          <span className="dw-sub dw-mono">
            {ratio} · {fmtSec(cut.totalAudioSec ?? 0)}
          </span>
        }
        emptyContent={
          busy ? (
            <>
              <Spin />
              <span className="dw-sub" style={{ color: '#e4e4e7' }}>
                {cut.status === 'generating' && `AI 正在撰写解说稿 ${cut.pct ?? 0}%…`}
                {cut.status === 'voicing' && `正在逐段 TTS 配音 ${cut.pct ?? 0}%…`}
                {cut.status === 'rendering' && `正在合成纯净解说视频 ${cut.pct ?? 0}%…`}
              </span>
              <Progress percent={cut.pct ?? 0} size="small" style={{ width: '78%' }} showInfo={false} />
              <Button
                size="small"
                danger
                icon={<IconStop />}
                onClick={() =>
                  stopTasks(d.id)
                    .then(() => toast('已终止当前任务', 'info'))
                    .catch(() => toast('终止失败', 'info'))
                }
              >
                终止任务
              </Button>
            </>
          ) : (
            <>
              <span className="dw-sub">{cut.error || (readySegs > 0 ? '配音已完成，尚未合成视频' : '解说视频尚未生成')}</span>
              {readySegs > 0 && (
                <Button size="small" type="primary" icon={<IconVideo />} onClick={rerenderVideo}>
                  合成解说视频
                </Button>
              )}
            </>
          )
        }
      />

      <aside className="dw-inspector" aria-label="解说分段与文案交付">
        <div className="dw-panel" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Button
            type="primary"
            style={{ flex: 1 }}
            icon={<IconFolderOpen />}
            disabled={!outputTarget}
            onClick={() => outputTarget && openNarrationOutput(outputTarget)}
          >
            打开成片目录
          </Button>
          <Button
            icon={<IconVideo />}
            disabled={busy || readySegs === 0}
            onClick={rerenderVideo}
            title="按当前画面区间与配音重新合成视频"
            aria-label="重新渲染视频"
          />
          <Popconfirm
            title="删除这条解说方案？"
            description="将同时删除已生成的配音音频、视频与字幕"
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={() => deleteNarration(d.id, cut.id)}
          >
            <Button danger icon={<IconTrash />} title="删除解说" aria-label="删除解说" />
          </Popconfirm>
        </div>

        <div className="dw-panel" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Segmented
            block
            value={inspectorTab}
            onChange={(v) => setInspectorTab(v as 'segments' | 'copy')}
            options={[
              { value: 'segments', label: `分段解说 (${cut.segments.length})` },
              { value: 'copy', label: '文案 & 配音' }
            ]}
          />

          {inspectorTab === 'segments' ? (
            cut.segments.length === 0 ? (
              <div style={{ padding: '24px 8px', textAlign: 'center' }}>
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={cut.status === 'generating' ? '正在生成解说稿…' : cut.error || '暂无解说段'} />
              </div>
            ) : (
              <div className="dw-lines" style={{ maxHeight: 'calc(100dvh - 300px)' }} ref={linesRef}>
                {cut.segments.map((s, idx) => {
                  const dr = draft[s.id] ?? { text: s.text, in: s.in, out: s.out, role: s.role }
                  const isPlaying = playingKey === s.id
                  const isSelected = currentIdx === idx
                  return (
                    <div
                      className={`dw-clip-row${isSelected ? ' is-now' : ''}`}
                      key={s.id}
                      style={{ cursor: 'pointer', alignItems: 'stretch' }}
                      onClick={() => seekToSeg(idx)}
                    >
                      <span className="dw-clip-order">{idx + 1}</span>
                      <div className="dw-clip-body" style={{ gap: 6 }}>
                        <div className="dw-clip-meta" style={{ flexWrap: 'wrap' }}>
                          <Tag color={ROLE_COLOR[dr.role] ?? 'blue'} style={{ marginInlineEnd: 0 }}>{dr.role}</Tag>
                          <span style={{ fontWeight: 500 }}>第 {s.epN} 集</span>
                          <InputNumber
                            size="small"
                            className="dw-mono"
                            style={{ width: 68 }}
                            min={0}
                            step={0.1}
                            value={dr.in}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(v) => patchSeg(s.id, { in: v ?? 0 })}
                            aria-label="画面起点秒"
                          />
                          <span className="dw-sub">–</span>
                          <InputNumber
                            size="small"
                            className="dw-mono"
                            style={{ width: 68 }}
                            min={0}
                            step={0.1}
                            value={dr.out}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(v) => patchSeg(s.id, { out: v ?? 0 })}
                            aria-label="画面终点秒"
                          />
                          {s.durationSec ? <span className="dw-sub dw-mono">{fmtSec(s.durationSec)}</span> : null}
                          {s.status === 'voicing' && <Tag color="processing" style={{ marginInlineEnd: 0 }}>配音中</Tag>}
                          {s.status === 'fail' && <Tag color="error" style={{ marginInlineEnd: 0 }} title={s.error}>失败</Tag>}
                          {s.status === 'pending' && <Tag style={{ marginInlineEnd: 0 }}>待重配</Tag>}
                        </div>
                        <Input.TextArea
                          className="dw-auto-textarea"
                          autoSize={{ minRows: 2, maxRows: 5 }}
                          value={dr.text}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => patchSeg(s.id, { text: e.target.value })}
                          aria-label={`第 ${idx + 1} 段解说词`}
                        />
                        {s.reason && <div className="dw-clip-why">{s.reason}</div>}
                        <Space size={6} onClick={(e) => e.stopPropagation()}>
                          <Button
                            size="small"
                            icon={isPlaying ? <IconPause /> : <IconPlay />}
                            disabled={!s.audioFile}
                            onClick={() => playAudio(s.id, s.audioFile)}
                          >
                            {isPlaying ? '暂停' : '听配音'}
                          </Button>
                          <Button size="small" icon={<IconReload />} loading={s.status === 'voicing'} disabled={busy} onClick={() => revoiceOne(s.id)}>
                            重配并合成
                          </Button>
                        </Space>
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          ) : (
            <>
              <div>
                <div className="dw-field-label">解说标题</div>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="解说标题" maxLength={40} />
              </div>
              <div className="dw-copy-block">
                <div className="dw-copy-head">
                  <span className="dw-field-label">开场花字</span>
                  <Button size="small" type="link" icon={<IconCopy />} onClick={() => copyText(hookHeadline, '开场花字')}>复制</Button>
                </div>
                <Input value={hookHeadline} onChange={(e) => setHookHeadline(e.target.value)} placeholder="开场 3 秒花字" maxLength={24} />
              </div>
              <div className="dw-copy-block">
                <div className="dw-copy-head">
                  <span className="dw-field-label">引流发布文案</span>
                  <Button size="small" type="link" icon={<IconCopy />} onClick={() => copyText(fullPublishCopy, '发布文案')}>复制</Button>
                </div>
                <Input.TextArea className="dw-auto-textarea" autoSize={{ minRows: 3, maxRows: 6 }} value={publishCopy} onChange={(e) => setPublishCopy(e.target.value)} placeholder="引流发布文案" />
              </div>

              <Space size={8} wrap>
                <Button type="primary" icon={<IconVolume />} loading={saving} disabled={busy} onClick={() => void saveAll()}>
                  保存文案
                </Button>
                <Button icon={<IconReload />} disabled={busy || cut.segments.length === 0} onClick={revoiceAll}>
                  整稿重配
                </Button>
                <Button icon={<IconVideo />} disabled={busy || readySegs === 0} onClick={rerenderVideo}>
                  重新合成视频
                </Button>
              </Space>

              <p className="dw-sub" style={{ margin: 0 }}>
                支持单独修改某段解说词或画面起点，点「重配并合成」或「重新合成视频」即可更新成片与字幕。
              </p>
              {cut.status === 'fail' && cut.error && <p className="dw-sub" style={{ margin: 0, color: 'var(--accent)' }}>{cut.error}</p>}
              <p className="dw-sub dw-mono" style={{ margin: 0 }}>
                {cut.voice} · {cut.rate}x · 已配音 {readySegs}/{cut.segments.length} 段{cut.tokens ? ` · ${cut.tokens} tokens` : ''}
              </p>
            </>
          )}
        </div>
        <audio ref={audioRef} onEnded={() => setPlayingKey(null)} onPause={() => setPlayingKey(null)} style={{ display: 'none' }} />
      </aside>
    </>
  )
}

export default NarrationWorkspace
