# 短剧工作台 · UI 缺陷审计与现代 Web 优化计划

> 审计工具：`googlechrome/modern-web-guidance`（v1.0.0，已安装为本仓 devDependency，离线可用）
> 技术栈：Electron 33 + React 18 + Ant Design 5 + Zustand + electron-vite
> 审计面：`src/renderer`（App / Studio / Replica / Settings / Queue / panels / main / styles.css）
> 生成时间：2026-11-15

---

## 0. 怎么用这套工具（已落地）

`modern-web-guidance` 是 Google Chrome 团队的「现代 Web 最佳实践」检索技能，本地离线语义检索、零依赖、零 API Key。

```bash
# 已安装（写入 package.json devDependencies）
node node_modules/modern-web-guidance/skills/modern-web-guidance/modern-web.mjs --version   # 1.0.0

# 检索 → 取全文（两个子命令）
npx modern-web-guidance@latest search "dark mode toggle theme"
npx modern-web-guidance@latest retrieve "accessibility,dark-mode,forms"

# 旧写法扫描（本仓结果：0 条 legacy —— 上次 066d214 已现代化过 CSS）
npx modern-web-guidance@latest legacy-scan src/renderer
```

> 说明：本环境 `github.com` 解析到内网 IP，无法直连 GitHub；改用 npm 包方式安装，包内含完整 `README.md` 与 203 篇 use-case 指南，全部本地可读取。

本次已检索并全文研读的关键指南：
`accessibility`、`dark-mode`、`forms`、`responsive-table`、`persistent-toast-notifications`、`copy-button`、`icons`、`motion`、`progress`、`tabs`、`dialog`。

`legacy-scan` 报 **0 条**旧写法 —— 说明项目 CSS 已经是现代写法（`light-dark` 思路的变量、container query、`content-visibility`、`scrollbar-color`、`view-transition-name`、`text-wrap: balance` 都在用）。**所以真正的缺陷集中在「无障碍语义 + 主题一致性 + 组件 API 时效性」三类，而非 CSS 现代化。**

---

## 1. 缺陷清单（按严重度分级）

标记：🔴 必修 / 🟠 应修 / 🟡 建议

### A. 主题与首屏（dark mode 一致性）

| # | 级别 | 缺陷 | 证据 | 依据指南 |
|---|---|---|---|---|
| A1 | 🔴 | `<meta name="color-scheme">` 写死 `dark`，但应用支持 亮/暗/跟随系统 三态，切到亮色主题时浏览器原生 UI（滚动条、表单控件、初始画布）仍按暗色绘制，出现白闪/FOUC 与原生控件错色 | `src/renderer/index.html` `<meta name="color-scheme" content="dark" />` | `dark-mode` §1「MANDATORY: `<meta name="color-scheme" content="light dark">`」 |
| A2 | ✅ | 复核后确认：`styles.css` 的 `:root[data-theme='light']` **已有** `color-scheme: light`，运行时 `applyDomTheme()` 也会同步 `documentElement.style.colorScheme`。该项原本就正确，本次仅补注释说明 | `styles.css` L24-27、`store.ts` L27-34 | `dark-mode` §2 |
| A3 | 🟡 | 主题切换没有 `transition` 抑制，`startViewTransition` 与 `prefers-reduced-motion` 已处理（这点做得好），但 scrollbar `scrollbar-color` 在变量切换时会被浏览器重绘 —— macOS 需配合 `scrollbar-width` 才生效（项目已加，OK） | `styles.css` L460 等 | `dark-mode`「Do NOT animate scrollbar-color」 |

### B. 无障碍语义 / 键盘

