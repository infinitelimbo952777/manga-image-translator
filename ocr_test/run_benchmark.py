# -*- coding: utf-8 -*-
"""
OCR benchmark for manga-image-translator.

Section A (rec-only): every engine transcribes the same 48 ground-truth line
crops (en/ja/ko x h/v). Metrics: CER, exact-match, per-crop latency.

Section B (pipeline-sim): ComicTextDetector (same detector for all engines)
extracts line quads from the 12 synthetic pages; each engine transcribes them;
quads are matched to GT lines by IoU and CER is computed on matches.

Engines: 48px (repo default), mocr (MangaOCR), hayai (Hayai OCR v2), paddle
(PaddleOCR 3.x PP-OCR rec, per-language model, pipeline-style rotation for
tall crops).

Usage:  python ocr_test/run_benchmark.py [--engines 48px,mocr,hayai,paddle]
        [--sections a,b] [--repeats 3]
Logs:   ocr_test/logs/bench_<ts>.json / bench_summary_<ts>.md / bench_<ts>.csv
"""
import os
os.environ.setdefault("TORCHDYNAMO_DISABLE", "1")  # hayai calls torch.compile; skip on Windows
import sys
import json
import time
import asyncio
import argparse
import statistics
from pathlib import Path
from datetime import datetime

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
sys.path.insert(0, str(REPO))

LOGS = HERE / "logs"
LOGS.mkdir(exist_ok=True)
DEVICE = "cuda" if __import__("torch").cuda.is_available() else "cpu"


# ---------------- metrics ----------------

def norm_text(s: str, lang: str) -> str:
    s = (s or "").replace("…", "...").replace("’", "'").replace("‘", "'")
    s = s.replace("“", '"').replace("”", '"')
    s = "".join(s.split())
    if lang == "en":
        s = s.lower()
    return s


def levenshtein(a: str, b: str) -> int:
    if a == b:
        return 0
    if not a or not b:
        return max(len(a), len(b))
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def cer(ref: str, hyp: str, lang: str) -> float:
    ref, hyp = norm_text(ref, lang), norm_text(hyp, lang)
    if not ref:
        return 0.0 if not hyp else 1.0
    return levenshtein(ref, hyp) / len(ref)


def iou(a, b) -> float:
    ax0, ay0, ax1, ay1 = a
    bx0, by0, bx1, by1 = b
    ix = max(0, min(ax1, bx1) - max(ax0, bx0))
    iy = max(0, min(ay1, by1) - max(ay0, by0))
    inter = ix * iy
    ua = (ax1 - ax0) * (ay1 - ay0) + (bx1 - bx0) * (by1 - by0) - inter
    return inter / ua if ua > 0 else 0.0


# ---------------- engines ----------------

class Engine48px:
    name = "48px"

    async def load(self):
        from manga_translator.ocr.model_48px import Model48pxOCR
        self.ocr = Model48pxOCR()
        t0 = time.time()
        await self.ocr.download()
        await self.ocr.load(DEVICE)
        self.load_s = time.time() - t0

    async def rec_quads(self, page_rgb: np.ndarray, quads: list):
        from manga_translator.utils import Quadrilateral
        from manga_translator.config import OcrConfig
        wraps = []
        for q in quads:
            x0, y0 = int(q.aabb.x), int(q.aabb.y)
            x1, y1 = int(q.aabb.x + q.aabb.w), int(q.aabb.y + q.aabb.h)
            pts = np.array([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], dtype=np.float32)
            wraps.append(Quadrilateral(pts, "", 1.0))
        await self.ocr.recognize(page_rgb, wraps, OcrConfig())
        for src, wr in zip(quads, wraps):
            src.text = wr.text if isinstance(wr.text, str) else ""

    async def rec_crop(self, pil: Image.Image) -> str:
        from manga_translator.utils import Quadrilateral
        from manga_translator.config import OcrConfig
        img = np.asarray(pil)
        h, w = img.shape[:2]
        quad = Quadrilateral(np.array([[0, 0], [w, 0], [w, h], [0, h]], dtype=np.float32), "", 1.0)
        res = await self.ocr.recognize(img, [quad], OcrConfig())
        # capture the 48px font-color estimates (used by the renderer / hayai integration)
        if res:
            self.last_fg = [res[0].fg_r, res[0].fg_g, res[0].fg_b]
            self.last_bg = [res[0].bg_r, res[0].bg_g, res[0].bg_b]
        else:
            self.last_fg = self.last_bg = None
        return res[0].text if res else ""


