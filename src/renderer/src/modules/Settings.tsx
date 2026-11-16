import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { IconTrash, IconPlus } from '../icons'
import { AutoComplete, Button, Form, Input, InputNumber, Select, Space, Switch, Tag } from 'antd'
import { DEFAULT_CUT_STYLES } from '../../../shared/types'
import type { CutStyleConfig, ModelCfg, ReplicaSettings } from '../../../shared/types'
import { useLibrary } from '../library'
import { toast } from '../store'
import { CRF_TIP, ParamTip, RADIUS_TIP } from '../paramTips'

const GLOBAL_OPTIONS = [
  { value: 'wandapi/gemini-4-hydrogen', label: 'wandapi/gemini-4-hydrogen（magpie 中转）' },
  { value: 'gemini-4-hydrogen', label: 'gemini-4-hydrogen（Google 官方，有免费档）' },
  { value: 'gemini-4-argon', label: 'gemini-4-argon（Google 官方，仅付费）' }
]

const TEXT_OPTIONS = [
  { value: 'qwen-plus', label: 'qwen-plus（百炼）' },
  { value: 'qwen-max', label: 'qwen-max（百炼）' },
  { value: 'glm-5.3-flash', label: 'glm-5.3-flash（智谱）' }
]

const EMPTY: ModelCfg = { baseUrl: '', apiKey: '', model: '' }

function ModelFields({
  extra,
  value,
  onChange,
  options,
  urlPlaceholder
}: {
  extra: string
  value: ModelCfg
  onChange: (v: ModelCfg) => void
  options: { value: string; label: string }[]
  urlPlaceholder: string
}): ReactElement {
  return (
    <>
      <Form.Item label="Base URL" extra={extra}>
        <Input
          value={value.baseUrl}
          onChange={(e) => onChange({ ...value, baseUrl: e.target.value })}
          placeholder={urlPlaceholder}
        />
      </Form.Item>
      <Form.Item label="API Key">
        <Input.Password
          value={value.apiKey}
          onChange={(e) => onChange({ ...value, apiKey: e.target.value })}
          placeholder="sk-…"
          autoComplete="off"
        />
      </Form.Item>
      <Form.Item label="模型名称" extra="可下拉选择或自由输入模型 ID" style={{ marginBottom: 0 }}>
        <AutoComplete
          value={value.model}
          onChange={(v) => onChange({ ...value, model: v })}
          options={options}
          placeholder="模型名"
        />
      </Form.Item>
    </>
  )
}

