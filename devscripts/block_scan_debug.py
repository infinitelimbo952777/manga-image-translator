# -*- coding: utf-8 -*-
"""扫描 CLI -v 调试产物 (input/inpainted/final) 中的突兀色块并导出裁剪。

分层定位：
- inpaint-fill : inpainted 与 input 的改动区中，填充平坦且与周边背景差异大的连通域
                 （修复阶段把原文字区填成了错误颜色 -> 用户看到的块）
- render-intro : final 与 inpainted 的改动区中，接近纯黑/纯白的大块
                 （描边/可读性兜底残留）

Usage:
    python devscripts/block_scan_debug.py [result子文件夹数=10]
"""
import sys
from pathlib import Path

import cv2
import numpy as np

BASE = Path(__file__).resolve().parent.parent
RESULT = BASE / 'result'
OUT = BASE / 'benchmark' / 'block_crops2'


def color_diff(a, b):
    return float(np.sqrt(np.sum((np.asarray(a, np.float32) - np.asarray(b, np.float32)) ** 2)))


def scan(changed, fill_img, ring_img, label, page, min_size=120):
    n, labels, stats, _ = cv2.connectedComponentsWithStats(changed.astype(np.uint8), connectivity=8)
    flagged = 0
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        if area < min_size:
            continue
        comp = labels == i
        sel = fill_img[comp]
        fill = np.median(sel, axis=0)
        flat = float(np.mean(np.std(sel, axis=0)))
        ring_m = cv2.dilate(comp.astype(np.uint8), np.ones((17, 17), np.uint8)).astype(bool) & ~comp
        ring_sel = ring_img[ring_m]
        if ring_sel.shape[0] < 30:
            continue
        ring = np.median(ring_sel, axis=0)
        d = color_diff(fill, ring)
        if d > 40 and flat < 18:
            flagged += 1
            pad = 20
            y0, y1 = max(y - pad, 0), min(y + h + pad, fill_img.shape[0])
            x0, x1 = max(x - pad, 0), min(x + w + pad, fill_img.shape[1])
            crop = np.concatenate([ring_img[y0:y1, x0:x1], fill_img[y0:y1, x0:x1]], axis=1)
            fn = OUT / f'{page}_{label}_{flagged}.png'
            cv2.imwrite(str(fn), crop)
            print(f'  [{page}][{label}] ({x},{y}) {w}x{h} area={area} fill={fill.tolist()} '
                  f'ring={ring.tolist()} diff={d:.0f} flat={flat:.1f} -> {fn.name}')
    return flagged


def main():
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 10
    OUT.mkdir(parents=True, exist_ok=True)
    folders = sorted([f for f in RESULT.iterdir() if f.is_dir() and (f / 'final.png').exists()])[-limit:]
    print(f'scanning {len(folders)} debug folders')
    t1 = t2 = 0
    for f in folders:
        page = f.name.split('-')[1][:6] if '-' in f.name else f.name[:8]
        inp = cv2.imread(str(f / 'input.png'))
        ip = cv2.imread(str(f / 'inpainted.png'))
        fin = cv2.imread(str(f / 'final.png'))
        if inp is None or ip is None or fin is None:
            print(f'  [{page}] missing debug images, skipped')
            continue
        h = min(inp.shape[0], ip.shape[0], fin.shape[0])
        w = min(inp.shape[1], ip.shape[1], fin.shape[1])
        inp, ip, fin = inp[:h, :w], ip[:h, :w], fin[:h, :w]
        print(f'=== {page} ({f.name}) ===')
        inpaint_changed = np.abs(ip.astype(np.int16) - inp.astype(np.int16)).max(axis=2) > 18
        render_changed = np.abs(fin.astype(np.int16) - ip.astype(np.int16)).max(axis=2) > 18
        t1 += scan(inpaint_changed, ip, ip, 'inpaint-fill', page)
        t2 += scan(render_changed, fin, ip, 'render-intro', page)
    print(f'\nTOTAL inpaint-fill blocks={t1}, render-intro blocks={t2}')


if __name__ == '__main__':
    main()
