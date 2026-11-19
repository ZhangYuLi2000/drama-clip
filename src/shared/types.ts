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

export interface TtsCfg extends ModelCfg {
  voice: string
  rate: number
}

export interface AiSettings {
  global: ModelCfg
  text: ModelCfg
  tts: TtsCfg
  replica: ReplicaSettings
  styles: CutStyleConfig[]
}

export type AiSettingsPatch = {
  global?: Partial<ModelCfg>
  text?: Partial<ModelCfg>
  tts?: Partial<TtsCfg>
  replica?: Partial<ReplicaSettings>
  styles?: CutStyleConfig[]
}

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

export type CutStyle = string
export type CutMode = 'independent' | 'hook-matrix' | 'viral-clone'

export interface CutStyleMeta {
  name: string
  desc: string
  defaultTarget: number
  roles: string[]
}

export interface CutStyleConfig extends CutStyleMeta {
  id: string
}

export const DEFAULT_CUT_STYLES: CutStyleConfig[] = [
  {
    id: 'conflict',
    name: '冲突爆破',
    desc: '0-3 秒最强欺辱/冲突直接开场，紧接反击爽点，节奏极快',
    defaultTarget: 45,
    roles: ['钩子', '冲突', '反击']
  },
  {
    id: 'reversal',
    name: '递进反转',
    desc: '立住委屈与赌注 → 反派步步紧逼 → 亮出底牌逆转打脸',
    defaultTarget: 60,
    roles: ['钩子', '铺垫', '升级', '反转']
  },
  {
    id: 'suspense',
    name: '悬念卡点',
    desc: '冲突层层加码，在身份揭晓或关键动作即将落地时戛然而止',
    defaultTarget: 75,
    roles: ['钩子', '升级', '高潮', '悬念']
  }
]

export const CUT_STYLES: Record<string, CutStyleMeta> = Object.fromEntries(
  DEFAULT_CUT_STYLES.map((s) => [s.id, { name: s.name, desc: s.desc, defaultTarget: s.defaultTarget, roles: s.roles }])
)

export interface ViralBeat {
  role: string
  sec: number
  emotion: string
  desc: string
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
  mode?: CutMode
  matrixGroupId?: string
  beats?: ViralBeat[]
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
  mode?: CutMode
  targetSec: number
  ratio: '9:16' | '16:9'
  count?: number
  prompt?: string
  refVideoPath?: string
  refCopy?: string
}

// ---------------------------------------------------------------- 解说成片

export type NarrationStatus = 'draft' | 'generating' | 'voicing' | 'rendering' | 'ready' | 'fail'
export type NarrationSegStatus = 'pending' | 'voicing' | 'ready' | 'fail'

export interface NarrationSegment {
  id: string
  text: string
  epN: number
  epId: string
  in: number
  out: number
  role: string
  reason: string
  audioFile?: string
  durationSec?: number
  status: NarrationSegStatus
  error?: string
}

export interface NarrationCut {
  id: string
  title: string
  hookHeadline: string
  publishCopy: string
  voice: string
  ttsModel: string
  rate: number
  ratio?: '9:16' | '16:9'
  targetSec: number
  segments: NarrationSegment[]
  status: NarrationStatus
  pct?: number
  error?: string
  fullAudio?: string
  totalAudioSec?: number
  output?: string
  srtPath?: string
  tokens?: number
  revision: number
  createdAt: number
  updatedAt: number
}

export interface GenerateNarrationParams {
  targetSec: number
  ratio?: '9:16' | '16:9'
  voice?: string
  rate?: number
  prompt?: string
  eps?: string
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
  narrations?: NarrationCut[]
  replicas?: ReplicaTask[]
  replicaIndex?: ReplicaIndexState
  /** 剧级自定义话题标签，统一追加到该剧所有引流发布文案末尾 */
  publishTags?: string[]
}

export function withPublishTags(copy: string, tags?: string[]): string {
  const suffix = (tags ?? []).filter(Boolean).join(' ')
  if (!suffix) return copy
  return copy ? `${copy} ${suffix}` : suffix
}

// ---------------------------------------------------------------- 爆款复刻

export type ReplicaStatus = 'queue' | 'indexing' | 'tracing' | 'cutting' | 'ready' | 'fail'
export type ReplicaAudio = 'source' | 'clip' | 'none'

export interface ReplicaStats {
  segments: number
  continuous: number
  still: number
  gap: number
  totalSeconds: number
  resolution: string
  fps: number
  /** 有出处帧占比 0~1 */
  coverage: number
}

export interface ReplicaTask {
  id: string
  clipFile: string
  clipTitle: string
  status: ReplicaStatus
  pct: number
  stageNote?: string
  audio: ReplicaAudio
  crf: number
  despike: boolean
  refine: boolean
  boundsRadius: number
  indexFps: number
  maskTop: number
  maskBottom: number
  /** "0.63,0.78" 或空串 */
  maskBand: string
  output?: string
  edlPath?: string
  tracePath?: string
  stats?: ReplicaStats
  error?: string
  createdAt: number
  updatedAt: number
}

export interface ReplicaIndexState {
  dir: string
  indexFps: number
  builtAt: number
  epCount: number
  stale?: boolean
}

export interface ReplicaSettings {
  indexFps: number
  audio: ReplicaAudio
  crf: number
  despike: boolean
  refine: boolean
  boundsRadius: number
  maskTop: number
  maskBottom: number
  maskBand: string
  workers: number
}

export interface CreateReplicaParams {
  clipFile: string
  clipTitle?: string
  audio?: ReplicaAudio
  crf?: number
  despike?: boolean
  refine?: boolean
  boundsRadius?: number
  indexFps?: number
  maskTop?: number
  maskBottom?: number
  maskBand?: string
}

export interface ReplicaEdlRow {
  segmentId: number
  episode: string
  srcIn: number
  srcOut: number
  srcInTc: string
  srcOutTc: string
  clipIn: number
  clipOut: number
  kind: string
  seconds: number
}

export interface Library {
  version: 1
  dramas: Drama[]
}

export type JobKind = 'probe' | 'thumb' | 'shots' | 'global' | 'generate-cut' | 'render-cut' | 'replica' | 'narration'

export interface JobInfo {
  kind: JobKind
  dramaId: string
  episodeId: string
  cutId?: string
  replicaId?: string
  narrationId?: string
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

export interface LibrarySnapshot {
  library: Library
  job: JobInfo | null
  running: number
  logs: JobLogState
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
