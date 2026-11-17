import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { IconCopy, IconFolderOpen, IconPause, IconPlay, IconReload, IconTrash, IconVolume } from '../icons'
import { Button, Empty, Input, InputNumber, Popconfirm, Progress, Space, Spin, Tag } from 'antd'
import type { Drama, NarrationCut } from '../../../shared/types'
import { fmtSec, mediaUrl, useLibrary } from '../library'
import { toast } from '../store'

const ROLE_COLOR: Record<string, string> = {
  钩子: 'red',
  剧情: 'blue',
  升级: 'orange',
  高潮: 'gold',
  反转: 'purple',
  悬念: 'cyan',
  引导: 'green'
}

const STATUS_LABEL: Record<NarrationCut['status'], string> = {
  draft: '待生成',
  generating: '写稿中',
  voicing: '配音中',
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
  const deleteNarration = useLibrary((s) => s.deleteNarration)
  const openNarrationOutput = useLibrary((s) => s.openNarrationOutput)
  const stopTasks = useLibrary((s) => s.stopTasks)

  const [title, setTitle] = useState(cut.title)
  const [hookHeadline, setHookHeadline] = useState(cut.hookHeadline)
  const [publishCopy, setPublishCopy] = useState(cut.publishCopy)
  const [draft, setDraft] = useState<Record<string, SegDraft>>({})
  const [saving, setSaving] = useState(false)
  const [playingKey, setPlayingKey] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement>(null)

  useEffect(() => {
    setTitle(cut.title)
    setHookHeadline(cut.hookHeadline)
    setPublishCopy(cut.publishCopy)
    const next: Record<string, SegDraft> = {}
    for (const s of cut.segments) next[s.id] = { text: s.text, in: s.in, out: s.out, role: s.role }
    setDraft(next)
    setPlayingKey(null)
    audioRef.current?.pause()
  }, [cut.id, cut.revision, cut.segments.length])

  const busy = cut.status === 'generating' || cut.status === 'voicing'
  const readySegs = cut.segments.filter((s) => s.status === 'ready' && s.audioFile).length

  const patchSeg = (id: string, p: Partial<SegDraft>): void => {
    setDraft((prev) => ({ ...prev, [id]: { ...prev[id], ...p } }))
  }

  const play = (key: string, file?: string): void => {
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
      .then(() => toast('已加入重配队列'))
      .catch((e: unknown) => toast(e instanceof Error ? e.message : '重配失败', 'info'))
  }

  const revoiceAll = (): void => {
    saveAll()
      .then(() => revoiceNarration(d.id, cut.id))
      .then(() => toast('已加入整稿重配队列'))
      .catch((e: unknown) => toast(e instanceof Error ? e.message : '重配失败', 'info'))
  }

  const copyText = (txt: string, label: string): void => {
    void navigator.clipboard.writeText(txt).then(() => toast(`已复制${label}`)).catch(() => toast('复制失败', 'info'))
  }

  return (
    <>
      <div className="dw-panel" style={{ display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
        <div className="dw-panel-head">
          <span className="dw-panel-title" title={cut.title}>{cut.title || '解说文案'}</span>
          <Space size={6} style={{ flex: 'none' }}>
            <Tag color={cut.status === 'ready' ? 'success' : cut.status === 'fail' ? 'error' : 'processing'} style={{ marginInlineEnd: 0 }}>
              {STATUS_LABEL[cut.status]}{busy ? ` ${cut.pct ?? 0}%` : ''}
            </Tag>
            <span className="dw-sub dw-mono">{cut.segments.length} 段 · {fmtSec(cut.totalAudioSec ?? 0)}</span>
          </Space>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', flexWrap: 'wrap' }}>
          <Button
            size="small"
            type="primary"
            icon={playingKey === 'full' ? <IconPause /> : <IconPlay />}
            disabled={!cut.fullAudio}
            onClick={() => play('full', cut.fullAudio)}
          >
            {playingKey === 'full' ? '暂停' : '整段试听'}
          </Button>
          <span className="dw-sub">龙书音色 · {cut.voice} · {cut.rate}x · 目标 {fmtSec(cut.targetSec)}</span>
          <span className="dw-spacer" />
          {busy && (
            <Button size="small" danger onClick={() => stopTasks(d.id).then(() => toast('已终止任务', 'info')).catch(() => toast('终止失败', 'info'))}>
              终止
            </Button>
          )}
        </div>

        {busy && <Progress percent={cut.pct ?? 0} size="small" showInfo={false} style={{ marginBottom: 8 }} />}

        {cut.segments.length === 0 ? (
          <div style={{ padding: '40px 16px', textAlign: 'center' }}>
            {cut.status === 'generating' ? (
              <Space direction="vertical"><Spin /><span className="dw-sub">AI 正在撰写解说稿…</span></Space>
            ) : (
              <Empty description={cut.error || '暂无解说稿'} />
            )}
          </div>
        ) : (
          <div className="dw-lines" style={{ flex: 1, overflowY: 'auto', maxHeight: 'calc(100dvh - 320px)' }}>
            {cut.segments.map((s, idx) => {
              const dr = draft[s.id] ?? { text: s.text, in: s.in, out: s.out, role: s.role }
              const isPlaying = playingKey === s.id
              return (
                <div className="dw-clip-row" key={s.id} style={{ cursor: 'default', alignItems: 'stretch' }}>
                  <span className="dw-clip-order">{idx + 1}</span>
                  <div className="dw-clip-body" style={{ gap: 6 }}>
                    <div className="dw-clip-meta" style={{ flexWrap: 'wrap' }}>
                      <Tag color={ROLE_COLOR[dr.role] ?? 'blue'} style={{ marginInlineEnd: 0 }}>{dr.role}</Tag>
                      <span style={{ fontWeight: 500 }}>第 {s.epN} 集</span>
                      <InputNumber
                        size="small"
                        className="dw-mono"
                        style={{ width: 76 }}
                        min={0}
                        step={0.1}
                        value={dr.in}
                        onChange={(v) => patchSeg(s.id, { in: v ?? 0 })}
                        aria-label="画面起点秒"
                      />
                      <span className="dw-sub">–</span>
                      <InputNumber
                        size="small"
                        className="dw-mono"
                        style={{ width: 76 }}
                        min={0}
                        step={0.1}
                        value={dr.out}
                        onChange={(v) => patchSeg(s.id, { out: v ?? 0 })}
                        aria-label="画面终点秒"
                      />
                      {s.durationSec ? <span className="dw-sub dw-mono">配音 {fmtSec(s.durationSec)}</span> : null}
                      {s.status === 'voicing' && <Tag color="processing" style={{ marginInlineEnd: 0 }}>配音中</Tag>}
                      {s.status === 'fail' && <Tag color="error" style={{ marginInlineEnd: 0 }} title={s.error}>失败</Tag>}
                      {s.status === 'pending' && <Tag style={{ marginInlineEnd: 0 }}>待重配</Tag>}
                    </div>
                    <Input.TextArea
                      className="dw-auto-textarea"
                      autoSize={{ minRows: 2, maxRows: 5 }}
                      value={dr.text}
                      onChange={(e) => patchSeg(s.id, { text: e.target.value })}
                      aria-label={`第 ${idx + 1} 段解说词`}
                    />
                    {s.reason && <div className="dw-clip-why">{s.reason}</div>}
                    <Space size={6}>
                      <Button
                        size="small"
                        icon={isPlaying ? <IconPause /> : <IconPlay />}
                        disabled={!s.audioFile}
                        onClick={() => play(s.id, s.audioFile)}
                      >
                        {isPlaying ? '暂停' : '试听'}
                      </Button>
                      <Button size="small" icon={<IconReload />} loading={s.status === 'voicing'} disabled={busy} onClick={() => revoiceOne(s.id)}>
                        重配
                      </Button>
                    </Space>
                  </div>
                </div>
              )
            })}
          </div>
        )}
        <audio ref={audioRef} onEnded={() => setPlayingKey(null)} onPause={() => setPlayingKey(null)} style={{ display: 'none' }} />
      </div>

      <aside className="dw-inspector" aria-label="解说文案与交付">
        <div className="dw-panel" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Button
            style={{ flex: 1 }}
            icon={<IconFolderOpen />}
            disabled={!cut.fullAudio}
            onClick={() => cut.fullAudio && openNarrationOutput(cut.fullAudio)}
          >
            打开音频目录
          </Button>
          <Popconfirm
            title="删除这条解说方案？"
            description="将同时删除已生成的配音音频"
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={() => deleteNarration(d.id, cut.id)}
          >
            <Button danger icon={<IconTrash />} title="删除解说" aria-label="删除解说" />
          </Popconfirm>
        </div>

        <div className="dw-panel" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <div className="dw-field-label">解说标题</div>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="解说标题" maxLength={40} />
          </div>
          <div>
            <div className="dw-field-label">开场花字</div>
            <Input value={hookHeadline} onChange={(e) => setHookHeadline(e.target.value)} placeholder="开场 3 秒花字" maxLength={24} />
          </div>
          <div className="dw-copy-block">
            <div className="dw-copy-head">
              <span className="dw-field-label">引流发布文案</span>
              <Button size="small" type="link" icon={<IconCopy />} onClick={() => copyText(publishCopy, '发布文案')}>复制</Button>
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
          </Space>
          <p className="dw-sub" style={{ margin: 0 }}>
            改文案后点「保存文案」，再对改动段点「重配」即可只重配该段；「整稿重配」重新配音全部段。视频合成将在 P2 提供。
          </p>
          {cut.status === 'fail' && cut.error && <p className="dw-sub" style={{ margin: 0, color: 'var(--accent)' }}>{cut.error}</p>}
          <p className="dw-sub dw-mono" style={{ margin: 0 }}>已配音 {readySegs}/{cut.segments.length} 段{cut.tokens ? ` · 文案 ${cut.tokens} tokens` : ''}</p>
        </div>
      </aside>
    </>
  )
}

export default NarrationWorkspace