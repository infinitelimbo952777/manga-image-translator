# -*- coding: utf-8 -*-
"""OCR beam-search regression: dump infer_beam_batch_tensor outputs bitwise.

Usage:
    python devscripts/ocr_regression.py <output.json>

Deterministic synthetic inputs (fixed seed) are fed through the real 48px
model on CUDA. Token ids, probabilities and raw output tensors are hashed so
pre/post optimization runs can be compared bit-for-bit.
"""
import asyncio
import hashlib
import json
import sys

import numpy as np
import torch

sys.path.insert(0, '.')

from manga_translator.config import Ocr  # noqa: E402
from manga_translator.ocr import prepare, get_ocr  # noqa: E402

SEED = 20260906
TRIALS = 3
N = 16


def tensor_sig(t: torch.Tensor) -> dict:
    t = t.detach()
    cpu = t.cpu()
    return {
        'shape': list(t.shape),
        'md5': hashlib.md5(cpu.contiguous().numpy().tobytes()).hexdigest(),
        'fsum': float(cpu.float().sum()),
    }


async def main(out_path: str) -> None:
    await prepare(Ocr.ocr48px, 'cuda')
    ocr = get_ocr(Ocr.ocr48px)
    model = ocr.model
    device = next(model.parameters()).device
    print(f'model device: {device}', flush=True)

    rng = np.random.default_rng(SEED)
    records = []
    for trial in range(TRIALS):
        widths = rng.integers(20, 220, size=N).tolist()
        max_w = max(widths)
        img = rng.integers(0, 255, size=(N, 48, max_w, 3), dtype=np.uint8)
        t = (torch.from_numpy(img).float() - 127.5) / 127.5
        t = t.permute(0, 3, 1, 2).to(device)
        with torch.no_grad():
            ret = model.infer_beam_batch_tensor(t, widths, beams_k=5, max_seq_length=255)
        for i, (idx, prob, fg, bg, fgi, bgi) in enumerate(ret):
            records.append({
                'trial': trial,
                'i': i,
                'width': widths[i],
                'tokens': idx.detach().cpu().tolist(),
                'prob': prob,
                'fg': tensor_sig(fg),
                'bg': tensor_sig(bg),
                'fg_ind': tensor_sig(fgi),
                'bg_ind': tensor_sig(bgi),
            })
        print(f'trial {trial}: {len(ret)} hypotheses dumped', flush=True)

    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(records, f, ensure_ascii=False, indent=1)
    print(f'written: {out_path} ({len(records)} records)')


if __name__ == '__main__':
    asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else 'ocr_reg.json'))
