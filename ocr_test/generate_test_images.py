# -*- coding: utf-8 -*-
"""
Generate synthetic manga-style OCR benchmark images:
  languages: en / ja / ko  x  orientations: h (horizontal) / v (vertical)
  styles:    plain (black on white)  <- baseline
             color (solid colored text on white: red/blue/yellow/pink)
             dark  (white/yellow text on dark bubble background)
             outline (white text with black stroke, SFX style)

Each page has 4 text lines; ground truth (page + per-line boxes) is saved to
ground_truth.json, and per-line crops (with GT text) to crops/ + crops/manifest.json.
The color/dark/outline pages reuse the exact same strings and layout as the
plain pages, so CER differences isolate the color/style factor.

Usage:  python ocr_test/generate_test_images.py
"""
import json
import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
IMAGES_DIR = HERE / "images"
CROPS_DIR = HERE / "crops"
IMAGES_DIR.mkdir(exist_ok=True)
CROPS_DIR.mkdir(exist_ok=True)

PAGE_W, PAGE_H = 1000, 760
BG_PLAIN = (250, 250, 250)
FG_PLAIN = (15, 15, 15)

STYLE_COLORS = [  # one per line, cycling
    ((220, 60, 60), "red"),
    ((70, 100, 225), "blue"),
    ((235, 190, 45), "yellow"),
    ((235, 125, 175), "pink"),
]
DARK_BG = (38, 40, 52)
DARK_FGS = [((242, 242, 242), "white"), ((238, 200, 85), "gold")]
OUTLINE_FILL = (248, 248, 248)
OUTLINE_STROKE = (25, 25, 25)

FONTS = {
    "ja": [r"C:\Windows\Fonts\msgothic.ttc", r"C:\Windows\Fonts\YuGothM.ttc"],
    "ko": [r"C:\Windows\Fonts\malgun.ttf"],
    "en": [r"C:\Windows\Fonts\arial.ttf"],
}


def pick_font(lang: str, size: int):
    for p in FONTS[lang]:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except OSError:
                continue
    raise RuntimeError(f"No font found for lang={lang}")

# --- realistic manga-style test strings (avoid exotic glyphs not in core fonts) ---

JA_H = [
    "今日はいい天気だね",
    "俺は絶対に諦めない",
    "明日の朝、駅前に集合してください",
    "これは何ですか？",
]
JA_V = [
    "これは運命の出会いかもしれない",
    "彼女は静かに首を縦に振った",
    "今夜はラーメンに決めた",
    "その時、空から光が降り注いだ",
]
KO_H = [
    "오늘 날씨가 정말 좋네요",
    "나는 절대 포기하지 않아",
    "내일 아침 역 앞에서 만나자",
    "이게 무슨 일이야?",
]
KO_V = [
    "그것은 운명적인 만남일지도 몰라",
    "그녀는 조용히 고개를 끄덕였다",
    "그때 하늘에서 빛이 쏟아졌다",
    "자, 가자. 새로운 세계로",
]
EN_H = [
    "I will never give up!",
    "What time is the meeting today?",
    "She quietly nodded her head.",
    "The sky is the limit, kid.",
]
EN_V = [
    "Don't move! Stay right there!",
    "This power is unbelievable...",
    "Are you really the chosen one?",
    "Let's finish this once and for all.",
]

# (file, lang, orient, lines, style)
PAGES = [
    ("ja_h_0", "ja", "h", JA_H, "plain"),
    ("ja_h_1", "ja", "h", JA_H[::-1], "plain"),
    ("ja_v_0", "ja", "v", JA_V, "plain"),
    ("ja_v_1", "ja", "v", JA_V[::-1], "plain"),
    ("ko_h_0", "ko", "h", KO_H, "plain"),
    ("ko_h_1", "ko", "h", KO_H[::-1], "plain"),
    ("ko_v_0", "ko", "v", KO_V, "plain"),
    ("ko_v_1", "ko", "v", KO_V[::-1], "plain"),
    ("en_h_0", "en", "h", EN_H, "plain"),
    ("en_h_1", "en", "h", EN_H[::-1], "plain"),
    ("en_v_0", "en", "v", EN_V, "plain"),
    ("en_v_1", "en", "v", EN_V[::-1], "plain"),
]
for lang in ("ja", "ko", "en"):
    hs = globals()[f"{lang.upper()}_H"]
    vs = globals()[f"{lang.upper()}_V"]
    PAGES += [
        (f"{lang}_h_c0", lang, "h", hs, "color"),
        (f"{lang}_v_c0", lang, "v", vs, "color"),
        (f"{lang}_h_d0", lang, "h", hs, "dark"),
        (f"{lang}_v_d0", lang, "v", vs, "dark"),
        (f"{lang}_h_o0", lang, "h", hs, "outline"),
        (f"{lang}_v_o0", lang, "v", vs, "outline"),
    ]

SIZES = [30, 34, 38, 32]
PAD = 6


def line_style(style: str, i: int):
    """Returns (bg, fill, stroke_fill, stroke_width, fg_name)."""
    if style == "color":
        fg, name = STYLE_COLORS[i % len(STYLE_COLORS)]
        return BG_PLAIN, fg, None, 0, name
    if style == "dark":
        fg, name = DARK_FGS[i % len(DARK_FGS)]
        return DARK_BG, fg, None, 0, name
    if style == "outline":
        return BG_PLAIN, OUTLINE_FILL, OUTLINE_STROKE, 2, "white+black_stroke"
    return BG_PLAIN, FG_PLAIN, None, 0, "black"