| # | 级别 | 缺陷 | 证据 | 依据指南 |
|---|---|---|---|---|
| B1 | 🔴 | 三个「空状态」大图标用硬编码 `color: '#52525b'`（深灰），在**亮色主题**下与白色 `--bg-surface` 对比度不足、几乎不可见 | `Studio.tsx` L1120/L1262、`Replica.tsx` L616 | `icons`/`color`「图标与背景对比度 ≥ 3:1，亮暗两套都要测」 |
| B2 | 🔴 | 渲染中提示文字写死 `color: '#e4e4e7'`（浅色），在亮色主题的深色 `dw-player` 上 OK，但同一 `.dw-sub` 类在亮色面板里会继承深色，存在跨主题错色风险（半硬编码） | `Studio.tsx` L650、`Replica.tsx` L381 | `color`「不要用裸 hex，跟随设计 token」 |
| B3 | 🟠 | 大量 `<aside>/<section>` 有 `aria-label` 但缺 landmark 语义分工；全应用**没有 `<main>` 之外的 h1**，页面标题 `.dw-page-title` 是 `<h2>`，而页面顶部没有 `<h1>`（SPA 无 `document.title` 随路由更新） | `styles.css .dw-page-title`、各页面 `<h2>`；`main.tsx` 无 title 更新 | `accessibility` §1「每页一个 h1」「SPA 切换要更新 `<title>`」 |
| B4 | 🟠 | 分镜/时间轴/复刻 EDL 的「段落条」是纯 `div`（`Replica.tsx` L456 `<div className="dw-tl-seg" onClick>`) —— 可点击但非按钮、不可键盘聚焦、无 role。而 Studio 的同类条用的是 `<button>`（做得对），两处不一致 | `Replica.tsx` L452-468 | `accessibility` §2「可点击必须原生 `<button>`，禁止 `<div onClick>`」 |
| B5 | 🟠 | 多个图标按钮已补 `aria-label`（好），但 Tooltip 包裹的 `<QuestionCircleOutlined>`（`ParamTip`）图标本身无 `role="img"`/`aria-hidden`，读屏会忽略或读成空 | `paramTips.tsx` L41 | `icons`「装饰性 SVG 加 `aria-hidden`；信息性图标给 `role="img"`+`aria-label`」 |
| B6 | 🟡 | 焦点样式：`.dw-rail-btn/.dw-cut-item/.dw-tl-seg/.dw-play-overlay` 都有 `:focus-visible`（好）；但 `<video>`、`.dw-project-title-btn`、`.dw-clip-row` 的部分自定义按钮缺统一 `:focus-visible` | `styles.css` 多处 | `accessibility` §5「`:focus-visible` 统一，禁止裸 `outline:none`」（本仓无裸 outline:none，OK） |
| B7 | 🟡 | 播放/暂停、静音等图标按钮 `aria-label` 固定为「播放 / 暂停」不随状态变化，读屏无法得知当前是「正在播放」还是「已暂停」 | `Studio.tsx` L640/L686 | `accessibility`「toggle 用 `aria-pressed`/状态化 label」 |

### C. 数据表格（Responsive Table）

| # | 级别 | 缺陷 | 证据 | 依据指南 |
|---|---|---|---|---|
| C1 | 🟠 | 导入扫描表、复刻 EDL 表、剧本人物表都用 antd `<Table>` + `scroll={{y}}`，但**没有容器 `tabindex="0"` + `role="region"` + 可访问名**，键盘用户无法聚焦滚动区；NLE 三栏在窄容器（<780px）下表列会挤压 | `panels.tsx` L109、`Replica.tsx` L545、`Studio.tsx` L435 | `responsive-table`「wrapper 加 `tabindex=0 role=region aria-label`，container query 堆叠」 |

### D. 表单与输入（Forms）

| # | 级别 | 缺陷 | 证据 | 依据指南 |
|---|---|---|---|---|
| D1 | 🟠 | 导入弹窗的「素材目录」「短剧名称」用 antd `Form.Item label`（有 label，好），但 `title` 输入框的 `placeholder` 承担了主要提示、无 `aria-describedby` 关联扫描结果/约束 | `panels.tsx` L75-85 | `forms` §2「label 用 for/id，placeholder 不能当主标签」 |
| D2 | 🟡 | Settings 的 API Key `Input.Password` 已 `autoComplete="off"`（好），但缺「显示密码」`aria-pressed` 语义说明；Base URL 输入无 `type="url"`/`inputMode` | `Settings.tsx` L45-51 | `forms` §8「密码框可切换可见，URL 用合适 input type」 |
| D3 | 🟡 | 设置项大量旁置 `<span className="dw-sub">` 说明文字（如「越低越接近原画质」）未与对应 `InputNumber` 用 `aria-describedby` 关联，读屏聚焦控件时听不到说明 | `Settings.tsx` L212-244 | `forms` §2「hint 用 aria-describedby 关联」 |

