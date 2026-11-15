# 爆款复刻（Replica）

拿一条爆款切片（二创解说 / 轮播混剪 / 连续剪辑），逐帧溯源它出自本剧哪一集、哪一帧，
再用**原剧集素材**重剪出一条干净成片：原画幅、原生帧率、原声对白，无水印 / 无字幕 / 无镜像 / 无调色。

纯 TypeScript 实现（Electron 主进程 + worker_threads 计算池 + ffmpeg-static），
**运行时零 Python 依赖**。算法移植自已验证的 cliptrace Python 版，逐数值对齐（见下文门禁）。

## 用户入口

- 项目卡片「爆款复刻」按钮 / 剧详情「爆款复刻」页签 → 导入爆款视频 → 自动流水线
- 不依赖全局分析与 LLM：只要有剧集原文件即可复刻
- 成片输出到 `<剧目录>/复刻/<任务名>_<时间戳>/`（recut.mp4 + recut_edl.csv + frame_origins.csv + summary.json）
- 支持「仅重剪」：复用溯源表换音轨 / 画质 / 精修参数，分钟级 → 秒级发起
- 设置页「爆款复刻引擎」：索引精度 / 遮罩 / CRF / 去抖 / 精修 / 线程数

## 流水线

```
jobs.ts（串行队列 JobKind='replica'）
  └─ replica-engine.ts runReplicaTask
       ① indexing 0–35%   按剧建指纹索引（缓存于 userData/media-cache/replica-index/<dramaId>，
                          manifest 对比剧集路径集合 + indexFps 判脏重建）
       ② tracing 36–55%   framewise 逐帧最近邻溯源（frames 模式，抗镜像/字幕/裁切）
       ③ cutting 56–100%  buildEdl(despike) → 边界精修 → 每集一遍解码按段路由编码
                          → 原声切段 → concat -c copy 无损拼接
```

## 引擎模块（electron/main/replica/）

| 模块 | 职责 | 对应 Python 原版 |
|---|---|---|
| frames.ts | ffprobe 元信息（CFR 快路径 + VFR PTS 回退）、按帧号 select 解码、时码 | media.py |
| fingerprint.ts | 4×4 块 DCT 指纹、镜像变体、块权重、加权余弦 topk、高通 NCC 验证 | fingerprint.py |
| indexer.ts | 索引构建/加载（.dwidx 二进制 + manifest.json）、银行家舍入步长 | indexer.py |
| framewise.ts | 逐帧出处 + 置信分级（high/medium/low/none） | framewise.py |
| edl.ts | 溯源表 → EDL；despike 去量化（鲁棒直线拟合 + 单调钳制 + 集帧数上界） | rebuild.py（EDL 部分） |
| recut.ts | 管道路由重剪（背压帧读取器 + 段编码器）、边界精修、原声/拼接 | recut.py |
| worker.ts / worker-pool.ts | 纯计算 worker 与调度池（Transferable 零拷贝） | — |

主进程只做 FFmpeg IO 与调度；指纹/检索/NCC 在 worker 池计算。
构建：electron-vite main 多入口（index + replica-worker），见 electron.vite.config.ts。

## 关键语义

- **原生帧率**：输出取实际用到集的众数 fps（24fps 源出 24fps），不做 24→30 上采样，段内 1:1 无重复帧。
- **despike 只用于粗索引**：frame_map（帧精确）路径默认关闭 despike，保护 25→30 帧率转换的合法重复帧。
- **边界精修三重保守**：只平移不改段长（零音画漂移）；相对提升判定（margin 0.02）；已对齐段（base≥0.86）不动。
- **静帧 hold**：轮播切片的停留时长按切片节奏 hold 源帧；无出处段黑场 + 静音占位。
- 全部路径绝对化（规避相对路径 concat 坑）；终止杀 ffmpeg 子进程 + 销毁 worker 池；重启任务标 fail 可重试。

## 数值对齐门禁（黄金基准）

基准由开发期一次性导出（`scripts/replica-golden/export_golden.py`，仅开发机需要 Python），
提交于 `test/golden/replica/`。运行：

```powershell
npm run test:replica        # G1 指纹/权重/NCC + G2 检索（25 项）
npm run test:replica:g3     # G3 索引构建 + 86 集全量溯源对齐（首次建索引约 3 分钟，之后走缓存）
npm run test:replica:g45    # G4 EDL 逐段对齐 + G5 完整重剪渲染质量（约 4 分钟）
npm run smoke:replica       # 真实 Electron 主进程产品路径冒烟（需先 build + esbuild 打包编排层，见脚本头注）
```

已验证结果（86 集《被抓住的秘密》+ 两条真实爆款样本）：

| 门禁 | 结果 |
|---|---|
| G1 指纹/变体/权重/验证向量 | 余弦 1.000000，最大差 ≤1.8e-7 |
| G2 加权检索 | top1 384/384，距离差 ≤2.4e-7 |
| G3 全量溯源 | 集+源帧一致率 **100%（4418/4418）**，置信分级 100%，覆盖 98.37% |
| G4 EDL | despike 138 段 / no-despike 295 段，与 Python 逐字段一致 |
| G5a 样本 B（150s AI 轮播） | EDL 138/138 一致；24fps / 3281 帧 / 136.71s；动效统计与 Python 版**逐位一致**（frozen 445 / 顿挫签名 42） |
| G5b 样本 A（43s 连续剪辑） | 3 段边界逐帧吻合（含 E42 791→802 的 11 帧缺口），25fps / 43.28s |
| 性能 | 全量索引 193s（Python 148s 同量级）；150s 切片溯源 ~60s；重剪 ~214s |

## 已知边界 / 二期

- 连续剪辑走 frames 模式时段边界为 ±1~2 帧粗定位（despike+精修补偿）；**match 模式**（Hough/RANSAC/Viterbi
  帧精确时间轴，align.py 移植）为二期，届时 auto 模式按覆盖率回退。
- 混合帧率剧取众数 fps，少数派集会被重采样（UI 标注 fps）。
- 极静帧长镜头边界可能 ±1 帧抖动（与 Python 版一致的已知边界）。
- 索引精度默认 12fps（±1 帧）；8fps 更快但 ±1.5~2 帧。
