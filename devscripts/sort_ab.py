# -*- coding: utf-8 -*-
"""排序策略 A/B：同一页在 panel 全分辨率 / panel降采样 / simple_sort 三种设置下
跑完整流水线，记录 sort_regions 的输出顺序与耗时，供人工对比阅读顺序差异。

Usage:
    python devscripts/sort_ab.py [page1.jpg page2.jpg ...]
"""
import asyncio
import sys
import time
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE))

from PIL import Image  # noqa: E402

VARIANTS = [
    ('panel_full', lambda c: None),
    ('panel_down2', lambda c: setattr(c, 'panel_sort_downscale', 2)),
    ('simple', lambda c: setattr(c, 'force_simple_sort', True)),
]


async def main():
    from manga_translator import MangaTranslator
    import manga_translator.manga_translator as MTM
    from manga_translator.config import Config, Translator
    from manga_translator.utils.sort import sort_regions as orig_sort

    holder = {'page': None, 'label': None}
    orders = {}

    def wrapped_sort(regions, **kwargs):
        t0 = time.perf_counter()
        out = orig_sort(regions, **kwargs)
        dt = time.perf_counter() - t0
        orders.setdefault((holder['page'], holder['label']), []).append(
            (dt, [r.text for r in out]))
        return out

    MTM.sort_regions = wrapped_sort

    pages = sys.argv[1:]
    if not pages:
        pages = [str(BASE / 'benchmark/real_input/003.jpg')]

    t = MangaTranslator({'use_gpu': True, 'kernel_size': 3})

    for page in pages:
        name = Path(page).name
        holder['page'] = name
        img = Image.open(page)
        for label, mutate in VARIANTS:
            holder['label'] = label
            config = Config()
            config.detector.detection_size = 1536
            config.inpainter.inpainting_size = 1536
            config.translator.translator = Translator.none
            mutate(config)
            t0 = time.perf_counter()
            await t.translate(img, config, skip_context_save=True)
            dt = time.perf_counter() - t0
            print(f'\n=== {name} [{label}] translate_total={dt:.2f}s ===')
            for sort_dt, order in orders.get((name, label), []):
                print(f'    [sort_regions] {sort_dt * 1000:.0f}ms, {len(order)} regions')
                for i, tx in enumerate(order):
                    print(f'  {i:2d}. {tx[:44]}')


if __name__ == '__main__':
    asyncio.run(main())
