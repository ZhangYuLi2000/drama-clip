import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { AutoComplete, Button, Form, Input, InputNumber, Select, Space, Switch, Tag } from 'antd'
import type { ModelCfg, ReplicaSettings } from '../../../shared/types'
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
  const [saving, setSaving] = useState(false)
  const [savingReplica, setSavingReplica] = useState(false)

  useEffect(() => {
    if (settings) {
      setGlobal(settings.global)
      setText(settings.text)
      setReplica(settings.replica)
    }
  }, [settings])

  const save = (): void => {
    setSaving(true)
    saveSettings({ global, text })
      .then(() => toast('设置已保存'))
      .catch((e: unknown) => toast(e instanceof Error ? e.message : '保存失败', 'info'))
      .finally(() => setSaving(false))
  }

  const saveReplica = (): void => {
    if (!replica) return
    setSavingReplica(true)
    saveSettings({ replica })
      .then(() => toast('复刻引擎设置已保存'))
      .catch((e: unknown) => toast(e instanceof Error ? e.message : '保存失败', 'info'))
      .finally(() => setSavingReplica(false))
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
            <span className="dw-panel-title">3. 爆款复刻引擎（本地溯源，无需模型/API）</span>
            <Tag style={{ marginInlineEnd: 0 }}>本地引擎</Tag>
          </div>
          <Form layout="vertical">
            <Space wrap size={[16, 0]}>
              <Form.Item label="索引抽帧率" extra="越高越准，索引越大越慢">
                <Select
                  value={replica.indexFps}
                  onChange={(v) => patchReplica({ indexFps: v })}
                  style={{ width: 150 }}
                  options={[
                    { value: 8, label: '8fps · 快速' },
                    { value: 12, label: '12fps · 精准（推荐）' },
                    { value: 24, label: '24fps · 极致' }
                  ]}
                />
              </Form.Item>
              <Form.Item label="默认音轨">
                <Select
                  value={replica.audio}
                  onChange={(v) => patchReplica({ audio: v })}
                  style={{ width: 160 }}
                  options={[
                    { value: 'source', label: '原剧集对白原声' },
                    { value: 'clip', label: '切片解说音' },
                    { value: 'none', label: '无声' }
                  ]}
                />
              </Form.Item>
              <Form.Item label={<>画质 CRF<ParamTip tip={CRF_TIP} /></>} extra="越低越接近原画质">
                <InputNumber min={10} max={28} value={replica.crf} onChange={(v) => patchReplica({ crf: v ?? 16 })} />
              </Form.Item>
              <Form.Item label="计算线程">
                <InputNumber min={1} max={8} value={replica.workers} onChange={(v) => patchReplica({ workers: v ?? 3 })} />
              </Form.Item>
            </Space>
            <Space wrap size={[16, 0]}>
              <Form.Item label="顶部遮罩" extra="台标/角标">
                <InputNumber min={0} max={0.75} step={0.01} value={replica.maskTop} onChange={(v) => patchReplica({ maskTop: v ?? 0 })} />
              </Form.Item>
              <Form.Item label="底部遮罩" extra="字幕带">
                <InputNumber min={0} max={0.75} step={0.01} value={replica.maskBottom} onChange={(v) => patchReplica({ maskBottom: v ?? 0.25 })} />
              </Form.Item>
              <Form.Item label="中部字幕带" extra="如 0.63,0.78（竖屏短剧常用）">
                <Input
                  value={replica.maskBand}
                  onChange={(e) => patchReplica({ maskBand: e.target.value })}
                  placeholder="留空则不遮罩"
                  style={{ width: 160 }}
                />
              </Form.Item>
            </Space>
            <Space wrap size={[16, 0]}>
              <Form.Item label="去量化平滑" extra="消除粗索引 0/2 抖动，碎段减半">
                <Switch checked={replica.despike} onChange={(v) => patchReplica({ despike: v })} />
              </Form.Item>
              <Form.Item label="段边界精修" extra="±N 帧相关吸附到真实帧">
                <Switch checked={replica.refine} onChange={(v) => patchReplica({ refine: v })} />
              </Form.Item>
              <Form.Item label={<>精修半径（帧）<ParamTip tip={RADIUS_TIP} /></>}>
                <InputNumber min={0} max={16} value={replica.boundsRadius} onChange={(v) => patchReplica({ boundsRadius: v ?? 6 })} />
              </Form.Item>
            </Space>
            <Button type="primary" loading={savingReplica} onClick={saveReplica}>
              保存复刻设置
            </Button>
          </Form>
        </div>
      )}
    </div>
  )
}
