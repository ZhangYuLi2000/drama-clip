import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { Alert, AutoComplete, Button, Card, Form, Input, InputNumber, Select, Space, Switch } from 'antd'
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
  title,
  extra,
  value,
  onChange,
  options,
  urlPlaceholder
}: {
  title: string
  extra: string
  value: ModelCfg
  onChange: (v: ModelCfg) => void
  options: { value: string; label: string }[]
  urlPlaceholder: string
}): ReactElement {
  return (
    <>
      {title && <div className="dw-sec-title">{title}</div>}
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
      <Form.Item label="模型" extra="可自由输入模型名">
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
        <div>
          <h2 className="dw-page-title">设置</h2>
          <p className="dw-page-desc">配置保存在本地（userData/settings.json），所有视频与文案均在本地处理。</p>
        </div>
      </div>
      <Card style={{ maxWidth: 720 }}>
        <Form layout="vertical">
          <div className="dw-sec-title">全局视频理解模型（主链路）</div>
          <Space style={{ marginBottom: 8 }}>
            <Button
              size="small"
              onClick={() => setGlobal({ baseUrl: 'http://127.0.0.1:3425/v1', apiKey: 'magpie', model: 'wandapi/gemini-4-hydrogen' })}
            >
              预设：magpie 本地
            </Button>
            <Button
              size="small"
              onClick={() => setGlobal({ baseUrl: 'https://generativelanguage.googleapis.com', apiKey: global.apiKey, model: 'gemini-4-hydrogen' })}
            >
              预设：Google 官方免费
            </Button>
          </Space>
          <ModelFields
            title=""
            extra="自动分幕压缩整部短剧并识别剧情、人物、高光与句级台词（Google 官方走原生接口，中转走 OpenAI 兼容）。"
            value={global}
            onChange={setGlobal}
            options={GLOBAL_OPTIONS}
            urlPlaceholder="https://generativelanguage.googleapis.com"
          />

          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="剪辑编排文本模型（可选）"
            description="用于引流成片编排、定向重剪与文案生成。若下方留空，将自动复用上面的全局模型配置，无需重复填写 Key。"
          />
          <ModelFields
            title=""
            extra="留空则默认使用全局模型；也可单独配置文本推理更强的模型（如 qwen-max 等）。"
            value={text}
            onChange={setText}
            options={TEXT_OPTIONS}
            urlPlaceholder="留空则自动复用全局模型"
          />

          <Button type="primary" loading={saving} onClick={save}>
            保存设置
          </Button>
        </Form>
      </Card>

      {replica && (
        <Card title="爆款复刻引擎（本地溯源，无需模型/API）" style={{ maxWidth: 720, marginTop: 16 }}>
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
        </Card>
      )}
    </div>
  )
}
