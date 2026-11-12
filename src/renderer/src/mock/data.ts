export interface Drama {
  id: string
  title: string
  eps: number
  tint: string
}

export type AsrStatus = 'done' | 'run' | 'queue' | 'fail' | 'idle'
export type AnaStatus = 'done' | 'wait' | 'run' | 'idle'

export interface Episode {
  n: number
  dur: string
  asr: AsrStatus
  asrPct?: number
  ana: AnaStatus
  cand?: number
  pending?: number
  hl?: number
  note?: string
}

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
  lines: CandLine[]
}

export interface Highlight {
  id: string
  d: string
  ep: number
  score: number
  dur: number
  tags: string[]
  title: string
  scene: string
}

export interface MixClip {
  hl: Highlight
  role: string
  dur: number
  why: string
}

export interface MixResult {
  status: 'loading' | 'ready' | 'rendering' | 'done'
  clips: MixClip[]
  pct: number
}

export const EP_DUR = 138

export const SHOTS = [
  0, 4.2, 8.6, 12.4, 17.8, 22.5, 27.0, 31.6, 36.8, 41.3, 46.0, 50.8, 55.4, 60.2, 63.5, 68.9,
  73.4, 78.0, 82.6, 87.0, 91.5, 96.0, 99.5, 104.0, 108.5, 112.0, 116.4, 120.8, 125.3, 129.0,
  133.0, 138
]

export const TAGSET = ['冲突', '反转', '爽点', '打脸', '甜宠', '哭戏', '悬念']

export const DRAMAS: Drama[] = [
  { id: 'd1', title: '闪婚总裁契约妻', eps: 80, tint: '#ece4f5' },
  { id: 'd2', title: '重生之都市修仙', eps: 100, tint: '#e2edf6' },
  { id: 'd3', title: '太后娘娘有喜了', eps: 60, tint: '#f6ebe1' }
]

export const INITIAL_EPS: Record<string, Episode[]> = {
  d1: [
    { n: 1, dur: '02:05', asr: 'done', ana: 'done', cand: 9, pending: 0, hl: 2 },
    { n: 2, dur: '01:58', asr: 'done', ana: 'done', cand: 11, pending: 0, hl: 1 },
    { n: 3, dur: '02:18', asr: 'done', ana: 'done', cand: 8, pending: 6, hl: 1 },
    { n: 4, dur: '02:02', asr: 'done', ana: 'done', cand: 10, pending: 0, hl: 1 },
    { n: 5, dur: '02:11', asr: 'run', asrPct: 62, ana: 'wait' },
    { n: 6, dur: '01:52', asr: 'queue', ana: 'wait' },
    { n: 7, dur: '02:20', asr: 'fail', ana: 'wait', note: 'bcut 限流 → whisper.cpp 重试中' },
    { n: 8, dur: '02:08', asr: 'idle', ana: 'idle' }
  ],
  d2: [
    { n: 1, dur: '02:30', asr: 'done', ana: 'done', cand: 12, pending: 0, hl: 1 },
    { n: 2, dur: '02:12', asr: 'done', ana: 'done', cand: 10, pending: 0, hl: 0 },
    { n: 3, dur: '02:24', asr: 'done', ana: 'done', cand: 11, pending: 0, hl: 0 },
    { n: 4, dur: '02:06', asr: 'done', ana: 'done', cand: 9, pending: 0, hl: 0 },
    { n: 8, dur: '02:18', asr: 'done', ana: 'done', cand: 10, pending: 0, hl: 1 },
    { n: 12, dur: '02:26', asr: 'done', ana: 'done', cand: 13, pending: 0, hl: 1 },
    { n: 15, dur: '02:09', asr: 'done', ana: 'done', cand: 9, pending: 0, hl: 1 },
    { n: 21, dur: '02:22', asr: 'done', ana: 'done', cand: 11, pending: 0, hl: 1 }
  ],
  d3: [
    { n: 1, dur: '01:58', asr: 'idle', ana: 'idle' },
    { n: 2, dur: '02:04', asr: 'idle', ana: 'idle' },
    { n: 3, dur: '02:10', asr: 'idle', ana: 'idle' }
  ]
}

