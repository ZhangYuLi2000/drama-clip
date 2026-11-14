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

export interface CandPatch {
  status?: CandStatus
  in?: number
  out?: number
  tags?: string[]
}

export interface ModelCfg {
  baseUrl: string
  apiKey: string
  model: string
}

export interface AiSettings {
  video: ModelCfg
  text: ModelCfg
  global: ModelCfg
}

export type AiSettingsPatch = { video?: Partial<ModelCfg>; text?: Partial<ModelCfg>; global?: Partial<ModelCfg> }

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

export interface Drama {
  id: string
  title: string
  dir: string
  createdAt: number
  episodes: Episode[]
  synthesis?: DramaSynthesis
  global?: DramaGlobal
}

export interface Library {
  version: 1
  dramas: Drama[]
}

export type JobKind = 'probe' | 'thumb' | 'asr' | 'analyze' | 'shots' | 'slice' | 'synthesis' | 'render' | 'global'

export interface JobInfo {
  kind: JobKind
  dramaId: string
  episodeId: string
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

export type MixStructure = 'blast' | 'escalate' | 'cliff'

export interface StructureMeta {
  name: string
  desc: string
  roles: string[]
  caps: Record<string, number>
}

export const STRUCTURES: Record<MixStructure, StructureMeta> = {
  blast: {
    name: '单点爆破',
    desc: '1-2 段最强冲突直接开场，无完整弧线，适合 30 秒',
    roles: ['钩子', '高潮'],
    caps: { 钩子: 8, 高潮: 12 }
  },
  escalate: {
    name: '三段递进',
    desc: '钩子→升级→高潮，冲突层层加码，适合 45-60 秒',
    roles: ['钩子', '升级', '高潮'],
    caps: { 钩子: 8, 升级: 10, 高潮: 12 }
  },
  cliff: {
    name: '悬念卡点',
    desc: '完整弧线结尾留悬念，引导看下集，适合 60-90 秒',
    roles: ['钩子', '铺垫', '升级', '高潮', '反转', '悬念'],
    caps: { 钩子: 8, 铺垫: 9, 升级: 10, 高潮: 12, 反转: 8, 悬念: 10 }
  }
}

export interface ArrangeParams {
  structure: MixStructure
  target: number
  ratio: '9:16' | '16:9'
  prompt: string
  basket: string[]
}

export interface ArrangeClip {
  candId: string
  in: number
  out: number
  role: string
  why: string
}

export interface ArrangeResult {
  clips: ArrangeClip[]
  tokens: number
}

export interface RenderClip {
  candId: string
  in: number
  out: number
}

export interface RenderParams {
  ratio: '9:16' | '16:9'
  clips: RenderClip[]
}

export interface RenderState {
  status: 'idle' | 'running' | 'done' | 'fail'
  pct: number
  output: string
  error: string
}