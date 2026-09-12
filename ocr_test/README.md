# OCR 对比测试 (ocr_test)

对比仓库内置 OCR（48px / MangaOCR）与新部署的 Hayai OCR v2 / PaddleOCR (PP-OCR rec)，
覆盖 **英/日/韩 × 横排/竖排 × 4 种样式（黑字/彩色实心/深底白字/白字黑描边）**，
同时测 **准确率 (CER)** 与 **速度**，全部日志落盘。结论见 [REPORT.md](REPORT.md)。

## 文件

| 文件 | 作用 |
|---|---|
| `generate_test_images.py` | 生成 30 张合成漫画页：12 张基础页 + 18 张彩字样式页（同文案配对，隔离颜色因素），共 120 个逐行真值裁剪 |
| `run_benchmark.py` | 主基准：A 段=真值裁剪 rec-only（CER/延迟/样式分组/48px 取色精度）；B 段=同一 CTD 检测结果下整页识别 |
| `real_image_test.py` | 真实漫画页端到端抽查（CTD 检测 → 各引擎识别 → 文本对照表） |
| `images/` `crops/` | 合成测试页与逐行裁剪（含 `manifest.json` 真值，彩字段含 true_fg） |
| `logs/` | 每次运行输出 `bench_<ts>.json` / `.csv` / `bench_summary_<ts>.md` |

## 运行

```bash
# 1. 生成测试图（首次或修改文案后）
python ocr_test/generate_test_images.py

# 2. 跑基准（首次会自动下载 hayai-ocr-v2 ~600MB / paddle 各语种 rec 模型）
python ocr_test/run_benchmark.py --engines 48px,mocr,hayai,paddle --sections a,b --repeats 3

# 3. 真实漫画页抽查
python ocr_test/real_image_test.py --engines 48px,mocr,hayai,paddle
```

## 指标说明

- **CER**：字符错误率（Levenshtein / 真值长度），归一化：去空白、统一弯引号/省略号、英文小写。越低越好，0 = 完全一致。
- **exact-match**：归一化后完全一致的裁剪数 / 总数。
- **latency_ms**：A 段单裁剪识别延迟（3 次取中位数，含 Python 调用开销）。
- A 段隔离识别器质量；B 段模拟真实管线（相同检测框输入），更接近实际效果。

## 引擎

| 名称 | 说明 | 设备 |
|---|---|---|
| `48px` | 仓库默认 ocr48px（自研 48px 自回归模型） | cuda |
| `mocr` | kha-white/manga-ocr-base 0.1.14 | cuda |
| `hayai` | hayai-ocr 2.1.0（JustANormalTinkerer/hayai-ocr-v2，SigLIP2 NaFlex ~150M，支持日/中/韩/英） | cuda |
| `paddle` | PaddleOCR 3.7 PP-OCR rec（按语种选模型，竖排裁剪按官方管线规则旋转） | gpu:0 |