export const INITIAL_CANDS: Candidate[] = [
  {
    id: 'c1', score: 92, title: '契约被撕，女主反手甩出证据', tags: ['反转', '打脸', '爽点'],
    in: 12.4, out: 36.8, src: 'A+B', status: 'pending',
    reason: '台词冲突强度进入全剧前 5%：「这婚，我不结了」是情绪爆点，随后 8 秒内完成反转。B 路视觉确认摔杯特写与全场反应镜头，适合做混剪开场钩子。',
    bd: { 冲突: 95, 情绪: 90, 金句: 88, 画面: 85 }, scene: '宴会厅 · 女主撕毁契约转身',
    lines: [
      { t: 12.4, txt: '这婚，我不结了！' },
      { t: 16.0, txt: '你说什么？当着这么多宾客的面…' },
      { t: 21.5, txt: '证据在这，你自己看。' },
      { t: 28.0, txt: '（全场哗然，杯子落地）' }
    ]
  },
  {
    id: 'c2', score: 88, title: '婆婆摔杯逼跪，一句话全场安静', tags: ['冲突', '爽点'],
    in: 40.0, out: 63.5, src: 'A', status: 'pending',
    reason: '婆媳冲突顶点，「我跪的是天地，不是您」金句密度高，前后 3 秒留白完整。A 路评分 88，B 路复核排队中。',
    bd: { 冲突: 92, 情绪: 86, 金句: 90, 画面: 78 }, scene: '老宅客厅 · 婆媳对峙',
    lines: [
      { t: 40.0, txt: '跪下！我们家的规矩不能破！' },
      { t: 46.2, txt: '我跪的是天地，不是您。' },
      { t: 55.0, txt: '（摔杯声，全场安静）' }
    ]
  },
  {
    id: 'c3', score: 85, title: '雨夜追妻，契约撕了又贴回去', tags: ['甜宠', '反转'],
    in: 66.2, out: 87.0, src: 'A+B', status: 'pending',
    reason: '情绪由虐转甜，雨夜视觉张力强（B 路确认雨戏与面部特写），台词有记忆点，适合甜宠向混剪收尾。',
    bd: { 冲突: 70, 情绪: 92, 金句: 80, 画面: 90 }, scene: '雨夜街头 · 男主追出',
    lines: [
      { t: 66.2, txt: '你走了，契约怎么办？' },
      { t: 71.0, txt: '撕了。' },
      { t: 76.5, txt: '那我把它贴回去，连本带利。' }
    ]
  },
  {
    id: 'c4', score: 81, title: '得知手术费被挪用，崩溃质问', tags: ['哭戏', '冲突'],
    in: 90.0, out: 99.5, src: 'B', status: 'pending',
    reason: 'B 路视觉识别：哭戏特写 + 音频情绪峰值。台词信息量少，A 路漏检，由视频理解补获——双路互补的典型案例。',
    bd: { 冲突: 78, 情绪: 95, 金句: 60, 画面: 88 }, scene: '医院走廊 · 女主落泪',
    lines: [
      { t: 90.0, txt: '我妈的手术费呢？' },
      { t: 94.5, txt: '说话啊！那是救命的钱！' }
    ]
  },
  {
    id: 'c5', score: 78, title: '管家身份曝光：他竟是真正董事', tags: ['反转', '悬念'],
    in: 102.0, out: 114.0, src: 'A', status: 'pending',
    reason: '身份反转信息量大，但铺垫偏长，建议入点收紧 2 秒；可作为混剪悬念位。',
    bd: { 冲突: 72, 情绪: 75, 金句: 82, 画面: 70 }, scene: '书房 · 管家亮出文件',
    lines: [
      { t: 102.0, txt: '这份股权书，您看一下。' },
      { t: 108.0, txt: '不可能…你只是个管家！' }
    ]
  },
  {
    id: 'c6', score: 74, title: '宴会被嘲乡下丫头，钢琴十级打脸', tags: ['打脸', '爽点'],
    in: 118.0, out: 133.0, src: 'A+B', status: 'pending',
    reason: '经典打脸桥段，画面完成度高；台词略套路，评分中等，适合批量混剪备选。',
    bd: { 冲突: 75, 情绪: 70, 金句: 68, 画面: 84 }, scene: '宴会厅 · 女主走向钢琴',
    lines: [
      { t: 118.0, txt: '乡下丫头也配碰这架钢琴？' },
      { t: 124.0, txt: '（十级曲目响起，众人愣住）' }
    ]
  },
  {
    id: 'c7', score: 69, title: '开场伏笔：男主暗中安排转院', tags: ['铺垫'],
    in: 5.0, out: 11.0, src: 'A', status: 'approved',
    reason: '信息铺垫型片段，单独看张力不足，已人工通过作为混剪叙事备用素材。',
    bd: { 冲突: 50, 情绪: 62, 金句: 60, 画面: 66 }, scene: '车内 · 男主打电话',
    lines: [{ t: 5.0, txt: '把阿姨转到 VIP 病房，别告诉她。' }]
  },
  {
    id: 'c8', score: 61, title: '过渡闲聊：司机送女主回家', tags: ['铺垫'],
    in: 95.0, out: 104.0, src: 'A', status: 'rejected',
    reason: '过渡场景，无冲突无金句，与其他候选重叠，已驳回。',
    bd: { 冲突: 40, 情绪: 45, 金句: 50, 画面: 55 }, scene: '车内 · 夜景',
    lines: [{ t: 95.0, txt: '小姐，到了。' }]
  }
]

