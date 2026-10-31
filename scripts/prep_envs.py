"""Prepare web-compressed HDRI backgrounds for the chess game.

Pipeline (one-time, sandbox-side):
  1. Download the 2K equirectangular .hdr for each Poly Haven CC0 environment
     (cached in /tmp/envs2 so re-runs skip the network).
  2. Auto-expose + tonemap to display-referred LDR (Narkowicz ACES, matching
     the renderer's tone mapping so the background needs no HDR precision).
  3. Encode as lossy WebP q85 -> public/env/<id>.webp (~0.2-0.5 MB each,
     roughly 1/3 of the previous 1K .hdr.gz payload but at 2x resolution).

Why WebP instead of RGBE .hdr: a 2K .hdr gzips to ~4 MB which is too heavy
for a lazy game asset; LDR WebP keeps the sky crisp and tiny. IBL lighting
runs through the same LDR texture via PMREM — the scene's key/fill/hemisphere
lights dominate the look anyway.

Sources: Poly Haven (polyhaven.com), license CC0 — same license family as
ambientCG where the original request pointed.
"""

import json
import os
import urllib.request

import cv2
import numpy as np
from PIL import Image

IDS = [
    "kloofendal_48d_partly_cloudy",  # partly cloudy day
    "venice_sunset",                 # warm sunset
    "spruit_sunrise",                # misty sunrise
    "kloppenheim_02",                # blue hour dusk
    "brown_photostudio_02",          # indoor studio
    "chinese_garden",                # clear garden day
]

# Per-env exposure scales (derived from the auto formula p92 -> 0.85, then
# graded by eye so each scene keeps its mood: dusk stays dim, garden cools
# off). Unknown ids fall back to the auto-exposure value.
EXPOSURE = {
    "kloofendal_48d_partly_cloudy": 1.18,
    "venice_sunset": 0.88,
    "spruit_sunrise": 1.93,
    "kloppenheim_02": 1.70,
    "brown_photostudio_02": 1.30,
    "chinese_garden": 1.75,
}

CACHE = "/tmp/envs2"
DST = "/home/z/my-project/public/env"
os.makedirs(CACHE, exist_ok=True)
os.makedirs(DST, exist_ok=True)


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "chess-prep/2"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def aces(x: np.ndarray) -> np.ndarray:
    a, b, c, d, e = 2.51, 0.03, 0.59, 0.11, 0.19
    return np.clip((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0)


for env_id in IDS:
    out_path = os.path.join(DST, f"{env_id}.webp")
    cache_path = os.path.join(CACHE, f"{env_id}_2k.hdr")

    if not os.path.exists(cache_path):
        info = json.loads(fetch(f"https://api.polyhaven.com/files/{env_id}"))
        url = info["hdri"]["2k"]["hdr"]["url"]
        print(f"{env_id}: downloading 2k hdr ({info['hdri']['2k']['hdr']['size'] // 1024} KB)…")
        data = fetch(url)
        with open(cache_path, "wb") as f:
            f.write(data)
    else:
        print(f"{env_id}: cached")

    img = cv2.imread(cache_path, cv2.IMREAD_UNCHANGED)
    if img is None:
        print(f"  SKIP: unreadable")
        continue
    # cv2 loads BGR — flip to RGB once, right at the source
    img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    img = np.nan_to_num(img.astype(np.float32), nan=0.0, posinf=0.0, neginf=0.0)
    img = np.clip(img, 0.0, None)

    # Auto-exposure anchor: pull the 92nd-percentile luminance toward ~0.85
    # so skies land in the upper display range without blowing out the sun.
    lum = img @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    p = float(np.quantile(lum, 0.92))
    auto = float(np.clip(0.85 / max(p, 1e-4), 0.4, 14.0))
    scale = EXPOSURE.get(env_id, auto)
    ldr = aces(img * scale)

    # Small saturation lift — ACES desaturates bright areas a little.
    l = ldr @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    ldr = np.clip(l[..., None] + (ldr - l[..., None]) * 1.12, 0.0, 1.0)

    u8 = (ldr * 255.0 + 0.5).astype(np.uint8)
    Image.fromarray(u8).save(out_path, "WEBP", quality=85, method=6)
    print(f"  scale={scale:.2f} -> {out_path} ({os.path.getsize(out_path) // 1024} KB)")

print("done")
