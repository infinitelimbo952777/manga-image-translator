# -*- coding: utf-8 -*-
"""基于 mask_final.png 的修复填充色块精确扫描。

对每个修复掩码连通域：比较 inpainted 在掩码内的填充色（中位数）与掩码外环形
背景色（中位数），填充平坦且差异大 => 修复把文字区填成了与背景不符的颜色
（用户看到的白/黑块）。同时检查渲染引入像素中的大块纯黑/纯白（描边兜底残留）。

Usage:
    python devscripts/block_scan_mask.py [result子文件夹数=10]
"""
import sys
from pathlib import Path

import cv2
import numpy as np

BASE = Path(__file__).resolve().parent.parent
RESULT = BASE / 'result'
OUT = BASE / 'benchmark' / 'block_crops3'


def color_diff(a, b):
    return float(np.sqrt(np.sum((np.asarray(a, np.float32) - np.asarray(b, np.float32)) ** 2)))


def main():
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 10
    OUT.mkdir(parents=True, exist_ok=True)
    # 按文件夹名前缀的时间戳(毫秒)数值排序取最新，字符串排序会把不同位数的ts混序
    def ts_key(p: Path):
        try:
            return int(p.name.split('-')[0])
        except ValueError:
            return 0
    all_folders = [f for f in RESULT.iterdir() if f.is_dir() and (f / 'mask_final.png').exists()]
    # 每个页面(md5)只取最新一次运行的文件夹，避免混入历史运行的旧结果
    newest_by_md5 = {}
    for f in sorted(all_folders, key=ts_key):
        md5 = f.name.split('-')[1] if '-' in f.name else f.name
        newest_by_md5[md5] = f
    folders = sorted(newest_by_md5.values(), key=ts_key)[-limit:]
    print(f'scanning {len(folders)} debug folders with mask_final')
    total = 0
    for f in folders:
        page = f.name.split('-')[1][:6]
        inp = cv2.imread(str(f / 'inpainted.png'))
        src = cv2.imread(str(f / 'input.png'))
        fin = cv2.imread(str(f / 'final.png'))
        mask = cv2.imread(str(f / 'mask_final.png'), 0)
        if any(im is None for im in (inp, src, fin, mask)):
            print(f'  [{page}] missing files, skipped')
            continue
        h = min(inp.shape[0], mask.shape[0])
        w = min(inp.shape[1], mask.shape[1])
        inp, src, fin, mask = inp[:h, :w], src[:h, :w], fin[:h, :w], mask[:h, :w] > 127
        print(f'=== {page} mask={mask.mean() * 100:.1f}% ===')
        n, labels, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), connectivity=8)
        for i in range(1, n):
            x, y, w, h, area = stats[i]
            if area < 100:
                continue
            comp = labels == i
            sel = inp[comp]
            fill = np.median(sel, axis=0)
            flat = float(np.mean(np.std(sel, axis=0)))
            ring_m = cv2.dilate(comp.astype(np.uint8), np.ones((21, 21), np.uint8)).astype(bool) & ~comp
            ring_sel = inp[ring_m]
            if ring_sel.shape[0] < 40:
                continue
            ring = np.median(ring_sel, axis=0)
            d = color_diff(fill, ring)
            if d > 40 and flat < 20:
                total += 1
                pad = 26
                y0, y1 = max(y - pad, 0), min(y + h + pad, inp.shape[0])
                x0, x1 = max(x - pad, 0), min(x + w + pad, inp.shape[1])
                trio = np.concatenate([src[y0:y1, x0:x1], inp[y0:y1, x0:x1], fin[y0:y1, x0:x1]], axis=1)
                fn = OUT / f'{page}_inpaint_{total:02d}.png'
                cv2.imwrite(str(fn), trio)
                print(f'  block ({x},{y}) {w}x{h} area={area} fill={fill.tolist()} ring={ring.tolist()} '
                      f'diff={d:.0f} flat={flat:.1f} -> {fn.name} [src|inpainted|final]')
    print(f'\nTOTAL mismatched inpaint fills: {total}')


if __name__ == '__main__':
    main()
