import type { CSSProperties, ReactElement } from 'react'
import { QuestionCircleOutlined } from '@ant-design/icons'
import { Tooltip } from 'antd'

const listStyle: CSSProperties = { margin: '4px 0', paddingLeft: 16 }
const pStyle: CSSProperties = { margin: '4px 0' }

export const CRF_TIP: ReactElement = (
  <div>
    <b>CRF · 重编码画质（10–28，越低越清晰）</b>
    <p style={pStyle}>每段从原片切出时重编码一次，CRF 控制这次编码的画质；段与段之间是无损拼接，不叠加损失。</p>
    <ul style={listStyle}>
      <li>调低 10–14：更接近原画质，文件更大，适合存档</li>
      <li>16（默认）：肉眼接近无损、体积适中，推荐</li>
      <li>调高 18–22：文件明显更小，画质轻微下降，适合批量投流</li>
      <li>24 以上：压缩痕迹可见，一般不建议</li>
    </ul>
  </div>
)

export const RADIUS_TIP: ReactElement = (
  <div>
    <b>精修半径 · 边界吸附搜索范围（单位：帧）</b>
    <p style={pStyle}>
      溯源给出的段边界有 ±1~2 帧粗定位误差。精修在边界 ±N 帧内做画面相关搜索，把整段平移到与原片最匹配的帧位置。
    </p>
    <ul style={listStyle}>
      <li>调大 8–12：能纠正更大偏移，但候选帧解码更多、更慢</li>
      <li>6（默认）：精度与速度平衡，推荐 4–8</li>
      <li>调小 2–4：更快，只纠小偏移</li>
      <li>0：不做边界精修</li>
    </ul>
    <p style={pStyle}>只平移、不改段长，零音画漂移；仅在置信度足够时移动，本来已对齐的段不会动。</p>
  </div>
)

/** 参数旁的小问号图标，悬停显示调参说明。 */
export function ParamTip({ tip }: { tip: ReactElement }): ReactElement {
  return (
    <Tooltip title={tip} styles={{ root: { maxWidth: 380 } }}>
      <QuestionCircleOutlined role="img" aria-label="参数说明" style={{ marginLeft: 4, color: 'var(--text-muted)', cursor: 'help' }} />
    </Tooltip>
  )
}
