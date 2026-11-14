import { useState } from 'react'
import type { ReactElement } from 'react'
import { PlusOutlined, SearchOutlined } from '@ant-design/icons'
import { Alert, Button, Drawer, Form, Input, Space, Switch, Table } from 'antd'
import type { ScanResult } from '../../shared/types'
import { fmtSize, useLibrary } from './library'
import { toast, useStore } from './store'
import DirField from './DirField'

export default function Panels(): ReactElement {
  const open = useStore((s) => s.importOpen)
  const setImportOpen = useStore((s) => s.setImportOpen)
  const openDrama = useStore((s) => s.openDrama)
  const scan = useLibrary((s) => s.scan)
  const importDrama = useLibrary((s) => s.importDrama)

  const [dir, setDir] = useState('')
  const [title, setTitle] = useState('')
  const [autoStart, setAutoStart] = useState(true)
  const [result, setResult] = useState<ScanResult | null>(null)
  const [scanning, setScanning] = useState(false)
  const [importing, setImporting] = useState(false)

  const close = (): void => {
    setImportOpen(false)
  }

  const changeDir = (next: string): void => {
    setDir(next)
    setResult(null)
  }

  const doScan = (): void => {
    if (!dir.trim()) {
      toast('请先选择素材目录', 'info')
      return
    }
    setScanning(true)
    scan(dir.trim())
      .then((r) => {
        setResult(r)
        setTitle((t) => t || r.title)
        if (r.matched === 0) toast('没有识别到带集数的视频文件（文件名需形如「第3集.mp4」）', 'info')
      })
      .catch((e: unknown) => toast(e instanceof Error ? e.message : '扫描失败', 'info'))
      .finally(() => setScanning(false))
  }

  const doImport = (): void => {
    if (!result) return
    setImporting(true)
    const finalTitle = title.trim() || result.title
    importDrama(result.dir, finalTitle, autoStart)
      .then((r) => {
        close()
        setResult(null)
        setDir('')
        setTitle('')
        toast(
          autoStart
            ? `已导入《${finalTitle}》${r.count} 集，已自动开始全局分析与 AI 智剪`
            : `已导入《${finalTitle}》${r.count} 集`
        )
        openDrama(r.dramaId)
      })
      .catch((e: unknown) => toast(e instanceof Error ? e.message : '导入失败', 'info'))
      .finally(() => setImporting(false))
  }

  const unmatched = result?.files.filter((f) => f.n === null) ?? []

  return (
    <Drawer title="导入短剧" placement="right" width={580} open={open} onClose={close}>
      <Form layout="vertical">
        <Form.Item label="素材目录（仅登记索引，原视频不搬家）">
          <DirField value={dir} onChange={changeDir} />
        </Form.Item>
        <Form.Item label="短剧名称">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="扫描后默认使用目录名，可修改"
            allowClear
          />
        </Form.Item>
        <Form.Item>
          <Space>
            <Switch checked={autoStart} onChange={setAutoStart} />
            <span>导入后自动启动全剧分析，并直接生成 2 条引流成片</span>
          </Space>
        </Form.Item>
      </Form>
      {result && (
        <>
          <Alert
            type={result.matched > 0 ? 'success' : 'warning'}
            showIcon
            style={{ marginBottom: 12 }}
            message={`扫描完成：识别 ${result.matched} 个剧集文件 · 共 ${fmtSize(result.totalSize)}${
              result.unmatched > 0 ? ` · ${result.unmatched} 个文件无法识别集数，将跳过` : ''
            }`}
          />
          {unmatched.length > 0 && (
            <p className="dw-sub" style={{ marginTop: 0 }}>
              跳过：{unmatched.map((f) => f.fileName).join('、')}
            </p>
          )}
          {result.matched > 0 && (
            <Table
              size="small"
              rowKey="file"
              style={{ marginBottom: 12 }}
              pagination={false}
              scroll={{ y: 240 }}
              dataSource={result.files.filter((f) => f.n !== null)}
              columns={[
                { title: '集数', dataIndex: 'n', width: 80, render: (n: number) => `第 ${n} 集` },
                { title: '文件名', dataIndex: 'fileName' },
                { title: '大小', dataIndex: 'size', width: 100, render: (v: number) => fmtSize(v) }
              ]}
            />
          )}
        </>
      )}
      <Space>
        <Button icon={<SearchOutlined />} loading={scanning} onClick={doScan}>
          扫描目录
        </Button>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          loading={importing}
          disabled={!result || result.matched === 0}
          onClick={doImport}
        >
          {autoStart ? '导入并自动智剪' : '仅导入项目'}
        </Button>
      </Space>
    </Drawer>
  )
}
