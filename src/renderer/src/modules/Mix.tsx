import type { ReactElement } from 'react'
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  CloseOutlined,
  DownloadOutlined,
  FolderOutlined,
  LeftOutlined,
  PlusOutlined,
  ReloadOutlined,
  ScissorOutlined,
  ThunderboltOutlined
} from '@ant-design/icons'
import { Button, Card, Empty, Input, Progress, Result, Segmented, Select, Space, Spin, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { MixStructure } from '../../../shared/types'
import { STRUCTURES } from '../../../shared/types'
import { findDrama, useHighlights, useLibrary } from '../library'
import { ROLE_COLOR, ROLE_WHY } from '../mock/data'
import { basketDurOf, useStore } from '../store'

const ROLE_HEX: Record<string, string> = {
  钩子: '#f5222d',
  铺垫: '#1677ff',
  升级: '#fa8c16',
  高潮: '#faad14',
  反转: '#722ed1',
  悬念: '#13c2c2'
}

function Basket(): ReactElement {
  const basket = useStore((s) => s.basket)
  const hls = useHighlights()
  const dramas = useLibrary((s) => s.dramas)
  const total = basketDurOf(hls, basket)
  const basketMove = useStore((s) => s.basketMove)
  const basketRemove = useStore((s) => s.basketRemove)
  const basketClear = useStore((s) => s.basketClear)
  if (basket.length === 0) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={
          <span>
            素材篮为空
            <br />
            <span className="dw-sub">去高光管理挑选，或点「智能选材」自动挑高分片段</span>
          </span>
        }
        style={{ margin: '8px 0' }}
      />
    )
  }
  return (
    <div>
      {basket.map((id, idx) => {
        const h = hls.find((x) => x.id === id)
        if (!h) return null
        const d = findDrama(dramas, h.dramaId)
        return (
          <div className="dw-basket-item" key={id}>
            <span className="dw-basket-idx">{idx + 1}</span>
            <span className="dw-basket-main">
              <span className="dw-basket-title">{h.title}</span>
              <span className="dw-basket-src">
                《{d?.title ?? '?'}》第 {h.ep} 集 · {h.dur.toFixed(1)}s · 评分 {h.score}
              </span>
            </span>
            <Space size={2}>
              <Button size="small" type="text" icon={<ArrowUpOutlined />} disabled={idx === 0} onClick={() => basketMove(idx, -1)} aria-label="上移" />
              <Button
                size="small"
                type="text"
                icon={<ArrowDownOutlined />}
                disabled={idx === basket.length - 1}
                onClick={() => basketMove(idx, 1)}
                aria-label="下移"
              />
              <Button size="small" type="text" icon={<CloseOutlined />} onClick={() => basketRemove(id)} aria-label="移除" />
            </Space>
          </div>
        )
      })}
      <div style={{ display: 'flex', alignItems: 'center', marginTop: 8 }}>
        <span className="dw-sub">共 {basket.length} 条 · 素材总时长 {total}s（编排时按角色上限裁剪）</span>
        <span className="dw-spacer" />
        <Button type="link" size="small" style={{ padding: 0 }} onClick={basketClear}>
          清空
        </Button>
      </div>
    </div>
  )
}

