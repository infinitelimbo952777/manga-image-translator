# -*- coding: utf-8 -*-
"""渲染背景自适应 A/B：同页在 adaptive_bg_color off/on 下渲染，打印每个 region
的 OCR 检测 bg、实际采样 bg 与最终描边 bg，并保存两种渲染结果供人工对比。

Usage:
    python devscripts/bg_ab.py [page.jpg ...]
"""
import asyncio
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE))

from PIL import Image  # noqa: E402

import numpy as np  # noqa: E402


async def main():
    from manga_translator import MangaTranslator
    from manga_translator.config import Config, Translator
    import manga_translator.rendering as rendering_mod
    from manga_translator.rendering import render as orig_render

    pages = sys.argv[1:]
    if not pages:
        pages = [str(BASE / 'benchmark/real_input/004.jpg')]

    orig_sample = rendering_mod.sample_background_color
    t = MangaTranslator({'use_gpu': True, 'kernel_size': 3})

    crop_dir = BASE / 'benchmark' / 'bg_crops'
    crop_dir.mkdir(parents=True, exist_ok=True)
    region_counter = {'n': 0}

    # 伪造翻译：直接用原文占位，让渲染阶段执行（translator=none 会清空 region）
    async def fake_translation(self, config, ctx):
        for region in (ctx.text_regions or []):
            region.translation = region.text or 'PLACEHOLDER TEXT'
            region.target_lang = config.translator.target_lang
        return ctx.text_regions

    MangaTranslator._run_text_translation = fake_translation

    for page in pages:
        img = Image.open(page)
        for adaptive in (False, True):
            config = Config()
            config.detector.detection_size = 1536
            config.inpainter.inpainting_size = 1536
            config.translator.translator = Translator.none
            config.translator.target_lang = 'CHS'
            config.render.adaptive_bg_color = adaptive

            # 捕获每个 region 的三种颜色（render 是同步函数，包装也必须是同步）
            def wrapped_render(img_, region, dst_points, hyphenate, line_spacing,
                               disable_font_border, _adaptive_bg=False, **kw):
                detected = np.array(region.get_font_colors()[1]).tolist()
                sampled = np.array(orig_sample(img_, dst_points, detected)).tolist()
                region_counter['n'] += 1
                # 保存修复后(绘制前)的region裁剪与最终渲染裁剪，供目视核对采样是否被残留文字污染
                import cv2
                x, y, w, h = cv2.boundingRect(dst_points.astype(np.int32))
                pad = 12
                y0, y1 = max(y - pad, 0), min(y + h + pad, img_.shape[0])
                x0, x1 = max(x - pad, 0), min(x + w + pad, img_.shape[1])
                name = f"{Path(page).stem}_r{region_counter['n']}_adaptive{int(adaptive)}"
                cv2.imwrite(str(crop_dir / f'{name}_inpainted.png'), img_[y0:y1, x0:x1])
                out = orig_render(img_, region, dst_points, hyphenate, line_spacing,
                                  disable_font_border, adaptive_bg_color=adaptive, **kw)
                cv2.imwrite(str(crop_dir / f'{name}_rendered.png'), out[y0:y1, x0:x1])
                print(f'    region fg={np.array(region.get_font_colors()[0]).tolist()} '
                      f'detected_bg={detected} sampled_bg={[round(float(v), 1) for v in sampled]} '
                      f'adaptive={adaptive} crop={name}')
                return out

            rendering_mod.render = wrapped_render
            try:
                await t.translate(img, config, skip_context_save=True)
            finally:
                rendering_mod.render = orig_render
            print(f'=== {Path(page).name} adaptive={adaptive} done ===')


if __name__ == '__main__':
    asyncio.run(main())
