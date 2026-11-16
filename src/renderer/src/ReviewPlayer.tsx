import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactElement, ReactNode } from 'react'
import {
  IconPlay,
  IconMute,
  IconPause,
  IconLoop,
  IconVolume,
  IconPrev,
  IconNext
} from './icons'
import { Button, Tag } from 'antd'
import { fmtSec, mediaUrl } from './library'
import TimelineScrubber from './TimelineScrubber'

export interface ReviewSegment {
  key: string | number
  label: string
  color: string
  seconds: number
  ep?: string
  sub?: string
  quote?: string
  why?: string
  sourceRange?: string
  title?: string
}

export interface SeekRequest {
  time: number
  idx?: number
  seq: number
}

interface ReviewPlayerProps {
  /** 视频文件绝对路径 */
  src?: string
  /** 是否可播放 */
  playable: boolean
  /** 画幅比例 */
  ratio?: '9:16' | '16:9'
  /** 切换方案/版本时重置播放状态 */
  resetKey: string
  /** 结构分段（用于时间轴、段落跳转与单段循环） */
  segments: ReviewSegment[]
  /** 兜底总时长（秒） */
  duration?: number
  /** 顶部左侧标题/标签插槽 */
  headerLeft?: ReactNode
  /** 顶部右侧信息/视图切换插槽 */
  headerRight?: ReactNode
  /** 不可播放时的占位内容（渲染进度 / 重试按钮等） */
  emptyContent?: ReactNode
  /** 外部请求跳转到指定时间/段落 */
  seekRequest?: SeekRequest | null
  /** 当前命中段落变化回调 */
  onActiveIdxChange?: (idx: number) => void
  /** 时间轴标题 */
  timelineTitle?: string
  /** 时间轴副标题提示 */
  timelineHint?: string
  /** 读屏标签 */
  ariaLabel?: string
}

const SPEEDS = [1, 1.25, 1.5, 2, 0.75]
const DARK_TEXT_ROLES = new Set(['钩子', '铺垫', '反转', '连续', '静帧'])
const roleTagColor = (label: string): string => (DARK_TEXT_ROLES.has(label) ? '#fff' : '#0f172a')

/**
 * 审查播放器（仅做播放与审查定位）：
 * - 暗场监视器 + 角色光晕 + 悬浮节拍角标
 * - 三段式精密播控条（时间码 / 段落跳转与单段循环 / 倍速、音量滑块）
 * - 集成磁吸刻度时间轴与当前段落详情
 */