### E. 反馈与组件 API 时效

| # | 级别 | 缺陷 | 证据 | 依据指南 |
|---|---|---|---|---|
| E1 | 🟠 | `toast()` 用 antd `message.open`（顶部浮层），在**打开 Modal/Drawer 时**弹出会被遮罩层盖住、读屏不易感知；且 `duration:3.5s` 自动消失，用户可能错过 | `store.ts` L62-64 | `persistent-toast-notifications`「不要在有 modal 时弹背景 toast；关键信息要有可检索的替代」 |
| E2 | 🟠 | `Tooltip overlayStyle` 是 antd 5 **已废弃** API（应用 `styles.root` 或 `styles={{ root: {...} }}`），后续大版本会移除；当前有运行时 warning 风险 | `paramTips.tsx` L40 | antd 5 迁移（组件时效性） |
| E3 | 🟡 | 复制按钮（花字标题/发布文案/日志）各自 `navigator.clipboard.writeText` + toast，无 `role="status"` 就地反馈、无失败降级（`execCommand`）、无 `navigator.clipboard` 缺失处理 | `Studio.tsx` L525、`Queue.tsx` L44 | `copy-button`「用 role=status 就地反馈；clipboard 缺失时降级」 |
| E4 | 🟡 | 进度展示：`.dw-log` 假进度/阶段文字混杂，`Progress` 缺 `aria-label`；「后台任务运行中(N)」pill 无 `aria-live` 播报 | `Queue.tsx` L89、`App.tsx` L137 | `progress`「determinate 进度要有可访问名」 |

### F. 布局/性能（多数已达标）

| # | 级别 | 说明 |
|---|---|---|
| F1 | ✅ | `content-visibility: auto` + `contain-intrinsic-size` 已用于长列表与日志 —— 符合 `defer-rendering-heavy-content` |
| F2 | ✅ | container query（`@container main-content`）、`interpolate-size`、`text-wrap: balance/pretty`、`prefers-reduced-motion`、`prefers-contrast` 均已实现 —— 现代化程度高 |
| F3 | 🟡 | `styles.css` 单文件 1076 行，缺 cascade layers（`@layer`）组织；design token 与组件样式混在一起，长期维护成本上升 |

---

## 2. 优化计划（分四批，按 ROI 排序）

### 🥇 批次一 · 主题一致性（最快见效，零风险，~30 min）
- [x] **A1** `index.html`：`<meta name="color-scheme" content="dark">` → `content="light dark"`（跟随系统默认；JS `applyDomTheme` 已在运行时把 `documentElement.style.colorScheme` 设成 resolved，二者协同，既消除首屏白闪又尊重用户主题）✅ 已在本次落地
- [x] **A2** 复核：`:root[data-theme='light']` 原本已声明 `color-scheme: light`，`applyDomTheme()` 亦同步 `style.colorScheme` —— 无需改动，仅补注释 ✅ 已核验
- [ ] **A3** scrollbar 已是规范写法，仅补注释说明 macOS 依赖 `scrollbar-width`（已满足）

