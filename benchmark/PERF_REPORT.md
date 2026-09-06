# manga-image-translator 性能测试与优化报告

日期：2026-09-06 ｜ 分支：本地工作区（无基线提交）

## 1. 执行摘要

在 RTX 3080 (10GB) + torch 2.12.1+cu132 环境下，用 `result/` 真实工作负载（5 张 3D 英文漫画页）建立分阶段 benchmark，定位并修复了 3 处代码级问题、实验了 5 个配置变体：

| 口径 | baseline | 优化后 | 变化 |
|---|---|---|---|
| **本地推理阶段合计** | 1.923 s/图 | **1.234 s/图** | **-35.8%** |
| **端到端（含在线翻译 API）** | 2.486 s/图 | **1.815 s/图** | **-27.0%** |
| 吞吐 | 0.40 img/s | 0.55 img/s | +38% |

主要收益来源（按贡献排序）：
1. **`force_simple_sort=true`**：merge 阶段从 0.494s → 0.002s（-99.6%）。该阶段 99% 耗时在 panel 检测排序（LSD 直线检测 + 面板递归分割），而非文本合并本身。
2. **`detection_size` 2048→1536**：detection 0.210 → 0.151s（-28%），并连带降低 mask_refinement。
3. **`inpainting_size` 2048→1536**：inpainting 0.342 → 0.218s（-36%）。
4. 渲染 warp 局部化（代码修复）：每 region 3.65ms → 0.37ms（**10 倍**），多 region 漫画页收益显著。

## 2. 环境与方法

- 环境：Windows 10.0.26100 / Python 3.11.9 / torch 2.12.1+cu132 / NVIDIA GeForce RTX 3080 10GB（驱动 616.56）
- 配置：根目录 `config.json`（detector default@2048、OCR 48px、inpainter lama_large@2048 bf16、translator custom_openai→HY 模型）
- 输入：`benchmark/input/` 5 张 1920×1080 漫画页（来自 result/ 历史输入，每页 1-4 个文本块，代表当前真实负载；若换成日漫多气泡页，OCR/rendering 占比会上升）
- 方法：`devscripts/benchmark.py` 通过 monkey-patch 包裹 9 个 `_run_*` 阶段方法逐阶段计时；预热 1 轮（吸收模型加载+CUDA 初始化），正式计时 2 轮取均值；cProfile 定位函数级热点。
- 模型全部已在 `models/`（3.8GB），测试零下载。

### 注意：B1（translator=none）口径失真

诊断发现 `translator=none` 时翻译返回空 queries → `error-translating` → regions 被清空 → **inpainting/rendering 实际不执行**。因此纯本端口径下这两个阶段的数据不可用，配置矩阵统一采用 B0（custom_openai 端到端）口径、对比时剔除 translation（网络波动 ±0.3s 属正常，用中位数可比）。

## 3. Baseline 阶段占比（每图，s）

| 阶段 | 耗时 | 占本地比 | 说明 |
|---|---|---|---|
| OCR | 0.735 | 38.2% | `infer_beam_batch_tensor` beam search (k=5) GPU 推理 |
| textline_merge | 0.494 | 25.7% | **99% 在 panel 检测排序**（LSD+递归分割），文本合并仅 ~2ms |
| inpainting | 0.342 | 17.8% | lama_large bf16 autocast @2048 |
| detection | 0.210 | 10.9% | DBNet-resnet34 @2048 |
| mask_refinement | 0.118 | 6.1% | bilateralFilter + CRF |
| rendering | 0.023 | 1.2% | 当前负载 region 少；每 region 全图 warp 为隐患 |
| **本地合计** | **1.923** | | 端到端 2.486（translation API 0.345） |

cProfile 补充热点：`torch.conv2d` 4.3s（GPU 正常推理）；`panel.py:_cached_split` 3.3s + `cv2.LineSegmentDetector.detect` 1.3s（panel 排序，纯 CPU）；`bilateralFilter` 1.4s；GPU→CPU 搬运 `Tensor.cpu` 1.47s（30 次大块搬运）+ `Tensor.to` 1.29s（16685 次小搬运，OCR 内部）。

## 4. P0 代码修改（已落地，pytest 12 passed）

### 4.1 渲染 warp 局部化 — `manga_translator/rendering/__init__.py` `render()`

原实现每个文本 region 对**整图尺寸**做 `warpPerspective`（1920×1080 输出）再裁剪。现改为先算 dst boundingRect、平移单应矩阵后只 warp 局部矩形。
验证：局部 warp 与全图 warp 输出**逐像素 max diff = 0**；微基准 **3.65 → 0.37 ms/region（10×）**。当前低密度负载省 3-11ms/页；日漫 20-40 region/页场景每页可省 0.13-0.29s。另顺带修复了 dst 越界时负索引绕回的隐患（显式交集裁剪）。

