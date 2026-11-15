import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent, ReactElement } from 'react'
import { fmtSec } from './library'

const MagnetIcon = (): ReactElement => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
    <path d="M6 15V6a6 6 0 0 1 12 0v9" />
    <path d="M6 19v-2h4v2a2 2 0 0 1-4 0z" />
    <path d="M14 19v-2h4v2a2 2 0 0 1-4 0z" />
  </svg>
)

export interface TimelineSegment {
  key: string | number
  /** 色块常显短标签，如「钩子」「冲突」 */
  label: string
  /** 色块颜色（角色色 / 类型色） */
  color: string
  /** 段时长（秒），决定色块宽度 */
  seconds: number
  /** 悬停/读屏用的完整说明 */
  title?: string
  /** 块标题右侧集数，如「第 8 集」，宽度足够时显示 */
  ep?: string
  /** 块内台词/描述，宽度不足时回退为时长 */
  sub?: string
}

interface TimelineScrubberProps {
  segments: TimelineSegment[]
  /** 时间轴总时长（秒）；传 0 时自动按 segments 求和 */
  duration: number
  /** 当前播放位置（秒） */
  value: number
  onChange: (value: number) => void
  /** 读屏名称，如「成片结构时间轴」 */
  ariaLabel: string
  className?: string
}

interface Anchor {
  time: number
  idx: number
  label: string
}

const PAD_LEFT = 16
const PAD_RIGHT = 24
const SNAP_RADIUS_PX = 8

function rgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

/**
 * 磁吸结构时间轴：半透明角色色块 + 播放头帽 + 段边界磁吸（激光线/闪烁/tooltip）+ 缩放横向滚动。
 * 段数少（≤10），自绘轨道即可，pointer capture 实现拖拽 scrub。
 */
