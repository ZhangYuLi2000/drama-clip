import { useState } from 'react'
import type { ReactElement } from 'react'
import { Button, Card, Form, Input, Select } from 'antd'
import DirField from '../DirField'
import { toast } from '../store'

export default function Settings(): ReactElement {
  const [mediaDir, setMediaDir] = useState('E:\\drama_work\\media')
  const [cacheDir, setCacheDir] = useState('E:\\drama_work\\cache')
  return (
    <div>
      <div className="dw-page-head">
        <div>
          <h2 className="dw-page-title">设置</h2>
          <p className="dw-page-desc">模型、转写和目录。原型里保存只做提示，不会真的改配置。</p>
        </div>
      </div>
      <Card style={{ maxWidth: 720 }}>
        <Form layout="vertical">
          <div className="dw-sec-title">AI 模型</div>
          <Form.Item label="文本评分模型（A 路）">
            <Select
              defaultValue="qwen-flash"
              options={[
                { value: 'qwen-flash', label: 'qwen-flash（推荐，最便宜）' },
                { value: 'deepseek-v3', label: 'deepseek-v3' },
                { value: 'gemini-2.5-flash', label: 'gemini-2.5-flash' }
              ]}
            />
          </Form.Item>
          <Form.Item label="视频理解模型（B 路）">
            <Select
              defaultValue="qwen3-omni-flash"
              options={[
                { value: 'qwen3-omni-flash', label: 'qwen3-omni-flash（¥1.06/小时视频）' },
                { value: 'gemini-2.5-flash', label: 'gemini-2.5-flash' },
                { value: 'off', label: '关闭 B 路' }
              ]}
            />
          </Form.Item>
          <Form.Item label="API Key（OpenAI 兼容）">
            <Input.Password placeholder="sk-…" />
          </Form.Item>
          <Form.Item label="代理分辨率（喂给 B 路）">
            <Select
              defaultValue="720p"
              options={[
                { value: '720p', label: '720p（省 token）' },
                { value: '1080p', label: '1080p 原片' }
              ]}
            />
          </Form.Item>
          <div className="dw-sec-title" style={{ marginTop: 8 }}>
            语音转写
          </div>
          <Form.Item label="ASR 引擎">
            <Select
              defaultValue="bcut"
              options={[
                { value: 'bcut', label: 'bcut 免费（默认）' },
                { value: 'whisper', label: 'whisper.cpp 本地' }
              ]}
            />
          </Form.Item>
          <Form.Item label="失败自动降级">
            <Select
              defaultValue="on"
              options={[
                { value: 'on', label: '开启（bcut → whisper.cpp）' },
                { value: 'off', label: '关闭' }
              ]}
            />
          </Form.Item>
          <div className="dw-sec-title" style={{ marginTop: 8 }}>
            存储
          </div>
          <Form.Item label="素材目录（原文件不搬家）">
            <DirField value={mediaDir} onChange={setMediaDir} />
          </Form.Item>
          <Form.Item label="高光库 / 缓存目录">
            <DirField value={cacheDir} onChange={setCacheDir} />
          </Form.Item>
          <Button type="primary" onClick={() => toast('设置已保存（演示）')}>
            保存
          </Button>
        </Form>
      </Card>
    </div>
  )
}