### 4.2 离线翻译器不再逐图卸载 — `manga_translator/translators/__init__.py` `dispatch()`

删除 `chain.target_lang` 分支每次翻译后的 `translator.unload(device)`（顺带删除死代码 `pass`）。原行为下 sugoi/m2m100 等离线模型**每张图都重载**；现与另一分支（无 target_lang 路径）行为一致，模型常驻、由 `models_ttl` TTL 机制兜底内存。对当前 custom_openai（在线 API）负载无影响，收益适用于离线翻译器批量场景。

### 4.3 skip_lang 双重 merge 修复 — `manga_translator/manga_translator.py` `_run_textline_merge`

原代码 textline merge 无条件跑**两次**（第一次结果仅用于设 `text_raw` 后即丢弃，且 skip_lang 启用时逐行 `langid.classify` 后再 merge 一次）。改为**先过滤后 merge 一次**，`text_raw` 在最终 regions 上设置——同时修复了正常路径下 `text_raw` 属性丢失的功能 bug（该属性被渲染扩框和跨页上下文依赖）。当前负载 skip_lang=null，属顺带修复 + 消除一次全量 merge。

## 5. 配置矩阵（每图均值，s；B0 口径）

| 变体 | det | ocr | merge | trans | mask | inpaint | render | 本地合计 | 端到端 |
|---|---|---|---|---|---|---|---|---|---|
| baseline | 0.210 | 0.735 | 0.494 | 0.345 | 0.118 | 0.342 | 0.023 | 1.923 | 2.486 |
| P0 修改后 | 0.207 | 0.777 | 0.518 | 0.902* | 0.129 | 0.296 | 0.022 | 1.949 | 3.070* |
| detection_size=1536 | 0.141 | 0.629 | 0.450 | 0.301 | 0.090 | 0.307 | 0.020 | 1.638 | 2.142 |
| detection_size=1024 | 0.116 | 0.652 | 0.464 | 0.299 | 0.069 | 0.353 | 0.039 | 1.693 | 2.051 |
| inpainting_size=1536 | 0.185 | 0.631 | 0.459 | 0.605* | 0.119 | 0.257 | 0.023 | 1.675 | 2.482 |
| **force_simple_sort** | 0.178 | 0.744 | **0.002** | 0.334 | 0.119 | 0.277 | 0.018 | 1.338 | 1.871 |
| disable_memory_opt | 0.190 | 0.729 | 0.501 | 0.883* | 0.132 | 0.304 | 0.023 | 1.879 | 2.975* |
| **组合（det1536+ss+inp1536）** | 0.151 | 0.745 | **0.002** | 0.367 | 0.096 | **0.218** | 0.021 | **1.234** | **1.815** |

\* translation 阶段为在线 API，均值受偶发超时/重试影响（median 稳定在 ~0.31s），端到端对比请以本地合计为主。

- `--disable-memory-optimization` 无显著收益（10GB 显存下 gc/empty_cache 开销可忽略），不建议开。
- `detection_size=1024` 更快但检测分辨率减半，小字/密集气泡可能漏检；**1536 是速度-质量更稳的折中**。**质量是否可接受需人工抽查输出图**（本报告只测速度）。

### 推荐配置（config.json 修改）

```json
"detector": { "detection_size": 1536 },
"inpainter": { "inpainting_size": 1536 },
"force_simple_sort": true
```

`force_simple_sort` 放弃基于 panel 结构的阅读顺序排序（改用简单几何排序）。当前低密度负载无差别；多面板漫画页的阅读顺序可能受影响，如在意排序质量可只采用另外两项。

## 6. 未实施建议（P2，按预期收益排序）

1. **OCR beam search 优化**（现最大头，0.75s/图）：`infer_beam_batch_tensor` 内 1668 次/图的小块 `.to()` 搬运与逐批循环；beam k=5 可试 3，或整批拼 tensor 一次上卡。改动涉及识别正确性，需回归验证。
2. **panel 排序降本**：若不想用 simple_sort，可让 LSD 在降采样图（如 1/2）上跑，或缓存 panel 结果。预期省 ~0.4s/图。
3. **逐字符 freetype 渲染 + 描边**（`text_render.py`）：`put_char_*` 每字符 freetype 转换 + stroker；描边可预渲染一次复用。日漫长文本场景收益大。
4. **detection/OCR fp16**：目前仅 lama 支持 autocast；detection（DBNet）与 OCR（48px）可开 fp16，预期 detection 再省 30-40%。
5. **`translate_batch` 批翻译**：多图合并一次 API 调用已实现（`--batch-size`），吞吐可再升，未纳入本轮测试。
6. **结果缓存**：同一图片（md5 相同）重复处理时可直接复用检测结果（工作区存在大量重复输入的处理记录）。

