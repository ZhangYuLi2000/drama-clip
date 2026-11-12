import { useState } from 'react'
import type { ReactElement } from 'react'
import {
  CaretRightOutlined,
  CheckOutlined,
  PauseOutlined,
  PlusOutlined,
  SearchOutlined,
  UnorderedListOutlined
} from '@ant-design/icons'
import { Alert, Button, Drawer, Form, Progress, Space, Tag } from 'antd'
import { dramaById, fmt } from './mock/data'
import { toast, useStore } from './store'
import DirField from './DirField'

function ImportDrawer({ open, onClose }: { open: boolean; onClose: () => void }): ReactElement {
  const scanned = useStore((s) => s.scanned)
  const [dir, setDir] = useState('E:\\drama_work\\incoming\\闪婚总裁契约妻')
  return (
    <Drawer title="导入短剧" placement="right" width={560} open={open} onClose={onClose}>
      <Form layout="vertical">
        <Form.Item label="素材目录（仅登记索引，原文件不搬家）">
          <DirField value={dir} onChange={setDir} />
        </Form.Item>
      </Form>
      {scanned && (
        <Alert
          type="success"
          showIcon
          style={{ marginBottom: 12 }}
          message="扫描完成：识别 80 个视频文件 · 共 14.2 GB · 命名规则「第N集.mp4」 · 将生成缩略图 / 720p 代理 / 波形"
        />
      )}
      <Space>
        <Button icon={<SearchOutlined />} onClick={() => useStore.setState({ scanned: true })}>
          扫描目录
        </Button>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          disabled={!scanned}
          onClick={() => {
            onClose()
            toast('已导入《闪婚总裁契约妻》80 集，开始生成代理与缩略图（演示）')
          }}
        >
          开始导入
        </Button>
      </Space>
    </Drawer>
  )
}

function PreviewDrawer({ open, onClose }: { open: boolean; onClose: () => void }): ReactElement | null {
  const previewId = useStore((s) => s.previewId)
  const previewT = useStore((s) => s.previewT)
  const playing = useStore((s) => s.previewPlaying)
  const hls = useStore((s) => s.hls)
  const basket = useStore((s) => s.basket)
  const togglePreviewPlay = useStore((s) => s.togglePreviewPlay)
  const addToBasket = useStore((s) => s.addToBasket)
  const hlSource = useStore((s) => s.hlSource)
  const h = hls.find((x) => x.id === previewId)
  if (!h) return null
  const d = dramaById(h.d)
  const inBasket = basket.includes(h.id)
  return (
    <Drawer title="高光预览" placement="right" width={760} open={open} onClose={onClose}>
      <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 20, alignItems: 'start' }}>
        <div>
          <div className="dw-player" style={{ maxWidth: 260 }}>
            <span className="dw-scene">{h.scene}</span>
            <span className="dw-ptime">{h.dur.toFixed(1)}s</span>
            <button type="button" className="dw-play-overlay" onClick={togglePreviewPlay} aria-label="播放 / 暂停">
              {playing ? <PauseOutlined /> : <CaretRightOutlined />}
            </button>
          </div>
          <Progress percent={Math.round((previewT / h.dur) * 100)} showInfo={false} style={{ marginTop: 8 }} />
          <span className="dw-sub" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {fmt(previewT)} / {fmt(h.dur)}
          </span>
        </div>
        <div>
          <p style={{ fontWeight: 500, marginTop: 0 }}>{h.title}</p>
          <p className="dw-sub">
            《{d.title}》第 {h.ep} 集 · 评分 {h.score} · 时长 {h.dur.toFixed(1)}s
          </p>
          <Space size={4} wrap style={{ marginBottom: 8 }}>
            {h.tags.map((t) => (
              <Tag key={t}>{t}</Tag>
            ))}
          </Space>
          <p className="dw-sub">切片文件：cache\clips\{h.id}.mp4（帧精确重编码）</p>
          <Space>
            <Button type="primary" icon={inBasket ? <CheckOutlined /> : <PlusOutlined />} disabled={inBasket} onClick={() => addToBasket(h.id)}>
              {inBasket ? '已在素材篮' : '加入混剪'}
            </Button>
            <Button icon={<UnorderedListOutlined />} onClick={() => hlSource(h.id)}>
              定位来源剧集
            </Button>
          </Space>
        </div>
      </div>
    </Drawer>
  )
}

export default function Panels(): ReactElement {
  const panel = useStore((s) => s.panel)
  const closePanel = useStore((s) => s.closePanel)
  return (
    <>
      <ImportDrawer open={panel === 'import'} onClose={closePanel} />
      <PreviewDrawer open={panel === 'preview'} onClose={closePanel} />
    </>
  )
}