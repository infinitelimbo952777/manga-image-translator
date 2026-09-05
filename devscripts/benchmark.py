"""
端到端分阶段性能 benchmark（零侵入：通过 monkey-patch 各阶段方法计时，不修改核心代码）。

用法:
  # B1 纯本地流水线（translator=none，优化主口径）
  python devscripts/benchmark.py --input-dir benchmark/input --no-translator --output benchmark/results/baseline_local.json

  # B0 端到端（使用 config.json 里的翻译器，含在线 API）
  python devscripts/benchmark.py --input-dir benchmark/input --config-file config.json --output benchmark/results/baseline_e2e.json

  # 配置矩阵实验
  python devscripts/benchmark.py --input-dir benchmark/input --no-translator --detection-size 1536 --output benchmark/results/det1536.json

说明:
  - 首轮为预热轮（模型磁盘->显存加载、CUDA kernel 初始化），不计入统计。
  - 模型常驻显存（ModelWrapper.load 幂等 + 模块级缓存），后续轮次不重复加载。
"""
import argparse
import asyncio
import json
import platform
import sys
import time
from pathlib import Path
from statistics import mean, median

BASE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE))

from PIL import Image  # noqa: E402

STAGES = [
    ("_run_colorizer", "colorize"),
    ("_run_upscaling", "upscale"),
    ("_run_detection", "detection"),
    ("_run_ocr", "ocr"),
    ("_run_textline_merge", "textline_merge"),
    ("_run_text_translation", "translation"),
    ("_run_mask_refinement", "mask_refinement"),
    ("_run_inpainting", "inpainting"),
    ("_run_text_rendering", "rendering"),
]

# 阶段调用次数可能与图片数不一致（如 colorize/upscale 被配置跳过）：
# 若记录数与有效图片数一致则按位对齐，否则原样统计。
TIMING_RECORDS: dict[str, list[float]] = {}


def install_timing_hooks():
    """把 MangaTranslator 的各 _run_* 方法包一层 perf_counter 计时。"""
    from manga_translator import MangaTranslator

    for attr, key in STAGES:
        orig = getattr(MangaTranslator, attr)

        async def wrapper(self, config, ctx, _orig=orig, _key=key):
            t0 = time.perf_counter()
            try:
                return await _orig(self, config, ctx)
            finally:
                TIMING_RECORDS.setdefault(_key, []).append(time.perf_counter() - t0)

        setattr(MangaTranslator, attr, wrapper)


def stage_samples(key: str, timed_flags: list[bool]) -> list[float]:
    vals = TIMING_RECORDS.get(key, [])
    if len(vals) == len(timed_flags):
        return [v for v, t in zip(vals, timed_flags) if t]
    return vals


def summarize(runs: list[dict], n_img: int) -> dict:
    timed_runs = [x for x in runs if not x["warmup"]]
    timed_flags = [not x["warmup"] for x in runs]

    stages = {}
    for _, key in STAGES:
        vals = stage_samples(key, timed_flags)
        if not vals:
            continue
        stages[key] = {
            "per_image_mean_s": round(mean(vals), 4),
            "per_image_median_s": round(median(vals), 4),
        }
    stage_sum = sum(v["per_image_mean_s"] for v in stages.values())
    for v in stages.values():
        v["share_pct"] = round(v["per_image_mean_s"] / stage_sum * 100, 1) if stage_sum else 0.0

    per_image = [x["total_s"] for x in timed_runs]
    per_round = [sum(per_image[i:i + n_img]) for i in range(0, len(per_image), n_img)]
    return {
        "stages": stages,
        "stages_sum_per_image_s": round(stage_sum, 4),
        "per_image_mean_s": round(mean(per_image), 4) if per_image else 0.0,
        "per_round_total_mean_s": round(mean(per_round), 3) if per_round else 0.0,
        "images_per_sec": round(n_img / mean(per_round), 3) if per_round else 0.0,
    }


def print_report(summary: dict, label: str):
    print(f"\n===== Benchmark summary [{label}] =====")
    print(f"{'stage':<26}{'mean(s)':>10}{'median(s)':>11}{'share':>8}")
    for _, key in STAGES:
        v = summary["stages"].get(key)
        if not v:
            continue
        print(f"{key:<26}{v['per_image_mean_s']:>10.3f}{v['per_image_median_s']:>11.3f}{v['share_pct']:>7.1f}%")
    print(f"{'-- stages sum/image --':<26}{summary['stages_sum_per_image_s']:>10.3f}")
    print(f"{'TOTAL per image':<26}{summary['per_image_mean_s']:>10.3f}")
    print(f"{'THROUGHPUT':<26}{summary['images_per_sec']:>10.3f} img/s")