## 7. 复现

```bash
# 分阶段 benchmark（B0 端到端）
python devscripts/benchmark.py --input-dir benchmark/input --config-file config.json \
    --warmup 1 --count 2 --output benchmark/results/xxx.json
# 变体：--detection-size 1536 --inpainting-size 1536 --simple-sort --no-translator
# 单图逐阶段数据流诊断
python devscripts/debug_pipeline.py benchmark/input/page02.png none
# 渲染 warp 微基准
python devscripts/bench_render.py
```

原始数据：`benchmark/results/*.json`（含每轮每图耗时与各阶段原始样本）。

---

# 批量整体优化（start.txt 工作流，2026-09-06）

目标：`python -m manga_translator local -v -i <整话目录> --config-file ./config.json --use-gpu`。
真实负载：233 页 1920x1080 JPG（`F:\jian\picture\...Chapter 6 (Comic)`），校准子集为其前 10 页
（`benchmark/real_input/`，含 API 端到端）。所有数值为该 10 页子集实测。

## 10 页子集校准（优化前代码）

| 变体 | 总时长 | s/页 | 说明 |
|---|---|---|---|
| V1 现状 config + `-v` | 30.7s | 3.07 | start.txt 原样行为 |
| V2 现状 config 无 `-v` | 27.4s | 2.74 | `-v` 调试写出成本 = 0.33 s/页（8 张调试 PNG/页） |
| V3 det/inp 1536 | 24.7s | 2.47 | 配置层收益 0.27 s/页 |

## 代码优化（git 提交 593dbda..8c1fd96）

| 改动 | 效果 | 验证 |
|---|---|---|
| XPOS 位置编码缓存 + beam_k 配置化 (593dbda) | OCR 阶段 0.629 -> 0.389 s/图（-38%） | `devscripts/ocr_regression.py` 位级一致（token/张量 md5 全同） |
| get_image_md5 原始字节哈希 (5ab149e) | 每页省一次全图 PNG 编码（数十 ms） | 语义不变，仅调试目录名变化 |
| batch 后 force_cleanup 受 --disable-memory-optimization 门控 (b5735d5) | batch 模式从净亏损转为盈利（见下） | V4/V5/V6 对照 |
| panel_sort_downscale 配置 (5686901) | sort 阶段 225-436ms -> 62-291ms | A/B 见下 |
| adaptive_bg_color 渲染描边取实景色 (8c1fd96) | 消除黑/白描边块（见下） | bg_ab.py 裁剪目视 + 数值 |

## 排序 A/B（6 页实测，devscripts/sort_ab.py）

panel 全分辨率 / panel 降采样 2x / simple_sort 三种策略在全部含字页（003/004/005/006）
**输出顺序完全一致**（本作为单场景 3D 漫画，分格结构弱）。sort 阶段耗时：
panel_full 220-436ms → down2 62-291ms → simple 0ms。
结论：本作采用 `force_simple_sort: true`；若以后翻译分格密集的日漫，改
`force_simple_sort: false` + `panel_sort_downscale: 2`（保分格阅读顺序，速度损失约 0.1-0.2 s/页）。

## batch-size 8（翻译请求 233 次 -> ~30 次）

| 变体 | s/页 | 说明 |
|---|---|---|
| V4 batch8（修复前） | 2.86 | 每批 force_cleanup 拖累 |
| V5 batch8+禁内存优化（修复前） | 2.69 | force_cleanup 仍无条件执行 |
| V6 batch8+禁内存优化（b5735d5 后） | 2.05 | 反超不批的 2.47 |

注：HY 接口限速 40 req/min（1.5s 间隔地板），单页请求模式下优化速度一旦低于
1.5 s/页就会被限速卡住；batch 8 把地板摊薄到 ~0.19 s/页，是后续继续提速的前提。

## 渲染黑/白描边块修复（adaptive_bg_color）

实测 page 004 两个 region 的 OCR bg 检测全部判反：深蓝底上判纯白（旧逻辑→白块）、
浅灰底上判纯黑（旧逻辑→黑块）。新方案（RenderConfig.adaptive_bg_color，默认开）
从修复补全后的图上直接取文字多边形下像素的中位数作描边色，与背景一致；
仅当文字色与背景过近时退回黑白保可读性。采样与绘制同图，色彩空间天然一致。

