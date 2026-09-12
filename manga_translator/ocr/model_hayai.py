import os

# HayaiOcr calls torch.compile in its constructor; inductor is unreliable on
# Windows, so disable dynamo before the model is constructed.
os.environ.setdefault('TORCHDYNAMO_DISABLE', '1')

import numpy as np
from PIL import Image

import torch

from .common import OfflineOCR
from .model_48px import OCR
from .model_manga_ocr import merge_bboxes
from ..config import OcrConfig
from ..utils import TextBlock, Quadrilateral, chunks


class ModelHayaiOCR(OfflineOCR):
    """
    Hayai OCR v2 (SigLIP2 NaFlex + char-level decoder, ~150M params) for text,
    with the 48px model supplying font colors / confidence, mirroring
    ModelMangaOCR. Supports Japanese, Chinese, Korean and English crops
    (horizontal and vertical) natively.

    Model weights are pulled from HuggingFace (JustANormalTinkerer/hayai-ocr-v2)
    into the standard HF cache on first use.
    """
    _MODEL_MAPPING = {
        'model': {
            'url': 'https://github.com/zyddnys/manga-image-translator/releases/download/beta-0.3/ocr_ar_48px.ckpt',
            'hash': '29daa46d080818bb4ab239a518a88338cbccff8f901bef8c9db191a7cb97671d',
        },
        'dict': {
            'url': 'https://github.com/zyddnys/manga-image-translator/releases/download/beta-0.3/alphabet-all-v7.txt',
            'hash': 'f5722368146aa0fbcc9f4726866e4efc3203318ebb66c811d8cbbe915576538a',
        },
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)

    async def _load(self, device: str):
        with open(self._get_file_path('alphabet-all-v7.txt'), 'r', encoding='utf-8') as fp:
            dictionary = [s[:-1] for s in fp.readlines()]

        from hayai_ocr import HayaiOcr
        self.model = OCR(dictionary, 768)
        self.hayai = HayaiOcr()
        sd = torch.load(self._get_file_path('ocr_ar_48px.ckpt'))
        self.model.load_state_dict(sd)
        self.model.eval()
        self.device = device
        self.use_gpu = device in ('cuda', 'mps')
        if self.use_gpu:
            self.model = self.model.to(device)

    async def _unload(self):
        del self.model
        del self.hayai

    async def _infer(self, image: np.ndarray, textlines: list, config: OcrConfig, verbose: bool = False, ignore_bubble: int = 0) -> list:
        text_height = 48
        max_chunk_size = 16

        quadrilaterals = list(self._generate_text_direction(textlines))
        region_imgs = [q.get_transformed_region(image, d, text_height) for q, d in quadrilaterals]

        perm = range(len(region_imgs))
        is_quadrilaterals = False
        if len(quadrilaterals) > 0 and isinstance(quadrilaterals[0][0], Quadrilateral):
            perm = sorted(range(len(region_imgs)), key=lambda x: region_imgs[x].shape[1])
            is_quadrilaterals = True

        # hayai reads whole regions (multi-line aware), so prefer merged regions
        if config.use_mocr_merge:
            merged_textlines, merged_idx = await merge_bboxes(textlines, image.shape[1], image.shape[0])
            merged_quadrilaterals = list(self._generate_text_direction(merged_textlines))
        else:
            merged_idx = [[i] for i in range(len(region_imgs))]
            merged_quadrilaterals = quadrilaterals
        merged_region_imgs = []
        for q, d in merged_quadrilaterals:
            if d == 'v':
                # force 'h' render with the long side as textheight -> upright
                # vertical column at natural size (hayai reads these natively)
                merged_region_imgs.append(q.get_transformed_region(image, 'h', q.aabb.h))
            else:
                # horizontal strip at manga-crop scale (hayai's training domain)
                merged_region_imgs.append(q.get_transformed_region(image, 'h', 64))

        # batched text recognition
        pil_imgs = [Image.fromarray(r) for r in merged_region_imgs]
        texts = self.hayai(pil_imgs) if pil_imgs else []
        if isinstance(texts, str):
            texts = [texts]

        # 48px pass only for font colors / probability (same as ModelMangaOCR)
        ix = 0
        out_regions = {}
        for indices in chunks(perm, max_chunk_size):
            N = len(indices)
            widths = [region_imgs[i].shape[1] for i in indices]
            max_width = 4 * (max(widths) + 7) // 4
            region = np.zeros((N, text_height, max_width, 3), dtype=np.uint8)
            idx_keys = []
            for i, idx in enumerate(indices):
                idx_keys.append(idx)
                W = region_imgs[idx].shape[1]
                region[i, :, : W, :] = region_imgs[idx]
                ix += 1
            image_tensor = (torch.from_numpy(region).float() - 127.5) / 127.5
            image_tensor = image_tensor.permute(0, 3, 1, 2)
            if self.use_gpu:
                image_tensor = image_tensor.to(self.device)
            with torch.no_grad():
                ret = self.model.infer_beam_batch(image_tensor, widths, beams_k=5, max_seq_length=255)
            for i, (pred_chars_index, prob, fg_pred, bg_pred, fg_ind_pred, bg_ind_pred) in enumerate(ret):
                if prob < 0.2:
                    continue
                has_fg = (fg_ind_pred[:, 1] > fg_ind_pred[:, 0])
                has_bg = (bg_ind_pred[:, 1] > bg_ind_pred[:, 0])
                fr, fg, fb = [], [], []
                br, bg, bb = [], [], []
                for chid, c_fg, c_bg, h_fg, h_bg in zip(pred_chars_index, fg_pred, bg_pred, has_fg, has_bg):
                    if h_fg.item():
                        fr.append(int(c_fg[0] * 255)); fg.append(int(c_fg[1] * 255)); fb.append(int(c_fg[2] * 255))
                    if h_bg.item():
                        br.append(int(c_bg[0] * 255)); bg.append(int(c_bg[1] * 255)); bb.append(int(c_bg[2] * 255))
                    else:
                        br.append(int(c_fg[0] * 255)); bg.append(int(c_fg[1] * 255)); bb.append(int(c_fg[2] * 255))
                fr = min(max(int(np.mean(fr)) if fr else 0, 0), 255)
                fg = min(max(int(np.mean(fg)) if fg else 0, 0), 255)
                fb = min(max(int(np.mean(fb)) if fb else 0, 0), 255)
                br = min(max(int(np.mean(br)) if br else 0, 0), 255)
                bg = min(max(int(np.mean(bg)) if bg else 0, 0), 255)
                bb = min(max(int(np.mean(bb)) if bb else 0, 0), 255)
                cur_region = quadrilaterals[indices[i]][0]
                if isinstance(cur_region, Quadrilateral):
                    cur_region.prob = prob
                    cur_region.fg_r = fr
                    cur_region.fg_g = fg
                    cur_region.fg_b = fb
                    cur_region.bg_r = br
                    cur_region.bg_g = bg
                    cur_region.bg_b = bb
                else:
                    cur_region.update_font_colors(np.array([fr, fg, fb]), np.array([br, bg, bb]))
                out_regions[idx_keys[i]] = cur_region

        output_regions = []
        for i, nodes in enumerate(merged_idx):
            total_logprobs = 0
            total_area = 0
            fg_r, fg_g, fg_b = [], [], []
            bg_r, bg_g, bg_b = [], [], []

            for idx in nodes:
                if idx not in out_regions:
                    continue
                region_out = out_regions[idx]
                total_logprobs += np.log(region_out.prob) * region_out.area
                total_area += region_out.area
                fg_r.append(region_out.fg_r)
                fg_g.append(region_out.fg_g)
                fg_b.append(region_out.fg_b)
                bg_r.append(region_out.bg_r)
                bg_g.append(region_out.bg_g)
                bg_b.append(region_out.bg_b)

            if total_area > 0:
                total_logprobs /= total_area
                prob = np.exp(total_logprobs)
            else:
                prob = 0.0
            fr = round(np.mean(fg_r)) if fg_r else 0
            fg = round(np.mean(fg_g)) if fg_g else 0
            fb = round(np.mean(fg_b)) if fg_b else 0
            br = round(np.mean(bg_r)) if bg_r else 0
            bg = round(np.mean(bg_g)) if bg_g else 0
            bb = round(np.mean(bg_b)) if bg_b else 0

            txt = texts[i]
            self.logger.info(f'prob: {prob} {txt} fg: ({fr}, {fg}, {fb}) bg: ({br}, {bg}, {bb})')
            cur_region = merged_quadrilaterals[i][0]
            if isinstance(cur_region, Quadrilateral):
                cur_region.text = txt
                cur_region.prob = prob
                cur_region.fg_r = fr
                cur_region.fg_g = fg
                cur_region.fg_b = fb
                cur_region.bg_r = br
                cur_region.bg_g = bg
                cur_region.bg_b = bb
            else:  # TextBlock
                cur_region.text.append(txt)
                cur_region.update_font_colors(np.array([fr, fg, fb]), np.array([br, bg, bb]))
            output_regions.append(cur_region)

        if is_quadrilaterals:
            return output_regions
        return textlines
