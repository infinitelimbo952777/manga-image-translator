# -*- coding: utf-8 -*-
"""
Qualitative end-to-end test on a REAL manga page:
CTD detector -> per-engine OCR -> side-by-side text dump + annotated preview.

Usage: python ocr_test/real_image_test.py [--image PATH] [--engines 48px,mocr,hayai,paddle]
Output: ocr_test/logs/real_<ts>.md  + ocr_test/logs/real_<ts>_boxes.png
"""
import os
os.environ.setdefault("TORCHDYNAMO_DISABLE", "1")
import sys
import json
import time
import asyncio
import argparse
from pathlib import Path
from datetime import datetime

import numpy as np
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
sys.path.insert(0, str(REPO))
sys.path.insert(0, str(HERE))

from run_benchmark import ENGINES, DEVICE  # noqa: E402

DEFAULT_IMAGE = r"F:\jian\picture\rolling eyes\(Rolling Eye) I became a dick-crazy slut thanks to the hypnotic techniques of a young ninja. [AI Generated]-1280x\03_002.webp"


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--image", default=DEFAULT_IMAGE)
    ap.add_argument("--engines", default="48px,mocr,hayai,paddle")
    ap.add_argument("--det-size", type=int, default=1536)
    ap.add_argument("--auto-rotate", action="store_true")
    args = ap.parse_args()

    img = Image.open(args.image).convert("RGB")
    rgb = np.asarray(img)
    print(f"image: {args.image} {img.size} device={DEVICE} det_size={args.det_size} auto_rotate={args.auto_rotate}")

    from manga_translator.detection import dispatch as det_dispatch
    from manga_translator.config import Detector
    res = await det_dispatch(
        Detector.ctd, rgb, detect_size=args.det_size, text_threshold=0.5,
        box_threshold=0.7, unclip_ratio=1.6, invert=False,
        gamma_correct=False, rotate=False, auto_rotate=args.auto_rotate,
        device=DEVICE, verbose=False)
    quads = res[0] if isinstance(res, tuple) else res
    print(f"CTD detected {len(quads)} lines")

    # annotated box preview
    vis = img.copy()
    d = ImageDraw.Draw(vis)
    for i, q in enumerate(quads):
        d.rectangle([q.aabb.x, q.aabb.y, q.aabb.x + q.aabb.w, q.aabb.y + q.aabb.h],
                    outline=(255, 0, 0), width=3)
        d.text((q.aabb.x + 3, q.aabb.y + 3), str(i), fill=(255, 0, 0))

    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    out = [f"# Real-image OCR comparison ({ts})", "",
           f"Image: `{args.image}`  |  detector: CTD  |  lines: {len(quads)}", ""]

    for name in [n.strip() for n in args.engines.split(",")]:
        cls = ENGINES.get(name)
        if not cls:
            continue
        print(f"=== engine: {name} ===")
        eng = cls()
        try:
            await eng.load()
        except Exception as e:
            out += [f"## {name}", f"LOAD FAILED: {e}", ""]
            continue
        for q in quads:
            q.text = ""
        t0 = time.time()
        await eng.rec_quads(rgb, quads)
        dt = time.time() - t0
        out += [f"## {name}  ({dt:.2f}s total)", "",
                "| # | text |", "|---|---|"]
        for i, q in enumerate(quads):
            t = q.text if isinstance(q.text, str) else "".join(q.text)
            out.append(f"| {i} | {t.replace('|', '/')} |")
        out.append("")

    vis.save(HERE / "logs" / f"real_{ts}_boxes.png")
    md = "\n".join(out) + "\n"
    (HERE / "logs" / f"real_{ts}.md").write_text(md, encoding="utf-8")
    print(md)


if __name__ == "__main__":
    asyncio.run(main())
