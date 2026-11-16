import { forwardRef } from 'react'
import type { ReactElement, ReactNode, SVGProps } from 'react'

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  /** 尺寸，默认 1em（跟随字号，与 antd 图标一致） */
  size?: number | string
  /** 读屏名称；提供后 role=img 且不再 aria-hidden */
  label?: string
  strokeWidth?: number
}

type BaseProps = IconProps & { children: ReactNode }

const Base = forwardRef<SVGSVGElement, BaseProps>(function Base(
  { size, label, strokeWidth = 1.75, className, children, ...rest },
  ref
): ReactElement {
  const ariaLabel = label ?? rest['aria-label']
  return (
    <svg
      ref={ref}
      className={`anticon dw-icon${className ? ` ${className}` : ''}`}
      width={size ?? '1em'}
      height={size ?? '1em'}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={ariaLabel ? 'img' : undefined}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  )
})

function createIcon(name: string, node: ReactNode) {
  const C = forwardRef<SVGSVGElement, IconProps>(function Icon(props, ref): ReactElement {
    return (
      <Base {...props} ref={ref}>
        {node}
      </Base>
    )
  })
  C.displayName = name
  return C
}

/* ---- 品牌 / 导航 ---- */

/**
 * 龙龙智剪 · 国际一线标准矢量品牌徽标（BrandMark）
 * 采用黄金比例双弯刀龙角 + 东方流线型龙吻 + 标志性“智剪刀锋”S型负空间切槽，
 * 无论在 16px favicon、36px 侧边导航栏还是 Retina 高分屏下均保持绝对锐利的几何边缘。
 */
export function BrandMark({
  size = 36,
  className
}: {
  size?: number
  className?: string
}): ReactElement {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 1024 1024"
      fill="none"
      role="img"
      aria-label="龙龙智剪"
      focusable="false"
    >
      <defs>
        <linearGradient id="dw-brand-bg" x1="120" y1="80" x2="904" y2="944" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#3B82F6" />
          <stop offset="48%" stopColor="#1D4ED8" />
          <stop offset="100%" stopColor="#06B6D4" />
        </linearGradient>
        <radialGradient id="dw-brand-glow" cx="22%" cy="18%" r="64%">
          <stop offset="0%" stopColor="#60A5FA" stopOpacity="0.42" />
          <stop offset="100%" stopColor="#1E3A8A" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="dw-brand-glyph" x1="512" y1="140" x2="512" y2="868" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="100%" stopColor="#F1F5F9" />
        </linearGradient>
      </defs>
      <rect width="1024" height="1024" rx="240" fill="url(#dw-brand-bg)" />
      <rect width="1024" height="1024" rx="240" fill="url(#dw-brand-glow)" />
      <rect
        x="14"
        y="14"
        width="996"
        height="996"
        rx="226"
        stroke="#FFFFFF"
        strokeOpacity="0.18"
        strokeWidth="20"
      />
      <path
        fill="url(#dw-brand-glyph)"
        fillRule="evenodd"
        clipRule="evenodd"
        d="M398 142 C428 232 510 302 628 354 C644 360 654 372 660 392 L670 426 C730 452 798 474 866 486 C854 538 816 584 758 616 L712 640 C722 604 726 580 722 564 C654 530 570 526 484 550 C400 504 308 502 224 544 C250 476 302 430 370 410 C266 390 196 330 174 240 C246 302 340 338 446 342 C400 286 384 214 398 142 Z M502 420 C560 416 606 440 626 486 C564 492 518 466 502 420 Z M210 584 C306 538 416 546 528 606 C574 630 622 632 672 606 C662 660 626 702 570 724 C510 702 458 662 416 618 C372 678 378 772 428 868 C296 800 212 700 210 584 Z"
      />
    </svg>
  )
}

export const IconCut = createIcon(
  'IconCut',
  <>
    <circle cx="6" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <path d="M20 4 8.12 15.88" />
    <path d="M14.47 14.48 20 20" />
    <path d="M8.12 8.12 12 12" />
  </>
)

export const IconQueue = createIcon(
  'IconQueue',
  <>
    <circle cx="5" cy="6" r="1.4" fill="currentColor" stroke="none" />
    <path d="M9.5 6H20" />
    <circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" />
    <path d="M9.5 12H20" />
    <circle cx="5" cy="18" r="1.4" fill="currentColor" stroke="none" />
    <path d="M9.5 18H16" />
  </>
)

export const IconSliders = createIcon(
  'IconSliders',
  <>
    <path d="M21 4h-7" />
    <path d="M10 4H3" />
    <path d="M21 12h-9" />
    <path d="M8 12H3" />
    <path d="M21 20h-5" />
    <path d="M12 20H3" />
    <path d="M14 2v4" />
    <path d="M8 10v4" />
    <path d="M16 18v4" />
  </>
)

export const IconBolt = createIcon(
  'IconBolt',
  <path d="M13 2 4.8 13.4H11L9.6 22 19.2 9.6H12.6Z" fill="currentColor" stroke="currentColor" strokeWidth="1.2" />
)

/* ---- 主题 ---- */

export const IconSun = createIcon(
  'IconSun',
  <>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2" />
    <path d="M12 20v2" />
    <path d="m4.93 4.93 1.41 1.41" />
    <path d="m17.66 17.66 1.41 1.41" />
    <path d="M2 12h2" />
    <path d="M20 12h2" />
    <path d="m6.34 17.66-1.41 1.41" />
    <path d="m19.07 4.93-1.41 1.41" />
  </>
)

export const IconMoon = createIcon('IconMoon', <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />)