function MixOut(): ReactElement {
  const result = useStore((s) => s.mix.result)
  const target = useStore((s) => s.mix.target)
  const ratio = useStore((s) => s.mix.ratio)
  const dramas = useLibrary((s) => s.dramas)
  const openOutput = useLibrary((s) => s.openOutput)
  const clipMove = useStore((s) => s.clipMove)
  const clipRemove = useStore((s) => s.clipRemove)
  const mixReset = useStore((s) => s.mixReset)
  const render = useStore((s) => s.render)

  if (!result) {
    return (
      <Card>
        <Empty
          image={<ScissorOutlined style={{ fontSize: 36, color: '#c3c8d2' }} />}
          description={
            <span>
              先备好素材篮，再点「AI 编排叙事」
              <br />
              <span className="dw-sub">AI 按叙事策略给每条素材分配角色与时长，并给出选用理由</span>
            </span>
          }
          style={{ padding: '24px 0' }}
        />
      </Card>
    )
  }
  if (result.status === 'loading') {
    return (
      <Card>
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          <Spin />
          <div className="dw-sub" style={{ marginTop: 12 }}>
            AI 正在编排叙事结构…
          </div>
        </div>
      </Card>
    )
  }
  const total = Math.round(result.clips.reduce((n, c) => n + c.dur, 0) * 10) / 10
  if (result.status === 'done') {
    const res = ratio === '9:16' ? '1080×1920' : '1920×1080'
    return (
      <Card>
        <Result
          status="success"
          title="渲染完成"
          subTitle={result.output || '输出文件已生成'}
          extra={[
            <Button
              key="dir"
              icon={<FolderOutlined />}
              disabled={!result.output}
              onClick={() => result.output && openOutput(result.output)}
            >
              打开输出目录
            </Button>,
            <Button key="again" type="primary" icon={<PlusOutlined />} onClick={mixReset}>
              再剪一条
            </Button>
          ]}
        >
          <div className="dw-sub" style={{ textAlign: 'center' }}>
            时长 {total}s · {res} · H.264 · 帧精确切片拼接
          </div>
        </Result>
      </Card>
    )
  }
  return (
    <>
      <Card
        size="small"
        title={`编排结果 · ${result.clips.length} 条`}
        extra={
          <Space>
            <Tag color={total <= target ? 'success' : 'warning'}>
              总时长 {total}s / 目标 {target}s{total <= target ? ' ✓' : ` ⚠ 超出 ${(total - target).toFixed(1)}s`}
            </Tag>
            <Button size="small" icon={<ReloadOutlined />} onClick={mixReset}>
              重新编排
            </Button>
          </Space>
        }
      >
        {result.clips.map((c, idx) => (
          <div className="dw-clip" key={`${c.hl.id}-${idx}`}>
            <span className="dw-clip-order">{idx + 1}</span>
            <Tag color={ROLE_COLOR[c.role]}>{c.role}</Tag>
            <span className="dw-clip-main">
              <span className="dw-clip-title">
                {c.hl.title} · {c.dur.toFixed(1)}s
              </span>
              <span className="dw-clip-why">
                {c.why} · 来源《{findDrama(dramas, c.hl.dramaId)?.title ?? '?'}》第 {c.hl.ep} 集
              </span>
            </span>
            <Space size={2}>
              <Button size="small" type="text" icon={<ArrowUpOutlined />} disabled={idx === 0} onClick={() => clipMove(idx, -1)} aria-label="上移" />
              <Button
                size="small"
                type="text"
                icon={<ArrowDownOutlined />}
                disabled={idx === result.clips.length - 1}
                onClick={() => clipMove(idx, 1)}
                aria-label="下移"
              />
              <Button size="small" type="text" danger icon={<CloseOutlined />} onClick={() => clipRemove(idx)} aria-label="移除" />
            </Space>
          </div>
        ))}
      </Card>
      <Card size="small" title="时间轴预览" extra={<span className="dw-sub">视频轨宽度按时长占比</span>} style={{ marginTop: 16 }}>
        <div className="dw-mix-tl">
          {result.clips.map((c, i) => (
            <span key={i} className="dw-mix-clip" style={{ flex: c.dur, background: ROLE_HEX[c.role] ?? '#8a919f' }}>
              {c.role} · {c.dur.toFixed(0)}s
            </span>
          ))}
        </div>
      </Card>
      {result.status === 'ready' ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 }}>
          <Button type="primary" icon={<DownloadOutlined />} onClick={render}>
            渲染导出 MP4（FFmpeg）
          </Button>
          <span className="dw-sub">
            预计耗时 ~40s · {ratio === '9:16' ? '1080×1920' : '1920×1080'} · 帧精确切片拼接
          </span>
        </div>
      ) : (
        <Card style={{ marginTop: 16 }}>
          <div className="dw-field-label">渲染中 {result.pct}%</div>
          <Progress percent={result.pct} />
        </Card>
      )}
    </>
  )
}

