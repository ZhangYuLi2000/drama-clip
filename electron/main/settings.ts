import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import { DEFAULT_CUT_STYLES } from '../../src/shared/types'
import type { AiSettings, AiSettingsPatch, CutStyleConfig, ModelCfg, ReplicaSettings } from '../../src/shared/types'

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
  },
  styles: DEFAULT_CUT_STYLES.map((s) => ({ ...s, roles: [...s.roles] }))
}

let file = ''
let settings: AiSettings = {
  global: { ...DEFAULTS.global },
  text: { ...DEFAULTS.text },
  replica: { ...DEFAULTS.replica },
  styles: DEFAULTS.styles.map((s) => ({ ...s, roles: [...s.roles] }))
}

function normalizeStyles(raw: unknown): CutStyleConfig[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return DEFAULT_CUT_STYLES.map((s) => ({ ...s, roles: [...s.roles] }))
  }
  const list: CutStyleConfig[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    const o = (item ?? {}) as Record<string, unknown>
    const id = String(o.id ?? '').trim()
    const name = String(o.name ?? '').trim()
    if (!id || !name || id === 'auto' || seen.has(id)) continue
    seen.add(id)
    const roles = Array.isArray(o.roles)
      ? o.roles.map((r) => String(r).trim()).filter(Boolean)
      : ['钩子', '冲突', '高潮']
    list.push({
      id: id.slice(0, 32),
      name: name.slice(0, 20),
      desc: String(o.desc ?? '').trim().slice(0, 100),
      defaultTarget: typeof o.defaultTarget === 'number' && o.defaultTarget >= 0 ? Math.round(o.defaultTarget) : 45,
      roles: roles.length > 0 ? roles.slice(0, 8) : ['钩子', '冲突', '高潮']
    })
  }
  return list.length > 0 ? list : DEFAULT_CUT_STYLES.map((s) => ({ ...s, roles: [...s.roles] }))
}

function migrate(parsed: unknown): AiSettings {
  const p = (parsed ?? {}) as Record<string, unknown>
  return {
    global: { ...DEFAULTS.global, ...((p.global as object) ?? {}) },
    text: { ...DEFAULTS.text, ...((p.text as object) ?? {}) },
    replica: { ...DEFAULTS.replica, ...((p.replica as object) ?? {}) },
    styles: normalizeStyles(p.styles)
  }
}

export function initSettings(): void {
  file = path.join(app.getPath('userData'), 'settings.json')
  try {
    settings = migrate(JSON.parse(fs.readFileSync(file, 'utf8')))
  } catch {
    settings = {
      global: { ...DEFAULTS.global },
      text: { ...DEFAULTS.text },
      replica: { ...DEFAULTS.replica },
      styles: DEFAULTS.styles.map((s) => ({ ...s, roles: [...s.roles] }))
    }
  }
}

export function getSettings(): AiSettings {
  return settings
}

/** 获取指定风格的元数据；传入 'auto' 或未命中时返回 null（由 AI 自由定调） */
export function getCutStyleMeta(styleId?: string): CutStyleConfig | null {
  if (!styleId || styleId === 'auto') return null
  return settings.styles.find((s) => s.id === styleId) ?? null
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
    replica: { ...settings.replica, ...(patch.replica ?? {}) },
    styles: patch.styles ? normalizeStyles(patch.styles) : settings.styles
  }
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2))
  fs.renameSync(tmp, file)
  return settings
}

export function getReplicaSettings(): ReplicaSettings {
  return settings.replica
}
