"""Verify fixes for the folder-translation render crash (OpenCV SHRT_MAX).

1. N-gram repetition detection catches multi-char loops that single-char and
   word-level checks miss ("的果实" x N).
2. OCR-source filter (threshold=8) drops hallucinated repeats without
   touching legit SFX.
3. render()/dispatch() survive the exact pathological case that crashed:
   3134-char translation on a vertical region (used to blow the text canvas
   past OpenCV's 32767-px limit via unclamped single-axis expansion + padding).
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import numpy as np

from manga_translator.manga_translator import MangaTranslator
from manga_translator.rendering import dispatch
from manga_translator.utils import TextBlock

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONT = os.path.join(BASE, 'fonts', 'Arial-Unicode-Regular.ttf')

check = lambda text, threshold, silent=True: asyncio.run(MangaTranslator._check_repetition_hallucination(
    None, text, threshold=threshold, silent=silent))

failures = []


def expect(name, got, want):
    ok = got == want
    print(f"{'PASS' if ok else 'FAIL'}  {name}: got {got}, want {want}")
    if not ok:
        failures.append(name)


print('--- translation-side check (threshold=5) ---')
expect('的果实 x20 (was missed)', check('子宫的' + '的果实' * 20, 5), True)
expect('300x ~ (single char)', check('おおおお' + '~' * 300, 5), True)
expect('normal sentence', check('今天天气真不错，我们一起去公园散步吧。', 5), False)
expect('brackets + sfx', check('「んひぃ…っ♡遅しいパパ…だいすき…♡', 5), False)

print('--- OCR-source check (threshold=8) ---')
expect('実の x95 (crash source)', check('んっああっあんっ子宮の' + '実の' * 95, 8), True)
expect('のしのし (legit sfx)', check('のしのし', 8), False)
expect('ざわ x3 (legit sfx)', check('ざわ…ざわ…ざわ…', 8), False)
expect('ドドドドド (legit sfx)', check('ドドドドド', 8), False)
expect('ーーー!!! (dashes)', check('ーーー!!!', 8), False)
expect('哈哈哈哈哈 (5x, under thr)', check('哈哈哈哈哈', 8), False)
expect('normal ja sentence', check('まだ壊れてないだろう？ほらもう一回だ', 8), False)

print('--- render() survival on the exact crash case ---')


async def render_giant():
    giant = '子宫的' + '的果实' * 620  # 3134 chars, same as the failed image
    region = TextBlock(
        [np.array([[100, 100], [700, 100], [700, 1300], [100, 1300]], dtype=np.float64)],
        texts=['テスト'],
        font_size=40,
        translation=giant,
        fg_color=(0, 0, 0),
        bg_color=(255, 255, 255),
        source_lang='JPN',
        target_lang='CHS',
    )
    img = np.zeros((1824, 1248, 3), np.uint8)
    out = await dispatch(img, [region], font_path=FONT, font_size_fixed=None,
                         font_size_offset=3, font_size_minimum=0)
    return out.shape


try:
    shape = asyncio.run(render_giant())
    print(f"PASS  dispatch survived giant translation, output shape {shape}")
except Exception as e:
    print(f'FAIL  dispatch crashed: {type(e).__name__}: {e}')
    failures.append('render giant')

print()
print('ALL PASS' if not failures else f'FAILURES: {failures}')
sys.exit(1 if failures else 0)