export const INITIAL_HLS: Highlight[] = [
  { id: 'h1', d: 'd1', ep: 3, score: 92, dur: 24.4, tags: ['反转', '打脸', '爽点'], title: '契约被撕，反手甩出证据', scene: '宴会厅 · 撕契约' },
  { id: 'h2', d: 'd1', ep: 3, score: 88, dur: 23.5, tags: ['冲突', '爽点'], title: '婆婆摔杯逼跪，一句话全场安静', scene: '老宅客厅 · 对峙' },
  { id: 'h3', d: 'd1', ep: 2, score: 90, dur: 18.2, tags: ['打脸', '爽点'], title: '假货礼服被嘲，转身高定惊艳', scene: '晚宴 · 换装出场' },
  { id: 'h4', d: 'd1', ep: 1, score: 86, dur: 21.0, tags: ['甜宠'], title: '民政局门口，总裁举着戒指排队', scene: '民政局 · 排队' },
  { id: 'h5', d: 'd2', ep: 12, score: 94, dur: 26.0, tags: ['爽点', '反转'], title: '修仙归来，一掌拍碎测灵碑', scene: '宗门广场 · 测灵' },
  { id: 'h6', d: 'd2', ep: 8, score: 89, dur: 19.5, tags: ['冲突'], title: '宗门大比，废柴名字亮瞎全场', scene: '大比擂台 · 报名' },
  { id: 'h7', d: 'd2', ep: 21, score: 91, dur: 22.0, tags: ['打脸'], title: '丹药被抢？当场炼出极品', scene: '丹房 · 炼丹' },
  { id: 'h8', d: 'd1', ep: 4, score: 84, dur: 17.8, tags: ['哭戏'], title: '母亲手术成功，女主走廊落泪', scene: '医院走廊 · 落泪' },
  { id: 'h9', d: 'd2', ep: 15, score: 87, dur: 20.4, tags: ['甜宠'], title: '师姐挡剑：这次换我护你', scene: '竹林 · 挡剑' },
  { id: 'h10', d: 'd1', ep: 5, score: 83, dur: 16.0, tags: ['悬念'], title: '神秘电话：他到底是谁？', scene: '阳台 · 接电话' }
]

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

export function nearestShot(t: number): number {
  let best = SHOTS[0]
  for (const s of SHOTS) {
    if (Math.abs(s - t) < Math.abs(best - t)) best = s
  }
  return best
}

export type EpCategory = 'running' | 'failed' | 'review' | 'done' | 'idle'

export function epCat(e: Episode): EpCategory {
  if (e.ana === 'run' || e.asr === 'run' || e.asr === 'queue') return 'running'
  if (e.asr === 'fail') return 'failed'
  if (e.ana === 'done') return (e.pending ?? 0) > 0 ? 'review' : 'done'
  return 'idle'
}

export function dramaById(id: string): Drama {
  return DRAMAS.find((d) => d.id === id) ?? DRAMAS[0]
}