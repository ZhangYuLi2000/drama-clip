import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { Alert, AutoComplete, Button, Card, Form, Input, Space } from 'antd'
import type { ModelCfg } from '../../../shared/types'
import { useLibrary } from '../library'
import { toast } from '../store'

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
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (settings) {
      setGlobal(settings.global)
      setText(settings.text)
    }
  }, [settings])

  const save = (): void => {
    setSaving(true)
    saveSettings({ global, text })
      .then(() => toast('设置已保存'))
      .catch((e: unknown) => toast(e instanceof Error ? e.message : '保存失败', 'info'))
      .finally(() => setSaving(false))
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
    </div>
  )
}
