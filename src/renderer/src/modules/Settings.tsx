import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { Alert, AutoComplete, Button, Card, Form, Input, Space } from 'antd'
import type { ModelCfg } from '../../../shared/types'
import { useLibrary } from '../library'
import { toast } from '../store'

const VIDEO_OPTIONS = [
  { value: 'glm-5.3-flash', label: 'glm-5.3-flash（推荐，原生视频+音频，智谱）' },
  { value: 'glm-5.3-flashx', label: 'glm-5.3-flashx（高速版）' },
  { value: 'qwen3-omni-flash', label: 'qwen3-omni-flash（视频+音频，百炼）' },
  { value: 'qwen3-vl-plus', label: 'qwen3-vl-plus（纯视觉，无音频）' }
]

const TEXT_OPTIONS = [
  { value: 'qwen-flash', label: 'qwen-flash（推荐，最便宜）' },
  { value: 'qwen-plus', label: 'qwen-plus' },
  { value: 'qwen-max', label: 'qwen-max' },
  { value: 'glm-5.3-flash', label: 'glm-5.3-flash（智谱）' }
]

const GLOBAL_OPTIONS = [
  { value: 'wandapi/gemini-4-hydrogen', label: 'wandapi/gemini-4-hydrogen（magpie 中转）' },
  { value: 'gemini-4-hydrogen', label: 'gemini-4-hydrogen（Google 官方，有免费档）' },
  { value: 'gemini-4-argon', label: 'gemini-4-argon（Google 官方，仅付费）' }
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
  const [video, setVideo] = useState<ModelCfg>(EMPTY)
  const [text, setText] = useState<ModelCfg>(EMPTY)
  const [global, setGlobal] = useState<ModelCfg>(EMPTY)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (settings) {
      setVideo(settings.video)
      setText(settings.text)
      setGlobal(settings.global)
    }
  }, [settings])

  const save = (): void => {
    setSaving(true)
    saveSettings({ video, text, global })
      .then(() => toast('设置已保存'))
      .catch((e: unknown) => toast(e instanceof Error ? e.message : '保存失败', 'info'))
      .finally(() => setSaving(false))
  }

  return (
    <div>
      <div className="dw-page-head">
        <div>
          <h2 className="dw-page-title">设置</h2>
          <p className="dw-page-desc">AI 服务配置保存在本机（userData/settings.json），不会上传。视觉与文本模型独立配置。</p>
        </div>
      </div>
      <Card style={{ maxWidth: 720 }}>
        <Form layout="vertical">
          <ModelFields
            title="视觉模型（逐集视频理解）"
            extra="默认智谱 GLM；视频压缩为 360p 代理、按 ≤140 秒分块发送，台词转写随片段一起提供"
            value={video}
            onChange={setVideo}
            options={VIDEO_OPTIONS}
            urlPlaceholder="https://open.bigmodel.cn/api/paas/v4"
          />
          <ModelFields
            title="文本模型（全剧统筹 + 混剪编排）"
            extra="默认阿里云百炼兼容模式；用于全剧人物/叙事统筹和混剪 EDL 编排，需单独配置 Key"
            value={text}
            onChange={setText}
            options={TEXT_OPTIONS}
            urlPlaceholder="https://dashscope.aliyuncs.com/compatible-mode/v1"
          />
          <div className="dw-sec-title">全局模型（全剧自动分幕）</div>
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
            extra="自动按 Base URL 选传输：Google 官方走原生接口（支持视频，免费档可用），中转走 OpenAI 兼容。整剧自动分幕，每幕一次调用产出剧本/人物/高光，跨幕自动合并。url/key/模型名自定义"
            value={global}
            onChange={setGlobal}
            options={GLOBAL_OPTIONS}
            urlPlaceholder="http://127.0.0.1:3425/v1"
          />
          <Button type="primary" loading={saving} onClick={save}>
            保存
          </Button>
          <div className="dw-sec-title" style={{ marginTop: 16 }}>
            语音转写
          </div>
          <Alert
            type="info"
            showIcon
            message="转写由视频理解模型一并完成"
            description="视频理解时模型顺带输出逐句转写（时间戳精度略低于专业 ASR）。bcut 免费转写已暂时下线，后续如需毫秒级句边界可恢复。whisper.cpp 本地降级暂未启用。"
          />
        </Form>
      </Card>
    </div>
  )
}