export const IconMonitor = createIcon(
  'IconMonitor',
  <>
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M8 20h8" />
    <path d="M12 16v4" />
  </>
)

/* ---- 通用动作 ---- */

export const IconPlus = createIcon(
  'IconPlus',
  <>
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </>
)

export const IconTrash = createIcon(
  'IconTrash',
  <>
    <path d="M4 7h16" />
    <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    <path d="m6 7 1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
    <path d="M10 11v6" />
    <path d="M14 11v6" />
  </>
)

export const IconCopy = createIcon(
  'IconCopy',
  <>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
  </>
)

export const IconFolderOpen = createIcon(
  'IconFolderOpen',
  <path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />
)

export const IconReload = createIcon(
  'IconReload',
  <>
    <path d="M21 12a9 9 0 1 1-3-6.7" />
    <path d="M21 4v5h-5" />
  </>
)

export const IconStop = createIcon(
  'IconStop',
  <rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" stroke="none" />
)

export const IconBack = createIcon('IconBack', <path d="m15 5-7 7 7 7" />)

export const IconSearch = createIcon(
  'IconSearch',
  <>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </>
)

export const IconClear = createIcon(
  'IconClear',
  <>
    <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" />
    <path d="M22 21H7" />
    <path d="m5 11 9 9" />
  </>
)

export const IconHelp = createIcon(
  'IconHelp',
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.2 9a2.8 2.8 0 0 1 5.4 1c0 1.8-2.6 2.2-2.6 4" />
    <path d="M12 17.5h.01" />
  </>
)

/* ---- 业务语义 ---- */

export const IconScan = createIcon(
  'IconScan',
  <>
    <path d="M3 7V5a2 2 0 0 1 2-2h2" />
    <path d="M17 3h2a2 2 0 0 1 2 2v2" />
    <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
    <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
    <path d="M3 12h18" />
  </>
)

export const IconScript = createIcon(
  'IconScript',
  <>
    <path d="M6 3h8l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
    <path d="M14 3v4h4" />
    <path d="M8 12h8" />
    <path d="M8 16h6" />
  </>
)

export const IconGlobe = createIcon(
  'IconGlobe',
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18" />
    <path d="M12 3a15.3 15.3 0 0 1 4 9 15.3 15.3 0 0 1-4 9 15.3 15.3 0 0 1-4-9 15.3 15.3 0 0 1 4-9z" />
  </>
)

export const IconImport = createIcon(
  'IconImport',
  <>
    <path d="M12 3v11" />
    <path d="m8 10 4 4 4-4" />
    <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
  </>
)

export const IconVideo = createIcon(
  'IconVideo',
  <>
    <rect x="2.5" y="6.5" width="13" height="11" rx="2" />
    <path d="m15.5 10.5 5.5-3v9l-5.5-3Z" />
  </>
)

export const IconFlask = createIcon(
  'IconFlask',
  <>
    <path d="M9 3h6" />
    <path d="M10 3v6.5L4.8 18a2 2 0 0 0 1.7 3h11a2 2 0 0 0 1.7-3L14 9.5V3" />
    <path d="M7.5 14h9" />
  </>
)

export const IconFlame = createIcon(
  'IconFlame',
  <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
)

export const IconInbox = createIcon(
  'IconInbox',
  <>
    <path d="M22 12h-6l-2 3h-4l-2-3H2" />
    <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
  </>
)

/* ---- 播放器 ---- */

export const IconPlay = createIcon(
  'IconPlay',
  <path d="M8 5.5v13l11-6.5Z" fill="currentColor" stroke="currentColor" strokeWidth="1.5" />
)

export const IconPause = createIcon(
  'IconPause',
  <>
    <rect x="7" y="5" width="3.5" height="14" rx="1.2" fill="currentColor" stroke="none" />
    <rect x="13.5" y="5" width="3.5" height="14" rx="1.2" fill="currentColor" stroke="none" />
  </>
)

export const IconPrev = createIcon(
  'IconPrev',
  <>
    <path d="M18 5v14L8 12Z" fill="currentColor" stroke="currentColor" strokeWidth="1.5" />
    <path d="M6 5v14" />
  </>
)

export const IconNext = createIcon(
  'IconNext',
  <>
    <path d="M6 5v14l10-7Z" fill="currentColor" stroke="currentColor" strokeWidth="1.5" />
    <path d="M18 5v14" />
  </>
)

export const IconLoop = createIcon(
  'IconLoop',
  <>
    <path d="m17 2 4 4-4 4" />
    <path d="M3 11V9a4 4 0 0 1 4-4h14" />
    <path d="m7 22-4-4 4-4" />
    <path d="M21 13v2a4 4 0 0 1-4 4H3" />
  </>
)

export const IconVolume = createIcon(
  'IconVolume',
  <>
    <path d="M4 9v6h4l5 4V5L8 9Z" />
    <path d="M16.5 8.5a5 5 0 0 1 0 7" />
    <path d="M19 6a8.5 8.5 0 0 1 0 12" />
  </>
)

export const IconMute = createIcon(
  'IconMute',
  <>
    <path d="M4 9v6h4l5 4V5L8 9Z" />
    <path d="m17 9 5 6" />
    <path d="m22 9-5 6" />
  </>
)

export const IconMagnet = createIcon(
  'IconMagnet',
  <>
    <path d="M6 15V6a6 6 0 0 1 12 0v9" />
    <path d="M6 19v-2h4v2a2 2 0 0 1-4 0Z" />
    <path d="M14 19v-2h4v2a2 2 0 0 1-4 0Z" />
  </>
)