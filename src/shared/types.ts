export type AsrStatus = 'idle' | 'queue' | 'run' | 'done' | 'fail'
export type AnaStatus = 'idle' | 'queue' | 'run' | 'done' | 'fail'
export type CandStatus = 'pending' | 'approved' | 'rejected'

export interface AsrSegment {
  start: number
  end: number
  text: string
}

export interface Candidate {
  id: string
  score: number
  title: string
  tags: string[]
  in: number
  out: number
  src: string
  status: CandStatus
  reason: string
  bd: Record<string, number>
  scene: string
  hook?: number
  quote?: string
  conflict?: string
  characters?: string[]
  clip?: string
  clipThumb?: string
  approvedAt?: number
}

export interface ModelCfg {
  baseUrl: string
  apiKey: string
  model: string
}

export interface AiSettings {
  global: ModelCfg
  text: ModelCfg
}

export type AiSettingsPatch = { global?: Partial<ModelCfg>; text?: Partial<ModelCfg> }

export interface Episode {
  id: string
  n: number
  file: string
  fileName: string
  size: number
  duration: number | null
  width: number | null
  height: number | null
  thumb: string | null
  asr: AsrStatus
  asrPct?: number
  asrNote?: string
  segments?: AsrSegment[]
  ana: AnaStatus
  anaPct?: number
  anaNote?: string
  candidates?: Candidate[]
  shots?: number[]
  summary?: string
  cand: number
  pending: number
  hl: number
}

export interface Character {
  name: string
  role: string
  desc?: string
}

export interface DramaSynthesis {
  characters: Character[]
  logline: string
  arcs: string
  updatedAt: number
}

export interface GlobalMapEntry {
  epId: string
  n: number
  globalStart: number
  globalEnd: number
  duration: number
}

export interface GlobalScriptEpisode {
  n: number
  summary: string
  transcript: AsrSegment[]
}

export interface GlobalScript {
  logline: string
  arcs: string
  episodes: GlobalScriptEpisode[]
}

export interface DramaGlobal {
  status: 'idle' | 'queue' | 'run' | 'done' | 'fail'
  pct?: number
  note?: string
  model: string
  acts?: number
  map: GlobalMapEntry[]
  tokens: number
  cachedTokens: number
  updatedAt: number
}

export type CutStyle = 'conflict' | 'reversal' | 'suspense'

export interface CutStyleMeta {
  name: string
  desc: string
  defaultTarget: number
  roles: string[]
}

export const CUT_STYLES: Record<CutStyle, CutStyleMeta> = {
  conflict: {
    name: '冲突爆破',
    desc: '0-3 秒最强欺辱/冲突直接开场，紧接反击爽点，节奏极快',
    defaultTarget: 45,
    roles: ['钩子', '冲突', '反击']
  },
  reversal: {
    name: '递进反转',
    desc: '立住委屈与赌注 → 反派步步紧逼 → 亮出底牌逆转打脸',
    defaultTarget: 60,
    roles: ['钩子', '铺垫', '升级', '反转']
  },
  suspense: {
    name: '悬念卡点',
    desc: '冲突层层加码，在身份揭晓或关键动作即将落地时戛然而止',
    defaultTarget: 75,
    roles: ['钩子', '升级', '高潮', '悬念']
  }
}

export interface CutClip {
  epId: string
  epN: number
  in: number
  out: number
  role: string
  why: string
  quote?: string
}

export interface PromoCut {
  id: string
  title: string
  style: CutStyle
  ratio: '9:16' | '16:9'
  targetSec: number
  actualSec: number
  hookHeadline: string
  publishCopy: string
  conflictSummary: string
  directorNote: string
  clips: CutClip[]
  status: 'draft' | 'rendering' | 'ready' | 'fail'
  pct?: number
  output?: string
  srtPath?: string
  error?: string
  revision: number
  lastInstruction?: string
  createdAt: number
  updatedAt: number
}

export interface GenerateCutParams {
  style: CutStyle
  targetSec: number
  ratio: '9:16' | '16:9'
  count?: number
  prompt?: string
}

export interface Drama {
  id: string
  title: string
  dir: string
  createdAt: number
  episodes: Episode[]
  synthesis?: DramaSynthesis
  global?: DramaGlobal
  cuts?: PromoCut[]
}

export interface Library {
  version: 1
  dramas: Drama[]
}

export type JobKind = 'probe' | 'thumb' | 'shots' | 'global' | 'generate-cut' | 'render-cut'

export interface JobInfo {
  kind: JobKind
  dramaId: string
  episodeId: string
  cutId?: string
  label: string
  pct: number
}

export interface JobLogEntry {
  t: number
  level: 'info' | 'warn' | 'error'
  msg: string
}

export interface JobLogState {
  logs: JobLogEntry[]
  done: number
  failed: number
}

export interface ScanFile {
  file: string
  fileName: string
  size: number
  n: number | null
}

export interface ScanResult {
  dir: string
  title: string
  files: ScanFile[]
  matched: number
  unmatched: number
  totalSize: number
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string }
