from .kumikolib import Kumiko
import tempfile, cv2, os

def get_panels_from_array(img_rgb, rtl=True, downscale: int = 1):
    """
    downscale: integer factor. >1 runs panel detection on a 1/downscale resized
    copy and maps detected panel rects back to full resolution. Panel detection
    (Kumiko/LSD) dominates textline_merge cost, so this trades a little
    detection fidelity for a large speedup.
    """
    if img_rgb is None:
        return []

    if downscale > 1:
        h, w = img_rgb.shape[:2]
        small = cv2.resize(img_rgb, (max(1, w // downscale), max(1, h // downscale)), interpolation=cv2.INTER_AREA)
    else:
        small = img_rgb

    tmp = tempfile.NamedTemporaryFile(suffix='.png', delete=False)
    path = tmp.name
    tmp.close()

    try:
        cv2.imwrite(path, small)

        k = Kumiko({'rtl': rtl})
        k.parse_image(path)
        infos = k.get_infos()
        panels = infos[0]['panels']
    finally:
        os.unlink(path)

    if downscale > 1:
        panels = [(x * downscale, y * downscale, w * downscale, h * downscale) for x, y, w, h in panels]

    return panels