class EngineMocr:
    name = "mocr"

    async def load(self):
        from manga_ocr import MangaOcr
        t0 = time.time()
        self.m = MangaOcr()
        self.load_s = time.time() - t0

    async def rec_quads(self, page_rgb: np.ndarray, quads: list):
        for q, crop in aabb_crops(page_rgb, quads):
            q.text = self.m(Image.fromarray(crop))

    async def rec_crop(self, pil: Image.Image) -> str:
        return self.m(pil)


class EngineHayai:
    name = "hayai"

    async def load(self):
        from hayai_ocr import HayaiOcr
        t0 = time.time()
        self.m = HayaiOcr()  # v2, auto-cuda
        self.load_s = time.time() - t0

    async def rec_quads(self, page_rgb: np.ndarray, quads: list):
        pairs = list(aabb_crops(page_rgb, quads))
        texts = self.m([Image.fromarray(c) for _, c in pairs])  # native batch
        for (q, _), t in zip(pairs, texts):
            q.text = t

    async def rec_crop(self, pil: Image.Image) -> str:
        return self.m(pil)


PADDLE_MODEL_CANDIDATES = {
    # PP-OCRv5 main models are multilingual (zh/en/ja); korean only exists as v3
    "en": ["en_PP-OCRv5_mobile_rec", "en_PP-OCRv3_mobile_rec"],
    "ja": ["PP-OCRv5_server_rec", "PP-OCRv5_mobile_rec", "japan_PP-OCRv3_mobile_rec"],
    "ko": ["korean_PP-OCRv3_mobile_rec"],
}


class EnginePaddle:
    """
    PaddleOCR 3.7 (paddlepaddle 3.2 CPU build) in-process.
    NOTE: the GPU build (cu126) cannot coexist with torch(cu132) on Windows —
    they ship mutually incompatible cudnn DLLs with identical file names —
    so this engine runs on CPU; accuracy numbers are unaffected.
    """
    name = "paddle"

    async def load(self):
        from paddleocr import TextRecognition
        t0 = time.time()
        self.models = {}
        self.chosen = {}
        for lang, cands in PADDLE_MODEL_CANDIDATES.items():
            last_err = None
            for name in cands:
                try:
                    self.models[lang] = TextRecognition(model_name=name, device="cpu")
                    self.chosen[lang] = name
                    break
                except Exception as e:
                    last_err = e
            if lang not in self.models:
                raise RuntimeError(f"paddle: no model for {lang}: {last_err}")
        self.load_s = time.time() - t0
        print(f"[paddle] models: {self.chosen}")

    @staticmethod
    def _extract(res) -> str:
        try:
            t = res["rec_text"]
            if hasattr(t, "__len__") and not isinstance(t, str):
                t = t[0]
            return str(t)
        except Exception:
            try:
                t = res.rec_text
                if hasattr(t, "__len__") and not isinstance(t, str):
                    t = t[0]
                return str(t)
            except Exception:
                return ""

    def _rec_arr(self, model, arr_rgb: np.ndarray) -> str:
        if arr_rgb.shape[0] > 1.5 * arr_rgb.shape[1]:  # PP-OCR vertical handling
            arr_rgb = np.rot90(arr_rgb)
        try:
            res = model.predict(np.ascontiguousarray(arr_rgb[:, :, ::-1]))[0]
            return self._extract(res)
        except Exception as e:
            print(f"[paddle] predict error: {e}")
            return ""

    async def rec_quads(self, page_rgb: np.ndarray, quads: list):
        model = self.models[getattr(self, "_page_lang", "ja")]
        for q, crop in aabb_crops(page_rgb, quads):
            q.text = self._rec_arr(model, crop)

    async def rec_crop(self, pil: Image.Image) -> str:
        model = self.models[getattr(self, "_crop_lang", "ja")]
        return self._rec_arr(model, np.asarray(pil))


def aabb_crops(page_rgb: np.ndarray, quads: list):
    """Identical tight AABB crop per quad for every engine (fair input)."""
    h, w = page_rgb.shape[:2]
    for q in quads:
        x0 = max(0, int(q.aabb.x)); y0 = max(0, int(q.aabb.y))
        x1 = min(w, int(q.aabb.x + q.aabb.w)); y1 = min(h, int(q.aabb.y + q.aabb.h))
        if x1 - x0 < 2 or y1 - y0 < 2:
            q.text = ""
            continue
        yield q, page_rgb[y0:y1, x0:x1]


ENGINES = {"48px": Engine48px, "mocr": EngineMocr, "hayai": EngineHayai, "paddle": EnginePaddle}