export default function ReviewPlayer({
  src,
  playable,
  ratio = '9:16',
  resetKey,
  segments,
  duration = 0,
  headerLeft,
  headerRight,
  emptyContent,
  seekRequest,
  onActiveIdxChange,
  timelineTitle = '成片结构时间轴',
  timelineHint,
  ariaLabel = '成片监视器'
}: ReviewPlayerProps): ReactElement {
  const videoRef = useRef<HTMLVideoElement>(null)
  const loopIdxRef = useRef(0)

  const [playing, setPlaying] = useState(false)
  const [t, setT] = useState(0)
  const [dur, setDur] = useState(0)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [loopSeg, setLoopSeg] = useState(false)
  const [videoErr, setVideoErr] = useState(false)
  const [inspectedIdx, setInspectedIdx] = useState(0)

  useEffect(() => {
    setPlaying(false)
    setT(0)
    setDur(0)
    setVideoErr(false)
    setInspectedIdx(0)
    loopIdxRef.current = 0
  }, [resetKey])

  const canPlay = playable && Boolean(src) && !videoErr

  const bounds = useMemo(() => {
    let acc = 0
    return segments.map((seg, idx) => {
      const segDur = Math.max(0.5, seg.seconds)
      const startAt = acc
      acc += segDur
      return { seg, idx, segDur, startAt, endAt: acc }
    })
  }, [segments])

  const totalSegDur = bounds.length > 0 ? bounds[bounds.length - 1].endAt : dur || duration || 1

  const playingSeg = useMemo(() => {
    if (!canPlay) return undefined
    return bounds.find(
      (b) => t >= b.startAt && (t < b.endAt - 0.02 || (b.idx === bounds.length - 1 && t >= b.startAt))
    )
  }, [canPlay, bounds, t])

  const currentSeg =
    playingSeg ?? bounds[Math.min(inspectedIdx, Math.max(0, bounds.length - 1))] ?? bounds[0]
  const currentIdx = currentSeg?.idx ?? 0

  useEffect(() => {
    onActiveIdxChange?.(currentIdx)
  }, [currentIdx, onActiveIdxChange])

  // 当未开启循环时保持 loopIdxRef 跟随当前段，开启时锁定目标段
  useEffect(() => {
    if (!loopSeg) {
      loopIdxRef.current = currentIdx
    }
  }, [loopSeg, currentIdx])

  const toggleLoopSeg = useCallback((): void => {
    setLoopSeg((prev) => {
      const next = !prev
      if (next) {
        loopIdxRef.current = currentIdx
      }
      return next
    })
  }, [currentIdx])

  const togglePlay = useCallback((): void => {
    const v = videoRef.current
    if (!v || !canPlay) return
    if (v.paused) void v.play().catch(() => setVideoErr(true))
    else v.pause()
  }, [canPlay])

  const seekTo = useCallback(
    (time: number, idx?: number): void => {
      let targetIdx = idx
      if (typeof targetIdx !== 'number' || targetIdx < 0 || targetIdx >= bounds.length) {
        targetIdx = bounds.findIndex(
          (b) => time >= b.startAt && (time < b.endAt || b.idx === bounds.length - 1)
        )
      }
      if (targetIdx >= 0 && targetIdx < bounds.length) {
        setInspectedIdx(targetIdx)
        loopIdxRef.current = targetIdx
      }
      const v = videoRef.current
      if (v && canPlay) v.currentTime = time
      setT(time)
    },
    [bounds, canPlay]
  )

  useEffect(() => {
    if (!seekRequest) return
    seekTo(seekRequest.time, seekRequest.idx)
  }, [seekRequest, seekTo])

  const jumpSeg = useCallback(
    (delta: number): void => {
      if (bounds.length === 0) return
      const next = Math.min(bounds.length - 1, Math.max(0, currentIdx + delta))
      seekTo(bounds[next].startAt, next)
    },
    [bounds, currentIdx, seekTo]
  )

  // 使用 requestAnimationFrame 精确监控单段循环边界，避免 timeupdate 间隔（~250ms）越过段尾进入下一段
  useEffect(() => {
    if (!loopSeg || !playing || !canPlay || bounds.length === 0) return
    let rafId = 0
    const tick = (): void => {
      const v = videoRef.current
      const seg = bounds[Math.min(loopIdxRef.current, bounds.length - 1)]
      if (v && seg) {
        const endLimit = Math.min(seg.endAt - 0.04, dur > 0 ? dur - 0.04 : seg.endAt - 0.04)
        if (v.currentTime >= endLimit) {
          v.currentTime = seg.startAt
          setT(seg.startAt)
        }
      }
      rafId = window.requestAnimationFrame(tick)
    }
    rafId = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(rafId)
  }, [loopSeg, playing, canPlay, bounds, dur])

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = speed
  }, [speed, resetKey])

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = volume
      videoRef.current.muted = muted
    }
  }, [volume, muted, resetKey])

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
    } else if (e.key === 'ArrowLeft' && canPlay && !target.closest('.dw-tl2')) {
      e.preventDefault()
      seekTo(Math.max(0, t - (e.shiftKey ? 5 : 1)))
    } else if (e.key === 'ArrowRight' && canPlay && !target.closest('.dw-tl2')) {
      e.preventDefault()
      seekTo(Math.min(totalSegDur, t + (e.shiftKey ? 5 : 1)))
    } else if (e.key === 'l' || e.key === 'L') {
      toggleLoopSeg()
    } else if (e.key === 'm' || e.key === 'M') {
      setMuted((v) => !v)
    }
  }

  useEffect(() => {
    const h = (e: KeyboardEvent): void => keyHandlerRef.current(e)
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  const tlSegments = useMemo(
    () =>
      segments.map((s) => ({
        key: s.key,
        label: s.label,
        color: s.color,
        seconds: Math.max(0.5, s.seconds),
        ep: s.ep,
        sub: s.sub,
        title: s.title
      })),
    [segments]
  )

  const activeColor = currentSeg?.seg.color ?? '#3b82f6'

  return (
    <section className="dw-stage" aria-label={ariaLabel}>
      {(headerLeft || headerRight) && (
        <div className="dw-panel-head" style={{ marginBottom: 0 }}>
          <div style={{ minWidth: 0, flex: 1 }}>{headerLeft}</div>
          {headerRight && <div style={{ flex: 'none' }}>{headerRight}</div>}
        </div>
      )}

      <div
        className={ratio === '9:16' ? 'dw-player' : 'dw-player dw-player-wide'}
        style={{ '--player-glow': `${activeColor}2e` } as CSSProperties}
      >
        {canPlay ? (
          <>
            <video
              key={resetKey}
              ref={videoRef}
              src={mediaUrl(src!)}
              width={ratio === '9:16' ? 296 : 520}
              height={ratio === '9:16' ? 526 : 292}
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
                e.currentTarget.volume = volume
              }}
              onTimeUpdate={(e) => {
                const v = e.currentTarget
                let ct = v.currentTime
                if (loopSeg && bounds.length > 0) {
                  const seg = bounds[Math.min(loopIdxRef.current, bounds.length - 1)]
                  if (seg && ct >= seg.endAt - 0.04) {
                    v.currentTime = seg.startAt
                    ct = seg.startAt
                  }
                }
                setT(ct)
              }}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => {
                if (loopSeg && bounds.length > 0 && videoRef.current) {
                  const seg = bounds[Math.min(loopIdxRef.current, bounds.length - 1)]
                  if (seg) {
                    videoRef.current.currentTime = seg.startAt
                    setT(seg.startAt)
                    void videoRef.current.play().catch(() => setVideoErr(true))
                    return
                  }
                }
                setPlaying(false)
              }}
              onError={() => setVideoErr(true)}
            />

            <button
              type="button"
              className={`dw-play-overlay${playing ? ' is-playing' : ''}`}
              onClick={togglePlay}
              aria-label={playing ? '暂停' : '播放'}
            >
              {playing ? <IconPause /> : <IconPlay />}
            </button>

            {bounds.length > 0 && (
              <div className="dw-beat-badge">
                <span className="dw-tl-dot" style={{ background: activeColor }} />
                #{currentIdx + 1} {currentSeg?.seg.label}
                {currentSeg?.seg.ep ? ` · ${currentSeg.seg.ep}` : ''}
              </div>
            )}
          </>
        ) : (
          <div className="dw-player-empty">{emptyContent}</div>
        )}
      </div>

      {/* 三段式精密播控条 */}
      <div className="dw-transport" role="group" aria-label="播放控制">
        <span className="dw-timecode">
          <span className="dw-time-cur">{fmtSec(t)}</span>
          <span className="dw-time-tot"> / {fmtSec(dur || totalSegDur)}</span>
        </span>

        <div className="dw-ctrl-group">
          <Button
            size="small"
            type="text"
            icon={<IconPrev />}
            disabled={!canPlay || bounds.length <= 1}
            onClick={() => jumpSeg(-1)}
            aria-label="上一段"
            title="上一段 ([)"
          />
          <button
            type="button"
            className="dw-btn-play-main"
            onClick={togglePlay}
            disabled={!canPlay}
            aria-label={playing ? '暂停' : '播放'}
            title="播放 / 暂停 (Space)"
          >
            {playing ? <IconPause /> : <IconPlay />}
          </button>
          <Button
            size="small"
            type="text"
            icon={<IconNext />}
            disabled={!canPlay || bounds.length <= 1}
            onClick={() => jumpSeg(1)}
            aria-label="下一段"
            title="下一段 (])"
          />
          <Button
            size="small"
            type="text"
            className={loopSeg ? 'dw-ctrl-on' : undefined}
            icon={<IconLoop />}
            disabled={!canPlay || bounds.length === 0}
            onClick={toggleLoopSeg}
            aria-label="循环当前段"
            aria-pressed={loopSeg}
            title="单段循环 (L)"
          />
        </div>

        <div className="dw-ctrl-group">
          <button
            type="button"
            className={`dw-speed-chip dw-mono${speed !== 1 ? ' is-active' : ''}`}
            onClick={() => setSpeed((s) => SPEEDS[(SPEEDS.indexOf(s) + 1) % SPEEDS.length])}
            title="点击切换播放倍速"
          >
            {speed}x
          </button>

          <div className="dw-vol-wrap">
            <Button
              size="small"
              type="text"
              icon={muted || volume === 0 ? <IconMute /> : <IconVolume />}
              onClick={() => setMuted((v) => !v)}
              aria-label={muted ? '取消静音' : '静音'}
              aria-pressed={muted}
              title="静音 (M)"
            />
            <input
              type="range"
              className="dw-vol-slider"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              onChange={(e) => {
                const v = Number(e.target.value)
                setVolume(v)
                if (v > 0 && muted) setMuted(false)
              }}
              aria-label="音量"
            />
          </div>
        </div>
      </div>

      {/* 结构时间轴 + 当前片段详情 */}
      <div className="dw-tl-box">
        <TimelineScrubber
          ariaLabel={`${timelineTitle}，拖动定位播放进度`}
          summary={bounds.length > 0 ? `#${currentIdx + 1}/${bounds.length}${timelineHint ? ` · ${timelineHint}` : ''}` : timelineHint}
          duration={totalSegDur}
          value={Math.min(t, totalSegDur)}
          segments={tlSegments}
          onChange={(val) => seekTo(val)}
        />

        {currentSeg && (currentSeg.seg.why || currentSeg.seg.sourceRange || currentSeg.seg.quote) && (
          <div className="dw-tl-active-card">
            <div className="dw-tl-active-top">
              <Tag
                style={{
                  marginInlineEnd: 0,
                  borderColor: 'transparent',
                  background: currentSeg.seg.color,
                  color: roleTagColor(currentSeg.seg.label)
                }}
              >
                #{currentIdx + 1} {currentSeg.seg.label}
              </Tag>
              {currentSeg.seg.ep && <span style={{ fontWeight: 600 }}>{currentSeg.seg.ep}</span>}
              {currentSeg.seg.sourceRange && (
                <span className="dw-sub dw-mono">
                  {currentSeg.seg.sourceRange}（{fmtSec(currentSeg.segDur)}）
                </span>
              )}
            </div>
            {(currentSeg.seg.why || currentSeg.seg.quote) && (
              <div className="dw-tl-active-why">
                {currentSeg.seg.why || '叙事关键推进片段'}
                {currentSeg.seg.quote ? ` · 「${currentSeg.seg.quote}」` : ''}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
