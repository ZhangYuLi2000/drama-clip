import type { ReactElement, ReactNode } from 'react'
import { Card, Progress, Tag } from 'antd'
import { useStore } from '../store'

function JobRow(props: { name: string; tag: ReactNode; pct: number; note: string; color?: string }): ReactElement {
  return (
    <div className="dw-job">
      <span className="dw-job-name">{props.name}</span>
      {props.tag}
      <Progress percent={props.pct} size="small" showInfo={false} strokeColor={props.color} style={{ width: 180, margin: 0 }} />
      <span className="dw-job-pct">{props.note}</span>
    </div>
  )
}

export default function Queue(): ReactElement {
  const cost = useStore((s) => s.cost)
  const rendering = useStore((s) => s.mix.result?.status === 'rendering')
  const renderPct = useStore((s) => s.mix.result?.pct ?? 0)
  return (
    <div>
      <div className="dw-page-head">
        <div>
          <h2 className="dw-page-title">任务队列</h2>
          <p className="dw-page-desc">转写、分析和渲染都在这里看进度。演示数据是静态的，混剪渲染会跟着走。</p>
        </div>
      </div>
      <Card styles={{ body: { padding: '8px 16px 16px' } }}>
        <JobRow name="《闪婚总裁契约妻》第 5 集 · bcut 转写" tag={<Tag color="processing">运行中</Tag>} pct={62} note="62%" />
        <JobRow name="《闪婚总裁契约妻》第 6 集 · 视频理解" tag={<Tag>排队</Tag>} pct={0} note="等待转写完成" />
        <JobRow
          name="《闪婚总裁契约妻》第 7 集 · bcut 转写"
          tag={<Tag color="error">限流失败</Tag>}
          pct={35}
          note="已降级 whisper.cpp 重试"
          color="#f5222d"
        />
        <JobRow
          name="《闪婚总裁契约妻》第 4 集 · AI 台词评分"
          tag={<Tag color="success">完成</Tag>}
          pct={100}
          note="候选 10 · 成本 ¥0.01"
          color="#52c41a"
        />
        {rendering && (
          <JobRow name="混剪成片 · FFmpeg 渲染" tag={<Tag color="processing">渲染中</Tag>} pct={renderPct} note={`${renderPct}%`} />
        )}
        <p className="dw-sub" style={{ margin: '12px 0 0' }}>
          今日成本 ¥{cost.toFixed(2)} = 文本评分 ¥0.03 + 视频理解 ¥0.39
        </p>
      </Card>
    </div>
  )
}
