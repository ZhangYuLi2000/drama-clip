import { useState } from 'react'
import type { ReactElement } from 'react'
import { ClearOutlined, StopOutlined } from '@ant-design/icons'
import { Button, Card, Empty, Progress, Space, Tag } from 'antd'
import type { JobKind } from '../../../shared/types'
import { useLibrary } from '../library'
import { toast } from '../store'

const KIND_LABEL: Record<JobKind, string> = {
  probe: '元数据',
  thumb: '缩略图',
  shots: '镜头边界',
  global: '全局分幕分析',
  'generate-cut': 'AI 大师编排',
  'render-cut': '渲染成片'
}

function fmtTime(t: number): string {
  const d = new Date(t)
  const p = (x: number): string => String(x).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

export default function Queue(): ReactElement {
  const job = useLibrary((s) => s.job)
  const running = useLibrary((s) => s.running)
  const logs = useLibrary((s) => s.logs)
  const logStats = useLibrary((s) => s.logStats)
  const clearLogs = useLibrary((s) => s.clearLogs)
  const stopTasks = useLibrary((s) => s.stopTasks)
  const [errOnly, setErrOnly] = useState(false)

  const shown = (errOnly ? logs.filter((l) => l.level === 'error') : logs).slice().reverse()

  const doStop = (): void => {
    stopTasks()
      .then(({ cleared }) =>
        toast(cleared > 0 ? `已终止 ${cleared} 个任务` : '当前没有进行中的任务', cleared > 0 ? 'info' : 'success')
      )
      .catch((e: unknown) => toast(e instanceof Error ? e.message : '终止失败', 'info'))
  }

  return (
    <div>
      <div className="dw-page-head">
        <div>
          <h2 className="dw-page-title">任务队列</h2>
          <p className="dw-page-desc">实时查看媒体预处理、全局分幕分析、AI 编排与 FFmpeg 渲染日志（保留最近 500 条）。</p>
        </div>
        <span className="dw-spacer" />
        <Button danger icon={<StopOutlined />} disabled={running === 0 && !job} onClick={doStop}>
          终止全部任务
        </Button>
      </div>
      <Card
        size="small"
        title="当前任务"
        extra={
          (running > 0 || job) && (
            <Button size="small" danger type="link" icon={<StopOutlined />} onClick={doStop}>
              立即停止
            </Button>
          )
        }
        style={{ marginBottom: 16 }}
        styles={{ body: { padding: 16 } }}
      >
        {job ? (
          <Space direction="vertical" style={{ width: '100%' }} size={8}>
            <Space>
              <Tag color="processing">{KIND_LABEL[job.kind]}</Tag>
              <b>{job.label}</b>
              {running > 1 && <span className="dw-sub">后面还排着 {running - 1} 个</span>}
            </Space>
            <Progress percent={job.pct} size="small" />
          </Space>
        ) : (
          <Space>
            <span className="dw-sub">当前没有正在执行的任务</span>
            {running > 0 && <Tag>排队 {running}</Tag>}
            <span className="dw-sub">
              本次运行：完成 {logStats.done} · 失败 {logStats.failed}
            </span>
          </Space>
        )}
      </Card>
      <Card
        size="small"
        title="任务日志"
        extra={
          <Space>
            <Button size="small" type={errOnly ? 'primary' : 'default'} onClick={() => setErrOnly(!errOnly)}>
              只看错误
            </Button>
            <Button
              size="small"
              icon={<ClearOutlined />}
              onClick={() => {
                clearLogs()
                  .then(() => toast('日志已清空', 'info'))
                  .catch(() => toast('清空失败', 'info'))
              }}
            >
              清空
            </Button>
          </Space>
        }
        styles={{ body: { padding: '8px 16px 16px' } }}
      >
        {shown.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={errOnly ? '没有错误日志' : '还没有日志，导入短剧后这里会实时记录每一步'}
          />
        ) : (
          <div className="dw-log">
            {shown.map((l, i) => (
              <div key={`${l.t}-${i}`} className={`dw-log-line dw-log-${l.level}`}>
                <span className="dw-log-time">{fmtTime(l.t)}</span>
                <span className="dw-log-msg">{l.msg}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