## 最终配置与端到端验证

config.json：`detection_size: 1536` + `inpainting_size: 1536` + `force_simple_sort: true` +
`render.adaptive_bg_color: true`；命令：`--batch-size 8 --disable-memory-optimization`（无 `-v`）。

| 轮次 | 总时长 | s/页 |
|---|---|---|
| V7 | 16.9s | 1.69 |
| V8 | 17.3s | 1.73 |

两轮方差 2.3%（<10% 达标），10 页输出完整、翻译正常。**相对 start.txt 原样 3.07 s/页 = -44%；
233 页外推 ≈ 6.6 分钟（原 ≈ 11.9 分钟）**。若保留 `-v` 需 +0.33 s/页（233 页 +77s）并额外写
~1900 张调试图。

## 回归

pytest：15 passed / 2 failed——均为环境问题（Baidu 密钥 54001、GitHub 下载 m2m100 返回 403），
与改动无关；test_render 通过。OCR 输出与优化前位级一致，三轮端到端日志中 OCR 概率值完全一致。

## 后续可选项（未实施）

- OCR beam_k=3（config 现成开关）：预计再省 ~0.1-0.15 s/页，需抽查识别质量。
- det/OCR fp16：detection 0.13s 还有 ~30% 空间。
- 233 页全量跑前建议先空跑 `--save-text` 抽查排序与译文质量（本次验证止于 10 页子集）。

## 补充：残留白/黑块的根因与修复（harmonize_fill_color, 219d636）

`adaptive_bg_color` 上线后用户仍报告突兀白/黑块。基于 verbose 调试产物的逐连通域扫描
（`devscripts/block_scan_mask.py`：对 `mask_final` 每个连通域比较 inpainted 掩码内填充中位数
与掩码外环形背景中位数）定位：**块主要来自修复阶段而非描边**——lama_large 把原文字区填成
与周边明显不符的平坦色（10 页样本 9 处：多数偏白如 fill [210,215,218] vs ring [170,177,187]，
少数偏黑如 [11,18,26] vs [33,50,77]）。

修复：`InpainterConfig.harmonize_fill_color`（默认开）。修复完成后对每个"填充平坦(std<20)且
与环色偏差>45"的掩码连通域，把掩码内像素向环色整体平移（高斯羽化过渡）；掩码外像素不动，
匹配良好的填充不处理。复扫同样页面：**9 处全部消除**（填充值与环色中位数差 ≤3 RGB），
配合 adaptive_bg_color 分别解决"块"与"描边色"两个来源。

## 补充2：原版美术字光晕残留的根因与修复（expand_mask_for_halo, cc0ad8b）

用户截图（page 005 "你好，斯嘉丽" 区域）显示 harmonize 后仍有大片白色光晕块。定位：
那是**原版英文美术字自带的发光效果**——远超笔画范围、不在文字掩码内，修复阶段被当作
背景保留，lama 还顺着光晕把笔画区填成白色；harmonize 的环形参照本身就是光晕，故无法修复。

修复：`InpainterConfig.expand_mask_for_halo`（默认开）。修复前用距离变换测每个像素到文字
掩码的距离，在扩展带（64px）内检测亮度明显偏离外侧背景基准（20px 外环中位数，±26）的
像素，仅保留与文字相连的光晕块并入掩码，让 lama 连光晕一起擦除重建。白色气泡等均匀背景
上环亮度==光晕亮度，自动不触发。验证：page 005 受影响区域亮白像素占比 0.0%；阶段基准
inpainting 0.195s vs 0.202s（几乎零成本）；配套把 harmonize 偏差阈值 45→36 覆盖暗色污渍
边缘情况（page 004 "*yawn*" diff=41）。子集复扫 0 残留（用户旧全量批的 3 个历史文件夹除外，
源图不在本次子集，机制相同已由子集验证）。

## 补充3：批量路径漏接修复（用户复跑仍见光晕）

用户以 `--batch-size 8` 全量复跑后仍见光晕：`expand_mask_for_halo` 与 `harmonize_fill_color`
此前只接在顺序路径 `_translate`，而批处理走 `translate_batch -> _complete_translation_pipeline`
的独立掩码/修复段。已把两个钩子抽成共用方法 `_expand_mask_for_halo` / `_harmonize_inpainted`，
顺序与批量两条路径统一调用。用户原命令在 10 页子集复验：page 005 受影响区域亮白像素 0.0%，
光晕完全擦除，18.5s/10页（与光晕扩展前持平）。
