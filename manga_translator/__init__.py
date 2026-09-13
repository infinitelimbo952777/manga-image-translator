import colorama
from dotenv import load_dotenv

colorama.init(autoreset=True)
load_dotenv()

# Must run before the heavy import below pulls in huggingface_hub/transformers
from ._hf_offline import apply_hf_offline
apply_hf_offline()

from .manga_translator import *
