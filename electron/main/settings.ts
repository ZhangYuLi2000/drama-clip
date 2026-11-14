import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import type { AiSettings, AiSettingsPatch } from '../../src/shared/types'

const DEFAULTS: AiSettings = {
  video: { baseUrl: 'https://open.bigmodel.cn/api/paas/v4', apiKey: '', model: 'glm-5.3-flash' },
  text: { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', apiKey: '', model: 'qwen-flash' },
  global: { baseUrl: 'http://127.0.0.1:3425/v1', apiKey: '', model: 'wandapi/gemini-4-hydrogen' }
}

let file = ''
let settings: AiSettings = { video: { ...DEFAULTS.video }, text: { ...DEFAULTS.text }, global: { ...DEFAULTS.global } }

function migrate(parsed: unknown): AiSettings {
  const p = (parsed ?? {}) as Record<string, unknown>
  if (p.video && p.text) {
    return {
      video: { ...DEFAULTS.video, ...(p.video as object) },
      text: { ...DEFAULTS.text, ...(p.text as object) },
      global: { ...DEFAULTS.global, ...(p.global as object) }
    }
  }
  // 旧版单端点配置：原端点归视觉侧，文本侧留空待用户单独配置
  if (typeof p.baseUrl === 'string') {
    return {
      video: {
        baseUrl: p.baseUrl,
        apiKey: typeof p.apiKey === 'string' ? p.apiKey : '',
        model: typeof p.modelB === 'string' ? p.modelB : DEFAULTS.video.model
      },
      text: {
        baseUrl: DEFAULTS.text.baseUrl,
        apiKey: '',
        model: typeof p.modelA === 'string' ? p.modelA : DEFAULTS.text.model
      },
      global: { ...DEFAULTS.global }
    }
  }
  return { video: { ...DEFAULTS.video }, text: { ...DEFAULTS.text }, global: { ...DEFAULTS.global } }
}

export function initSettings(): void {
  file = path.join(app.getPath('userData'), 'settings.json')
  try {
    settings = migrate(JSON.parse(fs.readFileSync(file, 'utf8')))
  } catch {
    settings = { video: { ...DEFAULTS.video }, text: { ...DEFAULTS.text }, global: { ...DEFAULTS.global } }
  }
}

export function getSettings(): AiSettings {
  return settings
}

export function saveSettings(patch: AiSettingsPatch): AiSettings {
  settings = {
    video: { ...settings.video, ...(patch.video ?? {}) },
    text: { ...settings.text, ...(patch.text ?? {}) },
    global: { ...settings.global, ...(patch.global ?? {}) }
  }
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2))
  fs.renameSync(tmp, file)
  return settings
}