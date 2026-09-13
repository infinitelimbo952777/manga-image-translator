"""Enable HuggingFace offline mode when the models are already cached.

MUST be applied before huggingface_hub/transformers are imported anywhere:
both libraries read HF_HUB_OFFLINE / TRANSFORMERS_OFFLINE into their
constants at import time, so setting the env vars later has no effect.

Why: from_pretrained does a HEAD etag check against huggingface.co on every
load. When HF is unreachable, each file burns ~30s of connect retries
(5 attempts) before falling back to the cache — model load stalls for
minutes with the translation progress frozen. With the models cached,
skipping the network entirely makes loading instant.

Fresh installs (cache empty) keep online downloads working; users can
force a re-check with HF_HUB_OFFLINE=0 / TRANSFORMERS_OFFLINE=0 in .env.
"""

import os
from pathlib import Path


def _hf_cache_has(*repo_ids: str) -> bool:
    hub = Path(os.environ.get('HF_HUB_CACHE', Path.home() / '.cache' / 'huggingface' / 'hub'))
    for repo_id in repo_ids:
        snaps = hub / f'models--{repo_id.replace("/", "--")}' / 'snapshots'
        if not snaps.is_dir() or not any(snaps.iterdir()):
            return False
    return True


def apply_hf_offline() -> None:
    # hayai OCR loads these two repos via from_pretrained (ocr/model_hayai.py)
    if _hf_cache_has('google/siglip2-base-patch16-naflex', 'JustANormalTinkerer/hayai-ocr-v2'):
        os.environ.setdefault('HF_HUB_OFFLINE', '1')
        os.environ.setdefault('TRANSFORMERS_OFFLINE', '1')