### 🥈 批次二 · 无障碍硬伤（影响可用性/评审，~2–3 h）
- [x] **B1** 三个空状态图标 `#52525b` → `var(--text-muted)`，亮/暗主题自动适配 ✅ 已在本次落地
- [x] **B2** `#e4e4e7` 渲染提示 —— 播放器内是固定深色舞台，保留但改为注释说明「舞台内恒定深色」；其余 `.dw-sub` 已走 token ✅ 已核验
- [ ] **B3** 每页 `.dw-page-title` 升 `h1`（页面唯一主标题）；`store.goto/openDrama` 内 `document.title = 页面名` 随路由更新（`Studio`→剧名，`Queue`→任务队列，`Settings`→系统设置）
- [ ] **B4** `Replica.tsx` L456 段落条 `<div>`→`<button type="button" aria-label=...>`（对齐 Studio 的 `.dw-tl-seg` button 写法）
- [x] **B5** `ParamTip` 图标加 `role="img" aria-label="参数说明"` + 颜色改用 `var(--text-muted)` ✅ 已在本次落地
- [ ] **B7** 播放/静音按钮 `aria-label` 状态化：`{playing ? '暂停' : '播放'}`、`aria-pressed={muted}`

### 🥉 批次三 · 表格 / 表单 / 反馈（~3–4 h）
- [ ] **C1** 抽一个 `<ScrollRegion label>` 包裹 antd Table，补 `tabindex=0 role=region aria-label`；窄容器 container query 下切换为卡片式堆叠（复用已有 `@container main-content`）
- [ ] **D1/D3** 表单说明文字与控件 `aria-describedby` 关联（antd `Form.Item` 的 `extra` 已渲染为描述，确认其 id 关联），URL 输入加 `type="url" inputMode="url"`
- [ ] **E1** `toast()`：在 `Modal/Drawer` 打开时改走 `Modal` 内部 `role="status"` 提示或把 `getContainer` 提升到 modal 之上；关键失败信息同时落到 `Queue` 日志可回溯
- [x] **E2** `paramTips.tsx` `overlayStyle` → `styles={{ root: { maxWidth: 380 } }}` ✅ 已在本次落地
- [ ] **E3** 抽 `useCopy()`：`role="status"` 就地反馈 + `navigator.clipboard` 缺失降级 `execCommand` + 失败提示
- [ ] **E4** `Progress` 加 `aria-label="渲染进度"`；运行中 pill 加 `aria-live="polite"`

### 🏅 批次四 · 可维护性（可延后，~1 h）
- [ ] **F3** `styles.css` 拆 `@layer tokens, base, components, utilities`；把裸 hex 收进 `:root` token（把 B1/B2 之外剩余的 `#3b82f6`/`#a78bfa` 等角色色也 token 化）
- [ ] 引入 `@axe-core/react`（dev only）在开发态控制台打印无障碍问题，形成回归护栏

### G. 设置页布局（第二轮修复）

| # | 级别 | 缺陷 | 根因 | 依据指南 |
|---|---|---|---|---|
| G1 | 🔴 | 「3. 爆款复刻引擎」区块标签与控件错位：标签高低不齐、控件不在同一基线、说明文字挤在错误位置、「保存复刻设置」按钮悬浮在参数行中间 | `<Form.Item>` 被放进 `<Space wrap>`。antd `Space` 默认 `align="center"`，而各 `Form.Item` 高度不同（有的带 `extra`、有的不带），导致整块垂直居中 → 标签基线漂移。`Form.Item` 自带 `margin-bottom: 24px` 又叠加 `Space` 间距 | `forms` §2「label 与控件用固定栅格对齐，不要靠 inline 排列」 |
| G2 | 🟠 | 新建爆款弹窗「高级参数」、复刻工作区「重剪参数」同样是 `<span>标签 + InputNumber` 混排，换行后标签与控件相撞 | 同上：`Space wrap` + 文本节点混排，无栅格列 | 同上 |
| G3 | 🟠 | 「AI 新剪成片」弹窗的「生成条数 / 目标时长 / 画幅」行同样为内联混排 | 同上 | 同上 |

**修复方案**：新增 `.dw-field-grid` / `.dw-field` / `.dw-field-control` / `.dw-field-hint` 栅格体系，彻底替代 `Space + Form.Item`：

- 设置页 7 列（`repeat(7, minmax(0,1fr))`），标签、控件、提示各自成行对齐；
- `@container main-content` 在 ≤1180px 降为 4 列、≤780px 降为 2 列；
- 弹窗/侧栏用 `.is-compact`（`auto-fit minmax(128px,1fr)`）；
- 「保存复刻设置」移入面板标题栏右侧，与「本地引擎」标签并排，不再落在参数行里。

