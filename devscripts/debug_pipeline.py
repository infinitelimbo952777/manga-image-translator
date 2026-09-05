"""单图逐阶段诊断：打印 detection/ocr/merge/translation 后的 region 数量与文本，定位流水线断点。"""
import asyncio
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE))

from PIL import Image  # noqa: E402


async def main():
    from manga_translator import MangaTranslator
    from manga_translator.config import Config, Translator

    img_path = Path(sys.argv[1]) if len(sys.argv) > 1 else BASE / "benchmark/input/page02.png"
    translator_name = sys.argv[2] if len(sys.argv) > 2 else "none"

    config = Config()
    config.translator.translator = Translator(translator_name)

    t = MangaTranslator({"use_gpu": True, "kernel_size": 3})

    # 包一层打印各阶段后 ctx 状态
    from manga_translator import MangaTranslator as MT

    stages = ["_run_detection", "_run_ocr", "_run_textline_merge", "_run_text_translation",
              "_run_mask_refinement", "_run_inpainting", "_run_text_rendering"]

    def describe(ctx):
        tl = getattr(ctx, "textlines", None)
        tr = getattr(ctx, "text_regions", None)
        n_tl = len(tl) if tl is not None else None
        n_tr = len(tr) if tr is not None else None
        texts = [r.text for r in (tr or [])][:5]
        return f"textlines={n_tl} regions={n_tr} texts={texts}"

    for attr in stages:
        orig = getattr(MT, attr)

        async def wrapper(self, config, ctx, _orig=orig, _attr=attr):
            r = await _orig(self, config, ctx)
            print(f"after {_attr:<22} {describe(ctx)}")
            return r

        setattr(MT, attr, wrapper)

    img = Image.open(img_path)
    ctx = await t.translate(img, config, skip_context_save=True)
    print(f"FINAL: {describe(ctx)} | result={'yes' if ctx.result is not None else 'no'}")


asyncio.run(main())