export default function Settings(): ReactElement {
  const settings = useLibrary((s) => s.settings)
  const saveSettings = useLibrary((s) => s.saveSettings)
  const [global, setGlobal] = useState<ModelCfg>(EMPTY)
  const [text, setText] = useState<ModelCfg>(EMPTY)
  const [replica, setReplica] = useState<ReplicaSettings | null>(null)
  const [styles, setStyles] = useState<CutStyleConfig[]>(DEFAULT_CUT_STYLES)
  const [saving, setSaving] = useState(false)
  const [savingReplica, setSavingReplica] = useState(false)
  const [savingStyles, setSavingStyles] = useState(false)

  useEffect(() => {
    if (settings) {
      setGlobal(settings.global)
      setText(settings.text)
      setReplica(settings.replica)
      setStyles(settings.styles?.length ? settings.styles : DEFAULT_CUT_STYLES)
    }
  }, [settings])

  const save = (): void => {
    setSaving(true)
    saveSettings({ global, text, styles })
      .then(() => toast('设置已保存'))
      .catch((e: unknown) => toast(e instanceof Error ? e.message : '保存失败', 'info'))
      .finally(() => setSaving(false))
  }

  const saveReplica = (): void => {
    if (!replica) return
    setSavingReplica(true)
    saveSettings({ replica })
      .then(() => toast('溯源重拼引擎设置已保存'))
      .catch((e: unknown) => toast(e instanceof Error ? e.message : '保存失败', 'info'))
      .finally(() => setSavingReplica(false))
  }

  const saveStyleList = (): void => {
    const clean = styles.filter((s) => s.name.trim())
    if (clean.length === 0) {
      toast('请至少保留一种风格', 'info')
      return
    }
    setSavingStyles(true)
    saveSettings({ styles: clean })
      .then(() => toast('叙事基调风格已保存'))
      .catch((e: unknown) => toast(e instanceof Error ? e.message : '保存失败', 'info'))
      .finally(() => setSavingStyles(false))
  }

  const patchReplica = (p: Partial<ReplicaSettings>): void => {
    setReplica((r) => (r ? { ...r, ...p } : r))
  }

  return (
    <div>
      <div className="dw-page-head">
        <div className="dw-page-head-main">
          <h2 className="dw-page-title">系统设置</h2>
          <p className="dw-page-desc">配置保存在本地（userData/settings.json），所有视频代理、断点缓存与成片均在本地处理。</p>
        </div>
        <Button type="primary" loading={saving} onClick={save}>
          保存全部设置
        </Button>
      </div>

      <Form layout="vertical">
        <div className="dw-settings-grid">
          <div className="dw-panel">
            <div className="dw-panel-head">
              <span className="dw-panel-title">1. 全局视频理解模型（主链路）</span>
              <Tag color="blue" style={{ marginInlineEnd: 0 }}>必填</Tag>
            </div>
            <p className="dw-sub" style={{ marginTop: 0, marginBottom: 12 }}>
              负责一次性通读全剧视频分幕，提取一句话主线、人物关系、高光候选与句级台词。
            </p>
            <Space style={{ marginBottom: 12 }}>
              <Button
                size="small"
                onClick={() =>
                  setGlobal({ baseUrl: 'http://127.0.0.1:3425/v1', apiKey: 'magpie', model: 'wandapi/gemini-4-hydrogen' })
                }
              >
                预设：magpie 本地
              </Button>
              <Button
                size="small"
                onClick={() =>
                  setGlobal({
                    baseUrl: 'https://generativelanguage.googleapis.com',
                    apiKey: global.apiKey,
                    model: 'gemini-4-hydrogen'
                  })
                }
              >
                预设：Google 官方免费
              </Button>
            </Space>
            <ModelFields
              extra="Google 官方地址自动走原生接口，中转地址走 OpenAI 兼容接口。"
              value={global}
              onChange={setGlobal}
              options={GLOBAL_OPTIONS}
              urlPlaceholder="https://generativelanguage.googleapis.com"
            />
          </div>

          <div className="dw-panel">
            <div className="dw-panel-head">
              <span className="dw-panel-title">2. 剪辑大师编排模型（引流切条与文案）</span>
              <Tag style={{ marginInlineEnd: 0 }}>可选 · 留空自动复用主模型</Tag>
            </div>
            <p className="dw-sub" style={{ marginTop: 0, marginBottom: 12 }}>
              负责基于本地全剧缓存秒级编排引流切片、定向重剪与生成剪映花字/发布文案。留空时直接复用左侧全局模型。
            </p>
            <Space style={{ marginBottom: 12 }}>
              <Button size="small" onClick={() => setText(EMPTY)}>
                清空（直接复用全局模型）
              </Button>
            </Space>
            <ModelFields
              extra="留空则默认复用全局模型；也可单独配置推理更强的文本模型。"
              value={text}
              onChange={setText}
              options={TEXT_OPTIONS}
              urlPlaceholder="留空则自动复用全局模型"
            />
          </div>
        </div>
      </Form>

      {replica && (
        <div className="dw-panel" style={{ marginTop: 16 }}>
          <div className="dw-panel-head">
            <span className="dw-panel-title">3. 溯源重拼引擎（本地指纹溯源，无需模型/API）</span>
            <Space size={8} style={{ flex: 'none' }}>
              <Tag style={{ marginInlineEnd: 0 }}>本地引擎</Tag>
              <Button type="primary" size="small" loading={savingReplica} onClick={saveReplica}>
                保存重拼设置
              </Button>
            </Space>
          </div>

          <div className="dw-field-grid">
            <div className="dw-field">
              <span className="dw-field-label">索引抽帧率</span>
              <div className="dw-field-control">
                <Select
                  value={replica.indexFps}
                  onChange={(v) => patchReplica({ indexFps: v })}
                  options={[
                    { value: 8, label: '8fps · 快速' },
                    { value: 12, label: '12fps · 精准' },
                    { value: 24, label: '24fps · 极致' }
                  ]}
                />
              </div>
              <span className="dw-field-hint">推荐 12fps，越高越准越慢</span>
            </div>

            <div className="dw-field">
              <span className="dw-field-label">默认音轨</span>
              <div className="dw-field-control">
                <Select
                  value={replica.audio}
                  onChange={(v) => patchReplica({ audio: v })}
                  options={[
                    { value: 'source', label: '原剧集对白原声' },
                    { value: 'clip', label: '切片解说音' },
                    { value: 'none', label: '无声' }
                  ]}
                />
              </div>
              <span className="dw-field-hint">成片使用的音轨</span>
            </div>

            <div className="dw-field">
              <span className="dw-field-label">
                画质 CRF
                <ParamTip tip={CRF_TIP} />
              </span>
              <div className="dw-field-control">
                <InputNumber min={10} max={28} value={replica.crf} onChange={(v) => patchReplica({ crf: v ?? 16 })} />
              </div>
              <span className="dw-field-hint">越低越接近原画质</span>
            </div>

            <div className="dw-field">
              <span className="dw-field-label">计算线程</span>
              <div className="dw-field-control">
                <InputNumber min={1} max={8} value={replica.workers} onChange={(v) => patchReplica({ workers: v ?? 3 })} />
              </div>
              <span className="dw-field-hint">并行 worker 数</span>
            </div>

            <div className="dw-field">
              <span className="dw-field-label">顶部遮罩</span>
              <div className="dw-field-control">
                <InputNumber min={0} max={0.75} step={0.01} value={replica.maskTop} onChange={(v) => patchReplica({ maskTop: v ?? 0 })} />
              </div>
              <span className="dw-field-hint">台标/角标</span>
            </div>

            <div className="dw-field">
              <span className="dw-field-label">底部遮罩</span>
              <div className="dw-field-control">
                <InputNumber min={0} max={0.75} step={0.01} value={replica.maskBottom} onChange={(v) => patchReplica({ maskBottom: v ?? 0.25 })} />
              </div>
              <span className="dw-field-hint">字幕带</span>
            </div>

            <div className="dw-field">
              <span className="dw-field-label">中部字幕带</span>
              <div className="dw-field-control">
                <Input
                  value={replica.maskBand}
                  onChange={(e) => patchReplica({ maskBand: e.target.value })}
                  placeholder="留空则不遮罩"
                />
              </div>
              <span className="dw-field-hint">如 0.63,0.78（竖屏短剧常用）</span>
            </div>

            <div className="dw-field">
              <span className="dw-field-label">去量化平滑</span>
              <div className="dw-field-control">
                <Switch checked={replica.despike} onChange={(v) => patchReplica({ despike: v })} />
              </div>
              <span className="dw-field-hint">消除粗索引 0/2 抖动，碎段减半</span>
            </div>

            <div className="dw-field">
              <span className="dw-field-label">段边界精修</span>
              <div className="dw-field-control">
                <Switch checked={replica.refine} onChange={(v) => patchReplica({ refine: v })} />
              </div>
              <span className="dw-field-hint">±N 帧相关吸附到真实帧</span>
            </div>

            <div className="dw-field">
              <span className="dw-field-label">
                精修半径（帧）
                <ParamTip tip={RADIUS_TIP} />
              </span>
              <div className="dw-field-control">
                <InputNumber min={0} max={16} value={replica.boundsRadius} onChange={(v) => patchReplica({ boundsRadius: v ?? 6 })} />
              </div>
              <span className="dw-field-hint">仅精修开启时生效</span>
            </div>
          </div>
        </div>
      )}

      <div className="dw-panel" style={{ marginTop: 16 }}>
        <div className="dw-panel-head">
          <span className="dw-panel-title">4. 叙事基调风格配置（可选 · 支持自定义）</span>
          <Space size={8} style={{ flex: 'none' }}>
            <Button
              size="small"
              onClick={() => setStyles(DEFAULT_CUT_STYLES.map((s) => ({ ...s, roles: [...s.roles] })))}
            >
              恢复默认
            </Button>
            <Button
              size="small"
              icon={<IconPlus />}
              onClick={() =>
                setStyles((prev) => [
                  ...prev,
                  {
                    id: `custom-${Date.now().toString(36)}`,
                    name: '新风格',
                    desc: '自定义剪辑节奏与叙事侧重点',
                    defaultTarget: 60,
                    roles: ['钩子', '冲突', '高潮']
                  }
                ])
              }
            >
              新增风格
            </Button>
            <Button type="primary" size="small" loading={savingStyles} onClick={saveStyleList}>
              保存风格
            </Button>
          </Space>
        </div>
        <p className="dw-sub" style={{ marginTop: 0, marginBottom: 12 }}>
          在「AI 新剪成片」中可选择这里的预设风格，或直接选「AI 自动定调」。
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {styles.map((st, idx) => (
            <div
              key={st.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '130px 1fr 110px 180px 32px',
                gap: 8,
                alignItems: 'center'
              }}
            >
              <Input
                size="small"
                value={st.name}
                placeholder="风格名称"
                onChange={(e) =>
                  setStyles((prev) => prev.map((x, i) => (i === idx ? { ...x, name: e.target.value } : x)))
                }
              />
              <Input
                size="small"
                value={st.desc}
                placeholder="给 AI 的风格与节奏说明"
                onChange={(e) =>
                  setStyles((prev) => prev.map((x, i) => (i === idx ? { ...x, desc: e.target.value } : x)))
                }
              />
              <InputNumber
                size="small"
                min={0}
                max={600}
                addonAfter="秒"
                value={st.defaultTarget}
                title="默认目标时长（0 为不限）"
                onChange={(v) =>
                  setStyles((prev) =>
                    prev.map((x, i) => (i === idx ? { ...x, defaultTarget: v ?? 0 } : x))
                  )
                }
              />
              <Input
                size="small"
                value={st.roles.join(' / ')}
                placeholder="节拍：钩子 / 冲突 / 反转"
                onChange={(e) =>
                  setStyles((prev) =>
                    prev.map((x, i) =>
                      i === idx
                        ? {
                            ...x,
                            roles: e.target.value
                              .split(/[/,，→]+/)
                              .map((r) => r.trim())
                              .filter(Boolean)
                          }
                        : x
                    )
                  )
                }
              />
              <Button
                size="small"
                type="text"
                danger
                disabled={styles.length <= 1}
                icon={<IconTrash />}
                aria-label={`删除 ${st.name}`}
                onClick={() => setStyles((prev) => prev.filter((_, i) => i !== idx))}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
