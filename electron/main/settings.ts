import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import type { AiSettings, AiSettingsPatch, ModelCfg, ReplicaSettings } from '../../src/shared/types'

const DEFAULTS: AiSettings = {
  global: { baseUrl: 'http://127.0.0.1:3425/v1', apiKey: '', model: 'wandapi/gemini-4-hydrogen' },
  text: { baseUrl: '', apiKey: '', model: '' },
  replica: {
    indexFps: 12,
    audio: 'source',
    crf: 16,
    despike: true,
    refine: true,
    boundsRadius: 6,
    maskTop: 0.08,
    maskBottom: 0.28,
    maskBand: '',
    workers: 3
  }
}

let file = ''
let settings: AiSettings = {
  global: { ...DEFAULTS.global },
  text: { ...DEFAULTS.text },
  replica: { ...DEFAULTS.replica }
}

function migrate(parsed: unknown): AiSettings {
  const p = (parsed ?? {}) as Record<string, unknown>
  return {
    global: { ...DEFAULTS.global, ...((p.global as object) ?? {}) },
    text: { ...DEFAULTS.text, ...((p.text as object) ?? {}) },
    replica: { ...DEFAULTS.replica, ...((p.replica as object) ?? {}) }
  }
}

export function initSettings(): void {
  file = path.join(app.getPath('userData'), 'settings.json')
  try {
    settings = migrate(JSON.parse(fs.readFileSync(file, 'utf8')))
  } catch {
    settings = { global: { ...DEFAULTS.global }, text: { ...DEFAULTS.text }, replica: { ...DEFAULTS.replica } }
  }
}

export function getSettings(): AiSettings {
  return settings
}

/** 文本编排模型：若未单独配置，则自动复用全局模型配置 */
export function getEffectiveTextModel(): ModelCfg {
  if (settings.text.apiKey.trim() && settings.text.baseUrl.trim() && settings.text.model.trim()) {
    return settings.text
  }
  return settings.global
}

export function saveSettings(patch: AiSettingsPatch): AiSettings {
  settings = {
    global: { ...settings.global, ...(patch.global ?? {}) },
    text: { ...settings.text, ...(patch.text ?? {}) },
    replica: { ...settings.replica, ...(patch.replica ?? {}) }
  }
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2))
  fs.renameSync(tmp, file)
  return settings
}

export function getReplicaSettings(): ReplicaSettings {
  return settings.replica
}
