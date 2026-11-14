import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import type { AiSettings, AiSettingsPatch, ModelCfg } from '../../src/shared/types'

const DEFAULTS: AiSettings = {
  global: { baseUrl: 'http://127.0.0.1:3425/v1', apiKey: '', model: 'wandapi/gemini-4-hydrogen' },
  text: { baseUrl: '', apiKey: '', model: '' }
}

let file = ''
let settings: AiSettings = {
  global: { ...DEFAULTS.global },
  text: { ...DEFAULTS.text }
}

function migrate(parsed: unknown): AiSettings {
  const p = (parsed ?? {}) as Record<string, unknown>
  return {
    global: { ...DEFAULTS.global, ...((p.global as object) ?? {}) },
    text: { ...DEFAULTS.text, ...((p.text as object) ?? {}) }
  }
}

export function initSettings(): void {
  file = path.join(app.getPath('userData'), 'settings.json')
  try {
    settings = migrate(JSON.parse(fs.readFileSync(file, 'utf8')))
  } catch {
    settings = { global: { ...DEFAULTS.global }, text: { ...DEFAULTS.text } }
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
    text: { ...settings.text, ...(patch.text ?? {}) }
  }
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2))
  fs.renameSync(tmp, file)
  return settings
}
