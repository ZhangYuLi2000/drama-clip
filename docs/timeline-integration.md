# 专业时间轴组件选型与融入记录

日期：2026-11-15

> **更新（2026-11-15 晚）**：封装层已按审阅原型重写为自绘磁吸轨道（段边界磁吸 + 激光线 +
> 吸附 tooltip、缩放横向滚动、半透明色块 + 顶色条 + 块内台词），不再以
> `@xzdarcy/react-timeline-editor` 为内核；本文保留为选型记录。

## 结论

`Studio / 成片结构时间轴` 与 `Replica / 复刻结构时间轴` 已统一改为复用
**`@xzdarcy/react-timeline-editor` 1.0.0（MIT）** 作为交互内核：

- 时间刻度尺、拖拽游标、点击时间区定位、虚拟化横向滚动由组件提供；
- 本项目只做一层紧凑型封装 `src/renderer/src/TimelineScrubber.tsx`：
  - `CutClip[]` / `ReplicaEdlRow[]` → 单行 `TimelineRow.actions`；
  - `getActionRender` 用角色色块 + 段名渲染（钩子 / 冲突 / 升级 / 反转 / 反击…）；
  - `onCursorDrag` / `onClickTimeArea` 直接 seek HTMLVideoElement；
  - 视频 `timeupdate` 通过 `TimelineState.setTime()` 回写游标，双向同步；
  - 外层 `role="slider"` + 方向键 / Home / End 键盘定位。

这样播放器下方不再出现「独立进度条 + 结构色块」两条割裂的进度轴：结构时间轴本身
就是唯一的 seek 面，播放指针直接贯穿在色块上。

## 三个参考仓库的取舍

| 仓库 | 许可 / 技术栈 | 处理方式 |
|---|---|---|
| [@xzdarcy/react-timeline-editor](https://github.com/xzdarcy/react-timeline-editor) | MIT，React >=18，组件化 | **直接集成**：锁定 `1.0.0`（封装依赖其内部网格/时间列语义，暂不随 minor 漂移）；作为 Studio / Replica 共用时间轴内核 |
| [Ektie/react-video-timeline-editor](https://github.com/Ektie/react-video-timeline-editor) | AGPL-3.0，完整 NLE（多轨、trim/split、undo、预览） | **交互参考**：借鉴游标贯穿、时间刻度、缩放/适配的产品形态；不整包嵌入（授权与整站编辑器耦合成本高） |
| [designcombo/react-video-editor-js](https://github.com/designcombo/react-video-editor-js) | React 19 + Remotion 4 的完整模板（含多包 workspace） | **布局参考**：三栏编辑器、左侧资产/节目单、底部时间轴控制条；不整仓合并（React 18/Electron 与 Remotion 4 栈不匹配） |

## 交付要点

1. 时间格式统一为 `mm:ss.d`（`src/renderer/src/library.ts` 的 `fmtSec`）：
   播放器、方案列表、分镜详情、Beat Sheet 胶囊、EDL 表格、复刻任务列表全部复用。
2. 播放器右上角悬浮时间码已移除（`dw-ptime`）。
3. 原 antd `Slider` 进度条已移除，仅保留播放/静音控制；结构时间轴即 seek 面。
4. 短色块标签：`getActionRender` 内部按块宽自适应省略，角色短标签（钩子/升级/反击）
   不再因固定百分比阈值而丢失；完整信息见 `title` 与下方片段清单。
5. 暗/亮主题通过 `.dw-timeline-pro` 的 CSS token 覆盖组件默认深色样式。

## 第二轮审查修复（2026-11-15 晚）

| # | 审查发现 | 修复 |
|---|---|---|
| R1 | Replica 切到「原爆款切片」或 EDL 未加载时，唯一进度条被移除后没有定位手段 | 单段 fallback 时间轴：`view==='clip'` 渲染「原爆款切片」单色块轴，EDL 缺失时同理；可拖拽/点击定位 |
| R2 | Studio 成片未渲染时点击色块，视频不动但「当前片段」详情不跟随 | `seekTimeline` 按 seek 值反查段索引并同步 `inspectedIdx`，可播放时同时 seek 视频 |
| R3 | Studio 每次 `timeupdate` 重建 7 段（Replica 113 段）`TimelineRow`，拖动/播放期间做无用功 | 时间轴元数据 `useMemo` 与播放状态分离，播放只移动游标不重建 action |
| R4 | 亮底角色色（升级/高潮/悬念）上的白字对比度不足 | `TimelineSegment.textColor` + `ROLE_TEXT` 深浅字自动切换，`is-dark-text` 去文字阴影 |
| R5 | `^1.0.0` 漂移风险：封装依赖 `startLeft` 网格列与 `getScaleRender` 列值语义 | 锁定精确版本 `1.0.0` |
| R6 | 刻度尺首尾标签越界、游标偏移 8px、色块/刻度不对齐 | `startLeft=40` 留白 + `scaleSplitCount=1` + `value-tick` 刻度平移 + 游标 `margin-left:-1px` 对中，DOM 实测逐项对齐 |