已在 1440px 宽（亮/暗）、1080px 宽、弹窗内三种场景截图核验：标签基线一致、控件等宽等高、提示文字不挤压。

---

## 3. 验收方式

1. `npm run typecheck` 通过（本次改动均为常量/属性级，不影响类型）。
2. 亮/暗/跟随系统三态手动切换：首屏无白闪、原生滚动条/表单控件颜色正确、空状态图标可见（对照 `dark-mode` §1/§2）。
3. 纯键盘走查（`accessibility` §13）：Tab 能到所有交互元素、焦点不丢失、时间轴段落条可 `Enter` 触发。
4. 读屏抽查（Narrator/Edge 或 VoiceOver）：播放按钮状态、参数说明、表格区域名可被读出。
5. `npx modern-web-guidance@latest legacy-scan src/renderer` 保持 0 legacy。

---

## 4. 本次已实际落地的修复（安全、增量、可回滚）

| 文件 | 改动 | 归因 |
|---|---|---|
| `src/renderer/index.html` | `color-scheme` 元标签 `dark` → `light dark` | A1 |
| `src/renderer/src/styles.css` | 亮色主题块补注释，明确 `color-scheme` 作用（属性原本已正确） | A2 |
| `src/renderer/src/modules/Studio.tsx` | 两处空状态图标 `#52525b` → `var(--text-muted)` | B1 |
| `src/renderer/src/modules/Replica.tsx` | 一处空状态图标 `#52525b` → `var(--text-muted)` | B1 |
| `src/renderer/src/paramTips.tsx` | `overlayStyle` → `styles={{ root: { maxWidth: 380 } }}`；图标补 `role="img" aria-label`、颜色改 token | E2 + B5 |
| `src/renderer/src/styles.css` | 新增 `.dw-field-grid` 栅格体系（含 `.is-compact` 与容器查询降级） | G1–G3 |
| `src/renderer/src/modules/Settings.tsx` | 第三区块由 `Space + Form.Item` 重写为 `.dw-field-grid`（10 个字段），保存按钮移入标题栏 | G1 |
| `src/renderer/src/modules/Replica.tsx` | 新建弹窗「高级参数」、工作区「重剪参数」改为紧凑栅格 | G2 |
| `src/renderer/src/modules/Studio.tsx` | 「AI 新剪成片」参数字段改为 3 列栅格 | G3 |

> 批次二～四为需要更多交互改动的项，已列明文件与行号，可按批推进；均已对照 modern-web-guidance 对应指南条目。

---

## 5. 第三轮：播放器与结构时间轴合并（已完成）

| # | 改动 | 落地 |
|---|---|---|
| H1 | 移除播放器右上角悬浮 `00:00` 时间码（`dw-ptime`），只保留下方控制条时间 | `Studio.tsx` / `Replica.tsx` |
| H2 | 移除播放器下方独立 antd `Slider`，把「成片结构时间轴 / 复刻结构时间轴」本身变成唯一 seek 面；播放指针贯穿色块 | `Studio.tsx` / `Replica.tsx` |
| H3 | 结构时间轴改用 MIT 开源组件 `@xzdarcy/react-timeline-editor`（刻度尺、游标拖拽、点击定位、虚拟化滚动），封装于 `TimelineScrubber.tsx` | `package.json`、`src/renderer/src/TimelineScrubber.tsx` |
| H4 | 全站时长统一 `mm:ss.d`（`fmtSec`），替换 `76.9s / 01:16 / 7s / 6.5s` 混用 | `library.ts` 及两个工作区 |
| H5 | 短色块角色标签（钩子/升级/反击）改为按块宽自适应显示，不再被固定 16% 阈值过滤 | `TimelineScrubber.tsx` + `.dw-timeline-pro` 样式 |

组件选型与三个参考仓库的取舍、第二轮审查修复（R1–R6）见 [`docs/timeline-integration.md`](timeline-integration.md)。