def load_config(path: str | None, args):
    from manga_translator.config import Config

    if path:
        p = Path(path)
        text = p.read_text(encoding="utf-8")
        if p.suffix == ".toml":
            import tomllib
            data = tomllib.loads(text)
        else:
            data = json.loads(text)
        config = Config(**data)
    else:
        config = Config()

    if args.no_translator:
        from manga_translator.config import Translator
        config.translator.translator = Translator.none
    if args.detection_size:
        config.detector.detection_size = args.detection_size
    if args.inpainting_size:
        config.inpainter.inpainting_size = args.inpainting_size
    if args.simple_sort:
        config.force_simple_sort = True
    return config


def build_translator(args):
    from manga_translator import MangaTranslator

    params = {
        "use_gpu": not args.cpu,
        "kernel_size": 3,
        "disable_memory_optimization": args.disable_memory_optimization,
        "prep_manual": None,
        "pre_dict": None,
        "post_dict": None,
        "context_size": 0,
        "batch_size": 1,
        "batch_concurrent": False,
    }
    return MangaTranslator(params)


async def run(args):
    import torch

    config = load_config(args.config_file, args)
    install_timing_hooks()
    translator = build_translator(args)

    images = sorted(Path(args.input_dir).glob("*.png")) + sorted(Path(args.input_dir).glob("*.jpg"))
    if not images:
        print(f"No images found in {args.input_dir}", file=sys.stderr)
        sys.exit(1)

    label = args.label or ("local-no-translator" if args.no_translator else str(config.translator.translator))
    print(f"Device: {translator.device} | warmup rounds: {args.warmup} | timed rounds: {args.count} "
          f"| images: {len(images)} | translator: {config.translator.translator}")

    runs = []
    for r in range(args.warmup + args.count):
        round_start = time.perf_counter()
        for img_path in images:
            img = Image.open(img_path)
            t0 = time.perf_counter()
            await translator.translate(img, config, skip_context_save=True)
            dt = time.perf_counter() - t0
            runs.append({"round": r, "image": img_path.name, "total_s": round(dt, 4),
                         "warmup": r < args.warmup})
            print(f"  round {r}: {img_path.name:<14} {dt:8.2f}s")
        print(f"  round {r} done in {time.perf_counter() - round_start:.1f}s")

    summary = summarize(runs, len(images))
    result = {
        "meta": {
            "label": label,
            "python": platform.python_version(),
            "torch": torch.__version__,
            "cuda": torch.version.cuda,
            "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
            "device": translator.device,
            "translator": str(config.translator.translator),
            "detector": str(config.detector.detector),
            "detection_size": config.detector.detection_size,
            "ocr": str(config.ocr.ocr),
            "inpainter": str(config.inpainter.inpainter),
            "inpainting_size": config.inpainter.inpainting_size,
            "inpainting_precision": str(config.inpainter.inpainting_precision),
            "disable_memory_optimization": args.disable_memory_optimization,
            "n_images": len(images),
            "warmup_rounds": args.warmup,
            "timed_rounds": args.count,
        },
        "runs": runs,
        "summary": summary,
        "raw_stage_samples": {k: [round(v, 4) for v in vals] for k, vals in TIMING_RECORDS.items()},
    }

    print_report(summary, label)

    if args.output:
        out = Path(args.output)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"Saved: {out}")


def main():
    parser = argparse.ArgumentParser(description="manga-image-translator stage-level benchmark")
    parser.add_argument("--input-dir", default="benchmark/input")
    parser.add_argument("--config-file", default=None)
    parser.add_argument("--no-translator", action="store_true", help="force translator=none (pure local pipeline)")
    parser.add_argument("--warmup", type=int, default=1)
    parser.add_argument("--count", type=int, default=2, help="timed rounds")
    parser.add_argument("--detection-size", type=int, default=None)
    parser.add_argument("--inpainting-size", type=int, default=None)
    parser.add_argument("--simple-sort", action="store_true", help="force_simple_sort=true (skip panel-based sorting)")
    parser.add_argument("--cpu", action="store_true")
    parser.add_argument("--disable-memory-optimization", action="store_true")
    parser.add_argument("--label", default=None)
    parser.add_argument("--output", default=None)
    args = parser.parse_args()

    asyncio.run(run(args))


if __name__ == "__main__":
    main()