export default function TimelineScrubber({
  segments,
  duration,
  value,
  onChange,
  ariaLabel,
  className
}: TimelineScrubberProps): ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef({ active: false, startX: 0, moved: false, clickedIdx: -1 })
  const flashTimer = useRef(0)
  const [width, setWidth] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [snapOn, setSnapOn] = useState(true)
  const [tip, setTip] = useState({ x: 0, text: '', snapped: false, visible: false })
  const [laserX, setLaserX] = useState<number | null>(null)
  const [flashIdx, setFlashIdx] = useState(-1)
  const [headSnapped, setHeadSnapped] = useState(false)

  const total = useMemo(() => {
    if (Number.isFinite(duration) && duration > 0) return duration
    return segments.reduce((sum, s) => sum + Math.max(0, s.seconds), 0)
  }, [duration, segments])

  const safeValue = Math.min(Math.max(Number.isFinite(value) ? value : 0, 0), total || 0)

  const bounds = useMemo(() => {
    let acc = 0
    return segments.map((s) => {
      const start = acc
      acc += Math.max(0.001, s.seconds)
      return { start, end: acc }
    })
  }, [segments])

  const activeIdx = useMemo(() => {
    for (let i = 0; i < bounds.length; i += 1) {
      if (safeValue >= bounds[i].start && (safeValue < bounds[i].end || i === bounds.length - 1)) return i
    }
    return bounds.length - 1
  }, [bounds, safeValue])

  const anchors = useMemo<Anchor[]>(() => {
    const list = bounds.map((b, i) => ({ time: b.start, idx: i, label: `#${i + 1} ${segments[i].label}起点` }))
    if (list.length > 0) list.push({ time: total, idx: list.length - 1, label: '成片终点' })
    return list
  }, [bounds, segments, total])

  const baseW = Math.max(width - PAD_LEFT - PAD_RIGHT, 580)
  const trackW = baseW * zoom
  const canvasW = trackW + PAD_LEFT + PAD_RIGHT
  const pxOf = (t: number): number => PAD_LEFT + (t / (total || 1)) * trackW

  useEffect(() => {
    const el = scrollRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0
      if (w > 0) setWidth(w)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => () => window.clearTimeout(flashTimer.current), [])

  const segIdxAt = (t: number): number => {
    for (let i = 0; i < bounds.length; i += 1) {
      if (t >= bounds[i].start && (t < bounds[i].end || i === bounds.length - 1)) return i
    }
    return bounds.length - 1
  }

  const calcSnap = (clientX: number): { time: number; anchor: Anchor | null } => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect || trackW <= 0) return { time: safeValue, anchor: null }
    const relX = clientX - rect.left - PAD_LEFT
    let t = Math.max(0, Math.min(total, (relX / trackW) * total))
    let anchor: Anchor | null = null
    if (snapOn) {
      const radius = (SNAP_RADIUS_PX / trackW) * total
      let minDiff = Infinity
      for (const a of anchors) {
        const diff = Math.abs(t - a.time)
        if (diff <= radius && diff < minDiff) {
          minDiff = diff
          anchor = a
        }
      }
      if (anchor) t = anchor.time
    }
    return { time: t, anchor }
  }

  const showTip = (time: number, anchor: Anchor | null): void => {
    const scroll = scrollRef.current
    const wrapW = scroll?.clientWidth ?? 0
    const x = Math.max(90, Math.min(wrapW - 110, pxOf(time) - (scroll?.scrollLeft ?? 0)))
    const i = segIdxAt(time)
    const text = anchor
      ? `已吸附 ${anchor.label} · ${fmtSec(time)}`
      : `${fmtSec(time)} · #${i + 1} ${segments[i]?.label ?? ''}`
    setTip({ x, text, snapped: Boolean(anchor), visible: true })
  }

  const clearSnap = (): void => {
    setLaserX(null)
    setHeadSnapped(false)
    setFlashIdx(-1)
  }

  const flash = (anchor: Anchor): void => {
    setLaserX(pxOf(anchor.time))
    setHeadSnapped(true)
    setFlashIdx(anchor.idx)
    showTip(anchor.time, anchor)
    window.clearTimeout(flashTimer.current)
    flashTimer.current = window.setTimeout(() => {
      clearSnap()
      setTip((t) => ({ ...t, visible: false }))
    }, 900)
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return
    const block = (e.target as HTMLElement).closest('[data-idx]') as HTMLElement | null
    dragRef.current = {
      active: true,
      startX: e.clientX,
      moved: false,
      clickedIdx: block ? Number(block.dataset.idx) : -1
    }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>): void => {
    const d = dragRef.current
    if (!d.active) return
    if (Math.abs(e.clientX - d.startX) > 4) d.moved = true
    if (!d.moved) return
    const { time, anchor } = calcSnap(e.clientX)
    onChange(time)
    if (anchor) {
      setLaserX(pxOf(anchor.time))
      setHeadSnapped(true)
      setFlashIdx(anchor.idx)
    } else {
      clearSnap()
    }
    showTip(time, anchor)
  }

  const onPointerUp = (e: PointerEvent<HTMLDivElement>): void => {
    const d = dragRef.current
    if (!d.active) return
    d.active = false
    if (d.moved) {
      setTip((t) => ({ ...t, visible: false }))
      clearSnap()
      return
    }
    if (d.clickedIdx >= 0 && bounds[d.clickedIdx]) {
      const start = bounds[d.clickedIdx].start
      onChange(start)
      if (snapOn) {
        flash({ time: start, idx: d.clickedIdx, label: `#${d.clickedIdx + 1} ${segments[d.clickedIdx].label}起点` })
      }
      return
    }
    const { time, anchor } = calcSnap(e.clientX)
    onChange(time)
    if (anchor) flash(anchor)
  }

  const onPointerCancel = (): void => {
    dragRef.current.active = false
    setTip((t) => ({ ...t, visible: false }))
    clearSnap()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const step = e.shiftKey ? 1 : 0.1
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      onChange(Math.max(0, safeValue - step))
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      onChange(Math.min(total, safeValue + step))
    } else if (e.key === 'Home') {
      e.preventDefault()
      onChange(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      onChange(total)
    }
  }

  return (
    <div
      className={`dw-tl2${className ? ` ${className}` : ''}`}
      role="slider"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={Math.round(total * 10) / 10}
      aria-valuenow={Math.round(safeValue * 10) / 10}
      aria-valuetext={fmtSec(safeValue)}
      onKeyDown={onKeyDown}
    >
      <div className="dw-tl2-toolbar">
        <button
          type="button"
          className={`dw-tl2-tool${snapOn ? ' is-on' : ''}`}
          onClick={() => setSnapOn((v) => !v)}
          aria-pressed={snapOn}
          title="拖动播放头接近段落边界时自动磁吸对齐"
        >
          <MagnetIcon />
          磁吸定位
        </button>
        <span className="dw-tl2-hint">任意位置按住拖动 · 经过接缝自动磁吸 · 轻点色块直达段首</span>
        <span className="dw-spacer" />
        <span className="dw-tl2-zoom-label">缩放</span>
        <input
          type="range"
          className="dw-tl2-zoom"
          min={1}
          max={3.5}
          step={0.1}
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          aria-label="缩放时间轴"
        />
        <button type="button" className="dw-tl2-tool" onClick={() => setZoom(1)}>
          适配
        </button>
      </div>

      <div className="dw-tl2-scroll" ref={scrollRef}>
        <div
          className="dw-tl2-canvas"
          ref={canvasRef}
          style={{ width: canvasW }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
        >
          <div className="dw-tl2-track">
            {segments.map((s, i) => {
              const b = bounds[i]
              const w = Math.max(((b.end - b.start) / (total || 1)) * trackW - 2, 18)
              return (
                <div
                  key={s.key}
                  data-idx={i}
                  className={`dw-tl2-block${i === activeIdx ? ' is-active' : ''}${i === flashIdx ? ' is-flash' : ''}`}
                  style={{
                    left: pxOf(b.start),
                    width: w,
                    background: rgba(s.color, 0.2),
                    borderColor: rgba(s.color, 0.55)
                  }}
                  title={s.title}
                >
                  <span className="dw-tl2-bar" style={{ background: s.color }} />
                  <div className="dw-tl2-head">
                    <span className="dw-tl2-title">
                      #{i + 1} {s.label}
                    </span>
                    {w > 74 && s.ep && <span className="dw-tl2-ep">{s.ep}</span>}
                  </div>
                  <div className="dw-tl2-sub">{w > 110 && s.sub ? s.sub : `${s.seconds.toFixed(1)}s`}</div>
                </div>
              )
            })}
          </div>
          {laserX !== null && <div className="dw-tl2-laser" style={{ left: laserX }} />}
          <div
            className={`dw-tl2-playhead${headSnapped ? ' is-snapped' : ''}`}
            style={{ left: pxOf(safeValue) }}
          >
            <div className="dw-tl2-cap" />
          </div>
        </div>
      </div>

      <div
        className={`dw-tl2-tip dw-mono${tip.visible ? ' is-visible' : ''}${tip.snapped ? ' is-snapped' : ''}`}
        style={{ left: tip.x }}
      >
        {tip.snapped && <MagnetIcon />}
        {tip.text}
      </div>
    </div>
  )
}