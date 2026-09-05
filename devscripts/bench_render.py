"""
渲染 warp 局部化优化的正确性 + 性能微基准（照 test_render.py 的 TextBlock 构造方式）。

对比：
  1) 正确性：局部 warp 与全图 warp 在目标框内逐像素一致
  2) 性能：20 region 场景下 dispatch 的整体耗时（新版）vs 全图 warp 成本下界（旧版关键路径）
"""
import asyncio
import sys
import time
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE))

import cv2  # noqa: E402
import numpy as np  # noqa: E402

from manga_translator.rendering import dispatch as dispatch_rendering  # noqa: E402
from manga_translator.utils import TextBlock  # noqa: E402


async def main():
    width, height = 1920, 1080
    img = (np.random.rand(height, width, 3) * 60 + 40).astype(np.uint8)

    regions = []
    for i in range(20):
        x = 60 + (i % 5) * 360
        y = 60 + (i // 5) * 240
        regions.append(TextBlock(
            [[[x, y], [x + 300, y], [x, y + 150], [x + 300, y + 150]]],
            texts=['a', 'b', 'c', 'd'],
            translation='hello world benchmark line',
        ))
    for region in regions:
        region.target_lang = 'ENG'
        region.set_font_colors([0, 0, 0], [255, 255, 255])
        region.font_size = 24

    # --- 正确性：局部 warp vs 全图 warp ---
    box = np.zeros((150, 300, 4), dtype=np.uint8)
    box[..., :3] = 255
    box[..., 3] = 255
    src = np.array([[0, 0], [300, 0], [300, 150], [0, 150]], dtype=np.float32)
    dst = np.array([[60, 60], [360, 60], [360, 210], [60, 210]], dtype=np.float32)
    M, _ = cv2.findHomography(src, dst, cv2.RANSAC, 5.0)
    rgba_full = cv2.warpPerspective(box, M, (width, height), flags=cv2.INTER_LINEAR,
                                    borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    x, y, w, h = cv2.boundingRect(dst.astype(np.int32))
    shift = np.array([[1, 0, -x], [0, 1, -y], [0, 0, 1]], dtype=np.float64)
    rgba_local = cv2.warpPerspective(box, shift @ M, (w, h), flags=cv2.INTER_LINEAR,
                                     borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    diff = np.abs(rgba_full[y:y+h, x:x+w].astype(int) - rgba_local.astype(int)).max()
    print(f"[correctness] pixel max diff full-vs-local warp: {diff} (expect 0)")

    # --- 性能 ---
    font_path = str(BASE / "fonts" / "comic shanns 2.ttf")
    if not Path(font_path).exists():
        font_path = str(sorted((BASE / "fonts").glob("*.ttf"))[0])

    await dispatch_rendering(img.copy(), regions, hyphenate=False)  # 预热

    n = 3
    t0 = time.perf_counter()
    for _ in range(n):
        out = await dispatch_rendering(img.copy(), regions, hyphenate=False)
    t_new = (time.perf_counter() - t0) / n
    print(f"[perf] new render dispatch: {t_new*1000:7.1f} ms / image (20 regions)")

    # 旧实现关键路径成本下界：每 region 一次全图 warp
    t0 = time.perf_counter()
    for _ in range(n):
        for _ in regions:
            _ = cv2.warpPerspective(box, M, (width, height))
    t_old = (time.perf_counter() - t0) / n
    print(f"[perf] old full-image warp only: {t_old*1000:7.1f} ms / image (20 regions, warp-only lower bound)")

    cv2.imwrite(str(BASE / "benchmark" / "results" / "render_new_output.png"), out)
    print("saved sample: benchmark/results/render_new_output.png")


asyncio.run(main())