function MixDetail(): ReactElement {
  const drama = useStore((s) => s.mix.drama)
  const structure = useStore((s) => s.mix.structure)
  const prompt = useStore((s) => s.mix.prompt)
  const target = useStore((s) => s.mix.target)
  const ratio = useStore((s) => s.mix.ratio)
  const basketN = useStore((s) => s.basket.length)
  const dramas = useLibrary((s) => s.dramas)
  const setMixDrama = useStore((s) => s.setMixDrama)
  const setMixStructure = useStore((s) => s.setMixStructure)
  const backMix = useStore((s) => s.backMix)
  const setMixPrompt = useStore((s) => s.setMixPrompt)
  const setMixTarget = useStore((s) => s.setMixTarget)
  const setMixRatio = useStore((s) => s.setMixRatio)
  const smartPick = useStore((s) => s.smartPick)
  const generate = useStore((s) => s.generate)
  const meta = STRUCTURES[structure]

  return (
    <div>
      <div className="dw-page-head">
        <Button icon={<LeftOutlined />} onClick={backMix}>
          返回任务列表
        </Button>
        <div>
          <h2 className="dw-page-title">{findDrama(dramas, drama)?.title ?? '智能混剪'}</h2>
          <p className="dw-page-desc">素材篮选材 → AI 叙事排序 → 时间轴微调 → FFmpeg 渲染出片</p>
        </div>
      </div>
      <div className="dw-mix-layout">
        <Card size="small" title="创作需求">
          <div className="dw-field-label">素材范围（AI 智能选材用）</div>
          <Select
            value={drama || undefined}
            onChange={setMixDrama}
            placeholder="选择短剧"
            style={{ width: '100%', marginBottom: 12 }}
            options={dramas.map((d) => ({ value: d.id, label: d.title }))}
          />
          <div className="dw-field-label">叙事结构</div>
          <Segmented
            value={structure}
            onChange={(v) => setMixStructure(v as MixStructure)}
            style={{ marginBottom: 4 }}
            options={(Object.keys(STRUCTURES) as MixStructure[]).map((k) => ({
              value: k,
              label: STRUCTURES[k].name
            }))}
          />
          <p className="dw-sub" style={{ marginTop: 0, marginBottom: 12 }}>
            {meta.desc}
          </p>
          <div className="dw-field-label">一句话描述想要的成片</div>
          <Input.TextArea rows={4} value={prompt} onChange={(e) => setMixPrompt(e.target.value)} style={{ marginBottom: 12 }} />
          <Space style={{ marginBottom: 12 }} wrap>
            <span className="dw-sub">目标时长</span>
            <Select
              value={target}
              onChange={setMixTarget}
              style={{ width: 100 }}
              options={[
                { value: 30, label: '30 秒' },
                { value: 60, label: '60 秒' },
                { value: 90, label: '90 秒' }
              ]}
            />
            <span className="dw-sub">画幅</span>
            <Select
              value={ratio}
              onChange={setMixRatio}
              style={{ width: 120 }}
              options={[
                { value: '9:16', label: '9:16 竖屏' },
                { value: '16:9', label: '16:9 横屏' }
              ]}
            />
          </Space>
          <div className="dw-field-label">素材篮（高光管理加入 · AI 按此顺序编排叙事）</div>
          <Basket />
          <div className="dw-mix-actions">
            <Button icon={<ThunderboltOutlined />} onClick={smartPick}>
              智能选材
            </Button>
            <Button type="primary" icon={<ScissorOutlined />} disabled={basketN === 0} onClick={generate}>
              AI 编排叙事
            </Button>
          </div>
        </Card>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          <Card size="small" title={`叙事策略 · ${meta.name}`} extra={<span className="dw-sub">每角色有时长上限</span>} styles={{ body: { padding: '6px 16px' } }}>
            {meta.roles.map((r) => (
              <div className="dw-role-row" key={r}>
                <Tag color={ROLE_COLOR[r]}>{r}</Tag>
                <span className="dw-role-why">{ROLE_WHY[r] ?? ''}</span>
                <span className="dw-role-cap">≤ {meta.caps[r] ?? 10}s</span>
              </div>
            ))}
          </Card>
          <MixOut />
        </div>
      </div>
    </div>
  )
}

interface MixTask {
  id: string
  title: string
  n: number
  dur: number
}

function MixTasks(): ReactElement {
  const q = useStore((s) => s.mix.q)
  const hls = useHighlights()
  const dramas = useLibrary((s) => s.dramas)
  const setMixQ = useStore((s) => s.setMixQ)
  const openMix = useStore((s) => s.openMix)
  const rows: MixTask[] = dramas
    .filter((d) => !q.trim() || d.title.includes(q.trim()))
    .map((d) => {
      const mine = hls.filter((h) => h.dramaId === d.id)
      return { id: d.id, title: d.title, n: mine.length, dur: mine.reduce((n, h) => n + h.dur, 0) }
    })
  const columns: ColumnsType<MixTask> = [
    { title: '短剧', dataIndex: 'title' },
    { title: '可用高光', width: 120, render: (_, r) => (r.n > 0 ? `${r.n} 条` : <span className="dw-sub">暂无</span>) },
    { title: '素材时长', width: 120, render: (_, r) => (r.n > 0 ? `${Math.round(r.dur)} 秒` : <span className="dw-sub">—</span>) },
    {
      title: '操作',
      width: 120,
      render: (_, r) => (
        <Button type="link" size="small" style={{ padding: 0 }} disabled={r.n === 0} onClick={() => openMix(r.id)}>
          进入混剪
        </Button>
      )
    }
  ]
  return (
    <div>
      <div className="dw-page-head">
        <div>
          <h2 className="dw-page-title">智能混剪</h2>
          <p className="dw-page-desc">选择一部短剧，再进入混剪处理。没有高光的剧不能开剪。</p>
        </div>
      </div>
      <Card styles={{ body: { padding: 16 } }}>
        <Input
          allowClear
          placeholder="搜索短剧名称"
          value={q}
          onChange={(e) => setMixQ(e.target.value)}
          style={{ width: 240, marginBottom: 12 }}
          aria-label="搜索短剧"
        />
        <Table
          rowKey="id"
          size="middle"
          columns={columns}
          dataSource={rows}
          pagination={false}
          locale={{
            emptyText: <Empty image={<ScissorOutlined style={{ fontSize: 32, color: '#c3c8d2' }} />} description="没有匹配的短剧" />
          }}
        />
      </Card>
    </div>
  )
}

export default function Mix(): ReactElement {
  const page = useStore((s) => s.mix.page)
  return page === 'detail' ? <MixDetail /> : <MixTasks />
}