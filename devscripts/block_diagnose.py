# -*- coding: utf-8 -*-
"""定位渲染结果中突兀白/黑块的来源。

对每页：跑完整流水线（伪造翻译，不耗API），然后在三个层面做连通域分析：
1. inpainted vs input：修复阶段改动的像素（原文字被擦除的区域）
   -> 每个连通域测 填充色中位数 / 周边环形背景色 / 内部平坦度
   -> "填充色与背景差异大 且 内部平坦" = 修复填充造成的色块
2. final vs inpainted：渲染阶段引入的像素（新文字+描边）
   -> 描边若为纯黑/白（可读性兜底触发）会在这里显形

Usage:
    python devscripts/block_diagnose.py [page.jpg ...]
"""
import asyncio
import sys
from pathlib import Path

import cv2
import numpy as np

BASE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE))

from PIL import Image  # noqa: E402


def color_diff(a, b):
    return float(np.sqrt(np.sum((np.asarray(a, dtype=np.float32) - np.asarray(b, dtype=np.float32)) ** 2)))


def analyzechanged(changed_mask, img_show, img_ring_src, label, page_name, min_size=150):
    """changed_mask: bool HxW。img_show: 取填充色的图。img_ring_src: 取环形背景的图。"""
    m = changed_mask.astype(np.uint8)
    n, labels, stats, _ = cv2.connectedComponentsWithStats(m, connectivity=8)
    flagged = 0
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        if area < min_size:
            continue
        comp = labels[y:y + h, x:x + w] == i
        sel = img_show[y:y + h, x:x + w][comp]
        fill = np.median(sel, axis=0)
        flat = float(np.mean(np.std(sel, axis=0)))
        ring_m = cv2.dilate((labels == i).astype(np.uint8), np.ones((17, 17), np.uint8))
        ring_m = (ring_m.astype(bool) & ~ (labels == i))
        ring_sel = img_ring_src[ring_m]
        if ring_sel.shape[0] < 30:
            continue
        ring = np.median(ring_sel, axis=0)
        d = color_diff(fill, ring)
        if d > 40 and flat < 16:
            flagged += 1
            print(f'  [{page_name}][{label}] block at ({x},{y},{w}x{h}) area={area} '
                  f'fill={fill.tolist()} ring={ring.tolist()} diff={d:.0f} flatness={flat:.1f}')
    return flagged


async def main():
    from manga_translator import MangaTranslator
    from manga_translator.config import Config, Translator

    pages = sys.argv[1:]
    if not pages:
        pages = sorted(str(p) for p in (BASE / 'benchmark/real_input').glob('*.jpg'))

    t = MangaTranslator({'use_gpu': True, 'kernel_size': 3})

    async def fake_translation(self, config, ctx):
        for region in (ctx.text_regions or []):
            region.translation = region.text or 'PLACEHOLDER TEXT'
            region.target_lang = config.translator.target_lang
        return ctx.text_regions

    MangaTranslator._run_text_translation = fake_translation

    out_dir = BASE / 'benchmark' / 'block_crops'
    out_dir.mkdir(parents=True, exist_ok=True)

    total_inpaint_blocks = 0
    total_render_blocks = 0
    for page in pages:
        name = Path(page).stem
        img = Image.open(page)
        config = Config()
        config.detector.detection_size = 1536
        config.inpainter.inpainting_size = 1536
        config.translator.translator = Translator.none
        config.translator.target_lang = 'CHS'
        config.render.adaptive_bg_color = True

        ctx = await t.translate(img, config, skip_context_save=True)

        inpainted = getattr(ctx, 'img_inpainted', None)
        result = getattr(ctx, 'result', None)
        if inpainted is None or result is None:
            print(f'=== {name}: missing ctx fields, skipped ===')
            continue
        source = np.array(img.convert('RGB')).astype(np.int16)
        inpainted = inpainted.astype(np.int16)
        if hasattr(result, 'convert'):  # PIL Image
            result = np.array(result.convert('RGB')).astype(np.int16)
        result = result.astype(np.int16)

        def align(a, ref):
            # 通道序自动对齐：RGB/BGR 取差异更小的方向
            d0 = np.abs(a[:, :, :3] - ref[:, :, :3]).mean()
            d1 = np.abs(a[:, :, :3][:, :, ::-1] - ref[:, :, :3]).mean()
            return a[:, :, :3][:, :, ::-1] if d1 < d0 else a[:, :, :3]

        h = min(source.shape[0], inpainted.shape[0], result.shape[0])
        w = min(source.shape[1], inpainted.shape[1], result.shape[1])
        inpainted = align(inpainted, source)[:h, :w]
        result = align(result, inpainted)[:h, :w]
        source = source[:h, :w, :3]

        inpaint_changed = (np.abs(inpainted.astype(np.int16) - source.astype(np.int16)).max(axis=2) > 18)
        render_changed = (np.abs(result.astype(np.int16) - inpainted.astype(np.int16)).max(axis=2) > 18)
        print(f'=== {name}: inpaint_changed={inpaint_changed.mean() * 100:.1f}% '
              f'render_changed={render_changed.mean() * 100:.1f}% ===')
        total_inpaint_blocks += analyzechanged(
            inpaint_changed, inpainted, inpainted, 'inpaint-fill', name)
        total_render_blocks += analyzechanged(
            render_changed, result, inpainted, 'render-intro', name)

    print(f'\nTOTAL: inpaint-fill blocks={total_inpaint_blocks}, render-intro blocks={total_render_blocks}')


if __name__ == '__main__':
    asyncio.run(main())