# ---------------- benchmark ----------------

def load_manifest():
    man = json.loads((HERE / "crops" / "manifest.json").read_text(encoding="utf-8"))
    gt = json.loads((HERE / "ground_truth.json").read_text(encoding="utf-8"))
    return man["crops"], gt["pages"]


async def bench_section_a(eng, crops, repeats):
    rows = []
    for c in crops:
        pil = Image.open(HERE / "crops" / c["file"])
        setattr(eng, "_crop_lang", c["lang"])
        for _ in range(2):  # warmup
            await eng.rec_crop(pil)
        times, hyp = [], ""
        for _ in range(repeats):
            t0 = time.time()
            hyp = await eng.rec_crop(pil)
            times.append((time.time() - t0) * 1000)
        rows.append({
            "section": "A", "engine": eng.name, "crop": c["file"],
            "lang": c["lang"], "orient": c["orient"], "style": c.get("style", "plain"),
            "ref": c["text"], "hyp": hyp,
            "cer": cer(c["text"], hyp, c["lang"]),
            "latency_ms": statistics.median(times),
            "fg_ref": c.get("true_fg"), "bg_ref": c.get("true_bg"),
            "fg_est": getattr(eng, "last_fg", None), "bg_est": getattr(eng, "last_bg", None),
        })
        print(f"  A {eng.name} {c['file']}: cer={rows[-1]['cer']:.3f} {times[-1]:.0f}ms")
    return rows


async def bench_section_b(eng, pages, det_cache):
    from manga_translator.utils import Quadrilateral
    rows = []
    for p in pages:
        page = Image.open(HERE / "images" / p["file"])
        rgb = np.asarray(page)
        if p["file"] not in det_cache:
            det_cache[p["file"]] = await run_ctd(rgb)
        quads = det_cache[p["file"]]
        setattr(eng, "_page_lang", p["lang"])
        for q in quads:  # reset texts
            q.text = ""
        t0 = time.time()
        await eng.rec_quads(rgb, quads)
        dt = (time.time() - t0) * 1000
        matched = 0
        for q in quads:
            box = [q.aabb.x, q.aabb.y, q.aabb.x + q.aabb.w, q.aabb.y + q.aabb.h]
            best, best_iou = None, 0.0
            for ln in p["lines"]:
                v = iou(box, ln["box"])
                if v > best_iou:
                    best, best_iou = ln, v
            if best is None or best_iou < 0.2:
                continue
            matched += 1
            hyp = q.text if isinstance(q.text, str) else "".join(q.text)
            rows.append({
                "section": "B", "engine": eng.name, "page": p["file"],
                "lang": p["lang"], "orient": p["orient"],
                "ref": best["text"], "hyp": hyp,
                "cer": cer(best["text"], hyp, p["lang"]),
                "latency_ms": None,
            })
        print(f"  B {eng.name} {p['file']}: det={len(quads)} matched={matched}/{len(p['lines'])} rec={dt:.0f}ms")
    return rows


async def run_ctd(rgb):
    from manga_translator.detection import dispatch as det_dispatch
    from manga_translator.config import Detector
    t0 = time.time()
    res = await det_dispatch(
        Detector.ctd, rgb, detect_size=1536, text_threshold=0.5,
        box_threshold=0.7, unclip_ratio=1.6, invert=False,
        gamma_correct=False, rotate=False, auto_rotate=False,
        device=DEVICE, verbose=False)
    quads = res[0] if isinstance(res, tuple) else res
    print(f"  [ctd] {len(quads)} lines in {time.time()-t0:.1f}s")
    return quads