def draw_h_line(draw, text, font, x, y, fill, stroke_fill=None, stroke_width=0):
    kw = {} if not stroke_fill else {"stroke_width": stroke_width, "stroke_fill": stroke_fill}
    bbox_kw = {"stroke_width": stroke_width} if stroke_fill else {}
    draw.text((x, y), text, font=font, fill=fill, **kw)
    l, t, r, b = draw.textbbox((x, y), text, font=font, **bbox_kw)
    return (l, t, r, b)


def draw_v_column(draw, text, font, cx, y0, img, fill, stroke_fill=None, stroke_width=0):
    """Stack characters top->bottom centered on column axis cx. Returns bbox.
    Long-vowel mark / wave dash are rotated 90deg like real vertical typesetting."""
    kw = {} if not stroke_fill else {"stroke_width": stroke_width, "stroke_fill": stroke_fill}
    bbox_kw = {"stroke_width": stroke_width} if stroke_fill else {}
    cy = y0
    min_x, min_y, max_x, max_y = cx, y0, cx, y0
    step = font.size + 4
    for ch in text:
        if ch in ("ー", "～"):
            l, t, r, b = draw.textbbox((0, 0), ch, font=font, **bbox_kw)
            gw, gh = r - l + 2, b - t + 2
            pad = stroke_width + 2
            tmp = Image.new("RGBA", (gw + pad * 2, gh + pad * 2), (0, 0, 0, 0))
            ImageDraw.Draw(tmp).text((pad - l, pad - t), ch, font=font, fill=fill + (255,), **kw)
            rot = tmp.rotate(90, expand=True)
            px = int(cx - rot.width / 2)
            img.paste(rot, (px, int(cy)), rot)
            min_x, min_y = min(min_x, px), min(min_y, cy)
            max_x, max_y = max(max_x, px + rot.width), max(max_y, cy + rot.height)
            cy += step
        else:
            l, t, r, b = draw.textbbox((cx, cy), ch, font=font, anchor="ma", **bbox_kw)
            draw.text((cx, cy), ch, font=font, fill=fill, anchor="ma", **kw)
            min_x, min_y = min(min_x, l), min(min_y, t)
            max_x, max_y = max(max_x, r), max(max_y, b)
            cy += step
    return (min_x, min_y, max_x, max_y)


def main():
    gt = {"pages": []}
    crops_manifest = []
    for fname, lang, orient, lines, style in PAGES:
        bg = DARK_BG if style == "dark" else BG_PLAIN
        img = Image.new("RGB", (PAGE_W, PAGE_H), bg)
        draw = ImageDraw.Draw(img)
        page_lines = []
        if orient == "h":
            y = 90
            for i, text in enumerate(lines):
                font = pick_font(lang, SIZES[i % len(SIZES)])
                _bg, fill, stroke_fill, sw, fg_name = line_style(style, i)
                box = draw_h_line(draw, text, font, 80, y, fill, stroke_fill, sw)
                page_lines.append({"text": text, "box": [int(v) for v in box],
                                   "style": style, "fg": fg_name})
                y += int(SIZES[i % len(SIZES)] * 1.9) + 40
        else:  # vertical: columns right -> left
            x = PAGE_W - 110
            for i, text in enumerate(lines):
                font = pick_font(lang, SIZES[i % len(SIZES)])
                _bg, fill, stroke_fill, sw, fg_name = line_style(style, i)
                box = draw_v_column(draw, text, font, x, 70, img, fill, stroke_fill, sw)
                page_lines.append({"text": text, "box": [int(v) for v in box],
                                   "style": style, "fg": fg_name})
                x -= int(SIZES[i % len(SIZES)] * 1.25) + 30
        path = IMAGES_DIR / f"{fname}.png"
        img.save(path)
        gt["pages"].append({
            "file": path.name, "lang": lang, "orient": orient, "style": style,
            "text": "\n".join(lines), "lines": page_lines,
        })
        # line crops (same pixels as the page, tight bbox + pad)
        for k, line in enumerate(page_lines):
            x0, y0, x1, y1 = line["box"]
            crop = img.crop((max(0, x0 - PAD), max(0, y0 - PAD),
                             min(PAGE_W, x1 + PAD), min(PAGE_H, y1 + PAD)))
            cpath = CROPS_DIR / f"{fname}_L{k}.png"
            crop.save(cpath)
            entry = {
                "file": cpath.name, "page": path.name, "lang": lang,
                "orient": orient, "style": style, "text": line["text"],
            }
            # reference fg color for color-accuracy checks
            if style == "color":
                entry["true_fg"] = list(STYLE_COLORS[k % len(STYLE_COLORS)][0])
            elif style == "dark":
                entry["true_fg"] = list(DARK_FGS[k % len(DARK_FGS)][0])
                entry["true_bg"] = list(DARK_BG)
            elif style == "outline":
                entry["true_fg"] = list(OUTLINE_FILL)
                entry["true_bg"] = list(OUTLINE_STROKE)
            crops_manifest.append(entry)
    (HERE / "ground_truth.json").write_text(
        json.dumps(gt, ensure_ascii=False, indent=2), encoding="utf-8")
    (CROPS_DIR / "manifest.json").write_text(
        json.dumps({"crops": crops_manifest}, ensure_ascii=False, indent=2),
        encoding="utf-8")
    n = len(PAGES)
    print(f"Generated {n} pages, {len(crops_manifest)} line crops -> {IMAGES_DIR}")


if __name__ == "__main__":
    main()
