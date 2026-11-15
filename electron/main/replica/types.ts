/** 复刻引擎内部类型（纯 Node，无 Electron 依赖，可在 worker 中运行）。 */

export interface MediaInfo {
  path: string
  width: number
  height: number
  fps: number
  fpsNum: number
  fpsDen: number
  fpsQ: number
  nbFrames: number
  duration: number
  /** 每帧 PTS（秒，显示序）；CFR 快路径或逐帧 ffprobe 得到，可能为 null */
  times: Float64Array | null
}

export type Band = readonly [number, number]

export interface MaskCfg {
  maskBottom?: number
  maskTop?: number
  edge?: number
  band?: Band | null
}

export type Note = (msg: string) => void

/** 逐帧溯源行（frames 模式产物，等价 Python frame_origins.csv 一行） */
export interface OriginRow {
  clipFrame: number
  clipTc: string
  episode: string
  episodeFile: string
  srcFrame: number | null
  srcTc: string
  distance: number
  flip: string
  indexStep: number | null
  confidence: 'high' | 'medium' | 'low' | 'none'
}

/** 溯源表行（load_trace 产物）：[clip帧, 集, 源帧(-1=无), 镜像, 置信] */
export type TraceRow = [number, string, number, string, string]

export interface EdlSeg {
  segmentId: number
  clipIn: number
  clipOut: number
  clipFrames: number
  episode: string
  srcIn: number
  srcOut: number
  srcFrames: number
  kind: 'continuous' | 'still' | 'gap'
  flip: string
}

export interface EpisodeIndex {
  eid: string
  name: string
  path: string
  info: MediaInfo
  step: number
  /** 每条索引行对应的精确源帧号 (Ni,) */
  frameIdx: Int32Array
  /** 描述子 (Ni, F, 16, 9) float32，行优先 */
  desc: Float32Array
  ni: number
  nf: number
}

export interface ReplicaIndex {
  episodes: EpisodeIndex[]
  config: IndexManifest
}

export interface IndexManifestEpisode {
  eid: string
  name: string
  path: string
  file: string
  nbFrames: number
  fps: number
  step: number
  indexed: number
  width: number
  height: number
  duration: number
}

export interface IndexManifest {
  version: number
  format: string
  created: string
  size: number
  indexFps: number
  variants: [boolean, boolean][]
  episodes: IndexManifestEpisode[]
}