def summarize(rows, load_times):
    import collections
    lines = ["# OCR Benchmark Summary", ""]
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    lines.append(f"Generated: {ts}  |  Device: {DEVICE}")
    if load_times:
        lines.append("")
        lines.append("| engine | load time |")
        lines.append("|---|---|")
        for k, v in load_times.items():
            lines.append(f"| {k} | {v:.1f}s |")
    for section, title in (("A", "Section A: rec-only on GT crops (CER ↓ / latency ms/crop)"),
                           ("B", "Section B: pipeline-sim, CTD det + rec (CER on matched lines)")):
        sub = [r for r in rows if r["section"] == section]
        if not sub:
            continue
        lines += ["", f"## {title}", ""]
        groups = collections.defaultdict(list)
        for r in sub:
            groups[(r["engine"], r["lang"], r["orient"])].append(r)
        engines = sorted({r["engine"] for r in sub})
        combos = [("ja", "h"), ("ja", "v"), ("en", "h"), ("en", "v"), ("ko", "h"), ("ko", "v")]
        header = "| engine | " + " | ".join(f"{l}/{o}" for l, o in combos) + " | avg CER | avg ms |"
        lines += [header, "|---|" + "---|" * (len(combos) + 2)]
        for e in engines:
            cells = []
            for l, o in combos:
                rs = groups.get((e, l, o))
                cells.append(f"{statistics.mean(r['cer'] for r in rs):.3f}" if rs else "-")
            ers = [r for r in sub if r["engine"] == e]
            lat = [r["latency_ms"] for r in ers if r["latency_ms"]]
            lat_s = f"{statistics.mean(lat):.0f}" if lat else "-"
            lines.append(f"| {e} | " + " | ".join(cells) +
                         f" | {statistics.mean(r['cer'] for r in ers):.3f} | {lat_s} |")
        # exact match rates
        lines += ["", f"### Exact-match rate ({section})", ""]
        lines.append("| engine | " + " | ".join(f"{l}/{o}" for l, o in combos) + " |")
        lines.append("|---|" + "---|" * len(combos))
        for e in engines:
            cells = []
            for l, o in combos:
                rs = groups.get((e, l, o))
                cells.append(f"{sum(1 for r in rs if norm_text(r['ref'], l) == norm_text(r['hyp'], l))}/{len(rs)}" if rs else "-")
            lines.append(f"| {e} | " + " | ".join(cells) + " |")
        # per-style breakdown (plain is the baseline; color/dark/outline are the
        # same strings rendered differently, so deltas isolate the style factor)
        if section == "A":
            styles = sorted({r.get("style", "plain") for r in sub})
            lines += ["", "### CER by style (A)", ""]
            lines.append("| engine | " + " | ".join(styles) + " |")
            lines.append("|---|" + "---|" * len(styles))
            for e in engines:
                cells = []
                for st in styles:
                    rs = [r for r in sub if r["engine"] == e and r.get("style", "plain") == st]
                    cells.append(f"{statistics.mean(r['cer'] for r in rs):.3f}" if rs else "-")
                lines.append(f"| {e} | " + " | ".join(cells) + " |")
            # 48px font-color estimation accuracy vs ground truth colors
            fc = [r for r in sub if r.get("fg_ref") and r.get("fg_est")]
            if fc:
                lines += ["", "### 48px font-color estimation (A, colored/dark/outline crops)", ""]
                lines.append("| style | mean |RGB| error | n |")
                lines.append("|---|---|---|")
                for st in sorted({r["style"] for r in fc}):
                    rs = [r for r in fc if r["style"] == st]
                    err = statistics.mean(
                        float(np.linalg.norm(np.array(r["fg_est"]) - np.array(r["fg_ref"])))
                        for r in rs)
                    lines.append(f"| {st} | {err:.1f} | {len(rs)} |")
    return "\n".join(lines) + "\n"


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--engines", default="48px,mocr,hayai,paddle")
    ap.add_argument("--sections", default="a,b")
    ap.add_argument("--repeats", type=int, default=3)
    args = ap.parse_args()
    names = [n.strip() for n in args.engines.split(",") if n.strip()]
    sections = {s.strip().lower() for s in args.sections.split(",")}

    crops, pages = load_manifest()
    rows, load_times = [], {}
    det_cache = {}

    for name in names:
        cls = ENGINES.get(name)
        if not cls:
            print(f"skip unknown engine {name}")
            continue
        print(f"=== engine: {name} ===")
        eng = cls()
        try:
            await eng.load()
        except Exception as e:
            print(f"  LOAD FAILED: {e}")
            continue
        load_times[name] = eng.load_s
        if "a" in sections:
            rows += await bench_section_a(eng, crops, args.repeats)
        if "b" in sections:
            rows += await bench_section_b(eng, pages, det_cache)

    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    (LOGS / f"bench_{ts}.json").write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
    (LOGS / f"bench_summary_{ts}.md").write_text(summarize(rows, load_times), encoding="utf-8")
    # csv
    import csv
    with open(LOGS / f"bench_{ts}.csv", "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=["section", "engine", "lang", "orient", "style", "crop", "page",
                                          "ref", "hyp", "cer", "latency_ms", "fg_ref", "fg_est", "bg_ref", "bg_est"])
        w.writeheader()
        for r in rows:
            w.writerow(r)
    print(f"\nSaved: logs/bench_{ts}.json / .csv / bench_summary_{ts}.md")
    print(summarize(rows, load_times))


if __name__ == "__main__":
    asyncio.run(main())
