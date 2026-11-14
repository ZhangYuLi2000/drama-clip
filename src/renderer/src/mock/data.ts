import type { Highlight } from '../library'

export interface CandLine {
  t: number
  txt: string
}

export interface Candidate {
  id: string
  score: number
  title: string
  tags: string[]
  in: number
  out: number
  src: string
  status: 'pending' | 'approved' | 'rejected'
  reason: string
  bd: Record<string, number>
  scene: string
  hook?: number
  quote?: string
  conflict?: string
  characters?: string[]
  lines: CandLine[]
}

export interface MixClip {
  hl: Highlight
  role: string
  dur: number
  why: string
  in: number
  out: number
}

export interface MixResult {
  status: 'loading' | 'ready' | 'rendering' | 'done'
  clips: MixClip[]
  pct: number
  output?: string
}

export const EP_DUR = 138

export const TAGSET = ['冲突', '反转', '爽点', '打脸', '甜宠', '哭戏', '悬念']

export const ROLES = ['钩子', '铺垫', '升级', '高潮', '反转', '悬念']

export const ROLE_COLOR: Record<string, string> = {
  钩子: 'red',
  铺垫: 'blue',
  升级: 'orange',
  高潮: 'gold',
  反转: 'purple',
  悬念: 'cyan'
}

export const ROLE_WHY: Record<string, string> = {
  钩子: '开场即冲突，3 秒内抓住注意力',
  铺垫: '建立人物关系，给冲突一个理由',
  升级: '冲突第一次升级，情绪爬坡',
  高潮: '金句 + 情绪顶点，全片最强记忆点',
  反转: '胜利背后的代价，情绪落差',
  悬念: '留钩子引导看下集 / 关注'
}

export const ROLE_CAP: Record<string, number> = {
  钩子: 8,
  铺垫: 9,
  升级: 10,
  高潮: 12,
  反转: 8,
  悬念: 10
}

export function fmt(t: number): string {
  const m = Math.floor(t / 60)
  const s = t - m * 60
  return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s.toFixed(2)}`
}