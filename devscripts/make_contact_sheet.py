"""生成 result/ 下所有唯一 input.png 的抽样缩略图总览，用于挑选性能测试输入。"""
from PIL import Image, ImageDraw
import glob
import hashlib
import random

seen = {}
files = sorted(glob.glob("result/*/input.png"))
for f in files:
    h = hashlib.md5(open(f, "rb").read()).hexdigest()
    seen.setdefault(h, []).append(f)
uniq = list(seen.items())
print(f"total files: {len(files)}, unique: {len(uniq)}")

random.seed(42)
sample = random.sample(uniq, min(24, len(uniq)))
cols = 6
rows = (len(sample) + cols - 1) // cols
cw, ch = 330, 250
sheet = Image.new("RGB", (cols * cw, rows * ch), "white")
d = ImageDraw.Draw(sheet)
for i, (h, fs) in enumerate(sample):
    im = Image.open(fs[0]).convert("RGB")
    im.thumbnail((320, 205))
    x, y = (i % cols) * cw, (i // cols) * ch
    sheet.paste(im, (x + 5, y + 40))
    label = fs[0].replace("\\", "/").split("/")[-2][:36]
    d.text((x + 5, y + 5), label, fill="black")
sheet.save("benchmark/contact_sheet.jpg", quality=75)
print("saved benchmark/contact_sheet.jpg")
