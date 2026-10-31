#!/usr/bin/env python3
"""
Procedural abstract-art equirectangular (360x180) backgrounds for the chess
game. Everything is generated from seeded numpy noise -- no external assets,
so these textures are effectively CC0 (owned by the project).

Output: public/env/<id>.webp  (2048x1024, sRGB, WebP q85 -- same pipeline
shape as the tonemapped Poly Haven set, so environments.ts just lists them).

Guarantees enforced by construction + an assert per image:
- seamless horizontal wrap (all noise lattices and blob stamps are periodic
  in x; left and right edge columns are identical to within quantization)
- LDR output in [0,1] with a filmic shoulder on emissive-heavy scenes
"""

import numpy as np
from PIL import Image, ImageDraw, ImageFont

W, H = 2048, 1024
OUT = "/home/z/my-project/public/env"

UU = np.tile((np.arange(W, dtype=np.float32) + 0.5) / W, (H, 1))  # u in [0,1)
VV = np.repeat((np.arange(H, dtype=np.float32) + 0.5) / H, W).reshape(H, W)

# ── noise toolkit (periodic in x) ───────────────────────────────────────────


def _smooth(t):
    return t * t * (3.0 - 2.0 * t)


def sample(gx, gy, seed, X, Y):
    """Bilinear value noise. X in cell units, wraps modulo gx; Y clips."""
    rng = np.random.default_rng(seed)
    grid = rng.random((gy + 1, gx), dtype=np.float32)
    x0f = np.floor(X)
    fx = _smooth(X - x0f)
    x0m = x0f.astype(np.int32) % gx
    x1m = (x0m + 1) % gx
    y0f = np.floor(Y)
    fy = _smooth(np.clip(Y - y0f, 0.0, 1.0))
    y0 = np.clip(y0f.astype(np.int32), 0, gy)
    y1 = np.minimum(y0 + 1, gy)
    g00 = grid[y0, x0m]
    g01 = grid[y0, x1m]
    g10 = grid[y1, x0m]
    g11 = grid[y1, x1m]
    top = g00 + (g01 - g00) * fx
    bot = g10 + (g11 - g10) * fx
    return top + (bot - top) * fy


def fbm(u, v, base, octaves, seed, gain=0.5):
    """fBm over full-res (H, W) coordinate fields. gy = gx/2 keeps square cells."""
    acc = np.zeros((H, W), dtype=np.float32)
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        gx = base << o
        acc += amp * sample(gx, max(1, gx >> 1), seed * 131 + o, u * gx, v * (gx >> 1))
        tot += amp
        amp *= gain
    return acc / tot


def noise1d(gx, seed, octaves=3):
    """Smooth 1D noise over x, periodic with period 1. Returns (W,)."""
    acc = np.zeros(W, dtype=np.float32)
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        g = gx << o
        rng = np.random.default_rng(seed * 17 + o)
        grid = rng.random(g + 1, dtype=np.float32)
        grid[g] = grid[0]
        x = (np.arange(W, dtype=np.float32) + 0.5) / W * g
        x0f = np.floor(x)
        fx = _smooth(x - x0f)
        x0 = x0f.astype(np.int32) % g
        x1 = (x0 + 1) % g
        acc += amp * (grid[x0] * (1 - fx) + grid[x1] * fx)
        tot += amp
        amp *= 0.5
    return acc / tot


def blob(img, cu, cv, su, sv, color, strength):
    """Wrapped-in-x gaussian blob added onto img (float HxWx3)."""
    du = np.abs(UU - cu)
    du = np.minimum(du, 1.0 - du)
    dv = VV - cv
    g = np.exp(-(du * du) / (2 * su * su) - (dv * dv) / (2 * sv * sv)).astype(np.float32)
    img += (strength * g)[..., None] * np.asarray(color, dtype=np.float32)


def stars(img, n, seed, bright=1.0, big=5):
    """Point stars (small gaussian stamps) + a few soft glow stars."""
    rng = np.random.default_rng(seed)
    for _ in range(n):
        cx, cy = rng.random(), 0.04 + 0.90 * rng.random()
        px, py = int(cx * W), int(cy * H)
        r = int(rng.uniform(1, 3))
        b = bright * float(rng.uniform(0.25, 1.0)) ** 2
        y0, y1 = max(0, py - r), min(H, py + r + 1)
        yy = np.arange(y0, y1, dtype=np.float32)[:, None]
        for dx in range(-r, r + 1):
            xx = (px + dx) % W
            g = np.exp(-(dx * dx + (yy - py) ** 2) / (2 * (r / 1.6) ** 2)).ravel()
            img[y0:y1, xx] += (b * g)[:, None] * np.float32([0.9, 0.92, 1.0])
    for _ in range(big):
        cu, cv = rng.random(), 0.10 + 0.65 * rng.random()
        blob(img, cu, cv, 0.004, 0.008, [0.85, 0.9, 1.0], bright * 0.55)


def filmic(c):
    """Soft highlight shoulder; keeps LDR even with emissive cores."""
    return 1.0 - np.exp(-c)


def vgrad(stops):
    """Vertical gradient from (v, rgb) stops -> (H, W, 3)."""
    vs = np.array([s[0] for s in stops], dtype=np.float32)
    cs = np.array([s[1] for s in stops], dtype=np.float32)
    t = np.interp(VV.ravel(), vs, np.arange(len(stops), dtype=np.float32))
    i0 = np.floor(t).astype(np.int32)
    i1 = np.minimum(i0 + 1, len(stops) - 1)
    f = (t - i0)[..., None]
    out = cs[i0] * (1 - f) + cs[i1] * f
    return out.reshape(H, W, 3).astype(np.float32)


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return _smooth(t)


def seam_check(img, name):
    d = np.abs(img[:, 0] - img[:, -1]).max()
    assert d < 0.02, f"{name}: seam delta {d:.4f}"
    return d


def save(img, name):
    img = np.clip(img, 0.0, 1.0)
    seam = seam_check(img, name)
    im = Image.fromarray((img * 255).astype(np.uint8))
    path = f"{OUT}/{name}.webp"
    im.save(path, "WEBP", quality=85, method=6)
    import os

    kb = os.path.getsize(path) / 1024
    print(f"{name:14s} {kb:7.0f} KB   seam {seam:.4f}")
    return img


# ── environments ────────────────────────────────────────────────────────────


def nebula_drift():
    w1 = fbm(UU, VV, 3, 4, 11)
    w2 = fbm(UU, VV, 3, 4, 12)
    u2, v2 = UU + 0.35 * (w1 - 0.5), VV + 0.28 * (w2 - 0.5)
    dens = fbm(u2, v2, 4, 5, 13)
    # NOTE: the in-match camera sees equirect rows v≈0.60–0.83 (below the
    # horizon), so the main composition lives in that band; a faint echo band
    # stays in the sky half for low-orbit views.
    band = np.exp(-(((VV - (0.66 + 0.08 * np.sin(2 * np.pi * UU + 1.0))) / 0.10) ** 2))
    band2 = np.exp(-(((VV - (0.28 + 0.06 * np.sin(2 * np.pi * UU + 2.2))) / 0.07) ** 2))
    neb = dens * (0.30 + 0.95 * band) + 0.45 * dens * band2
    hue = fbm((u2 + 0.13) % 1.0, v2, 3, 3, 14)
    c_purple = np.float32([0.28, 0.14, 0.50])
    c_mag = np.float32([0.80, 0.28, 0.55])
    c_teal = np.float32([0.16, 0.58, 0.68])
    col = np.where(hue[..., None] < 0.5, c_purple + (c_mag - c_purple) * (hue[..., None] * 2), c_mag + (c_teal - c_mag) * ((hue[..., None] - 0.5) * 2))
    img = np.float32([0.012, 0.012, 0.032]) + col * (neb * 1.25)[..., None]
    blob(img, 0.62, 0.66, 0.050, 0.100, [1.0, 0.93, 0.86], 1.25)  # galaxy core
    blob(img, 0.15, 0.74, 0.160, 0.320, [0.10, 0.20, 0.50], 0.35)  # faint blue field
    blob(img, 0.85, 0.78, 0.090, 0.180, [0.45, 0.15, 0.50], 0.30)  # magenta wisp
    blob(img, 0.40, 0.28, 0.060, 0.120, [0.60, 0.30, 0.70], 0.35)  # sky echo wisp
    stars(img, 460, 15, bright=1.0, big=6)
    return filmic(img)


def aurora_veil():
    img = vgrad(
        [
            (0.00, (0.015, 0.030, 0.080)),
            (0.25, (0.030, 0.055, 0.110)),
            (0.46, (0.060, 0.090, 0.150)),
            (0.52, (0.030, 0.045, 0.060)),
            (1.00, (0.020, 0.030, 0.042)),
        ]
    )
    streak = sample(24, 2, 52, UU * 24, VV * 2)  # tall cells -> vertical rays
    streak = streak ** 1.4
    green = np.float32([0.15, 0.95, 0.45])
    teal = np.float32([0.20, 0.85, 0.80])
    purple = np.float32([0.50, 0.28, 0.85])
    for i, base_v in enumerate([0.615, 0.700, 0.780]):
        yc = base_v + 0.040 * noise1d(3 + 2 * i, 61 + i) + 0.020 * noise1d(7 + 3 * i, 65 + i)
        dv = VV - yc[None, :]
        width = 0.042 - 0.006 * i
        # aurora ribbons: sharp upper edge, soft falloff downward, art band
        # v 0.53–0.86 (the part of the sphere the match camera actually sees)
        amp = np.where(dv > 0, np.exp(-((dv / (0.55 * width)) ** 2)), np.exp(-((dv / (1.45 * width)) ** 2)))
        amp = amp * (0.35 + 0.85 * np.roll(streak, i * 211, axis=1))
        amp *= smoothstep(0.955, 0.87, VV) * smoothstep(0.495, 0.53, VV) * (1.15 - 0.22 * i)
        mix_out = np.clip(dv / (width * 1.6), -0.5, 1.0)[..., None]
        col = np.where(mix_out < 0.35, green + (teal - green) * (np.clip(mix_out, 0, 0.35) / 0.35 + 0.5 * (mix_out < 0)), teal + (purple - teal) * ((mix_out - 0.35) / 0.65))
        col = np.clip(col, 0, 1)
        img += (amp * 1.45)[..., None] * col
    stars(img, 240, 71, bright=0.8, big=3)
    return np.clip(filmic(img * 1.1), 0, 1)


def neon_grid():
    img = vgrad(
        [
            (0.00, (0.045, 0.010, 0.115)),
            (0.30, (0.115, 0.025, 0.215)),
            (0.47, (0.280, 0.060, 0.360)),
            (0.52, (0.030, 0.012, 0.060)),
            (1.00, (0.012, 0.006, 0.030)),
        ]
    )
    # sun orb with warm core over magenta halo (visible band v≈0.62)
    blob(img, 0.50, 0.620, 0.052, 0.104, [1.00, 0.42, 0.55], 1.10)
    blob(img, 0.50, 0.620, 0.026, 0.052, [1.00, 0.80, 0.45], 0.90)
    # horizon glow + retro grid: latitude rings + meridians below the horizon
    img += (np.exp(-(((VV - 0.56) / 0.060) ** 2)) * 0.55)[..., None] * np.float32([0.10, 0.85, 1.00])
    ring_col = np.float32([0.10, 0.90, 1.00])
    mag_col = np.float32([1.00, 0.25, 0.60])
    for k in range(1, 9):
        vi = 0.5 + 0.052 * k ** 1.32
        line = np.exp(-(((VV - vi) / 0.0032) ** 2)) * np.float32(0.85 ** k)
        img += line[..., None] * (ring_col if k % 2 else mag_col) * 0.85
    depth = (1.0 - smoothstep(0.72, 0.98, VV)) * smoothstep(0.50, 0.56, VV)
    for k in range(12):
        cu = k / 12
        du = np.abs(UU - cu)
        du = np.minimum(du, 1 - du)
        img += (np.exp(-((du / 0.0030) ** 2)) * depth * 0.40)[..., None] * ring_col
    return filmic(img)


def ink_marble():
    w1 = fbm(UU, VV, 3, 4, 21)
    w2 = fbm(UU, VV, 3, 4, 22)
    m = np.sin(2 * np.pi * (1.15 * VV + 1.0 * UU + 1.55 * w1 + 0.75 * w2))
    t = smoothstep(-0.38, 0.38, m)[..., None]
    indigo = np.float32([0.135, 0.145, 0.245])
    cream = np.float32([0.930, 0.900, 0.840])
    img = indigo + (cream - indigo) * t
    grain = (fbm(UU, VV, 24, 2, 23) - 0.5)[..., None] * 0.045
    img = img + grain
    # one thin gold vein following the same flow field
    vein = np.exp(-((m - 0.985) / 0.012) ** 2)
    img += vein[..., None] * np.float32([0.55, 0.38, 0.10])
    return np.clip(img, 0, 1)


def ember_sunset():
    # bright band + sun live in the camera-visible rows v≈0.60–0.83
    img = vgrad(
        [
            (0.00, (0.100, 0.045, 0.115)),
            (0.38, (0.380, 0.135, 0.090)),
            (0.55, (0.850, 0.440, 0.170)),
            (0.630, (1.000, 0.760, 0.360)),
            (0.720, (0.520, 0.210, 0.115)),
            (0.790, (0.090, 0.055, 0.065)),
            (1.00, (0.045, 0.035, 0.045)),
        ]
    )
    # horizontal haze streaks, denser near the bright band
    haze = fbm(UU, VV * 0.45, 5, 4, 31)
    bandw = np.exp(-(((VV - 0.62) / 0.16) ** 2))
    img *= (1.0 - 0.38 * haze * (0.35 + 0.65 * bandw))[..., None]
    # sun + wide warm glow on the band
    blob(img, 0.30, 0.645, 0.038, 0.076, [1.00, 0.86, 0.55], 1.15)
    blob(img, 0.30, 0.645, 0.130, 0.260, [0.90, 0.45, 0.20], 0.45)
    # dark cloud slivers crossing the band
    cl = fbm((UU + 0.2) % 1.0, VV * 0.5, 6, 3, 32)
    sliver = smoothstep(0.55, 0.75, cl) * smoothstep(0.565, 0.60, VV) * smoothstep(0.73, 0.68, VV)
    img *= (1.0 - 0.55 * sliver)[..., None]
    return filmic(img)


def prism_bloom():
    img = np.full((H, W, 3), np.float32([0.965, 0.950, 0.915]))
    blobs = [
        (0.20, 0.35, 0.150, 0.300, (0.99, 0.78, 0.64), 0.85),  # peach
        (0.74, 0.30, 0.170, 0.340, (0.60, 0.92, 0.78), 0.75),  # mint
        (0.48, 0.56, 0.190, 0.380, (0.80, 0.73, 0.97), 0.80),  # lavender
        (0.04, 0.62, 0.140, 0.280, (0.62, 0.83, 0.97), 0.70),  # sky
        (0.92, 0.70, 0.150, 0.300, (0.99, 0.94, 0.66), 0.60),  # lemon
        (0.38, 0.16, 0.120, 0.240, (0.97, 0.85, 0.92), 0.55),  # blush
    ]
    for cu, cv, su, sv, col, s in blobs:
        du = np.abs(UU - cu)
        du = np.minimum(du, 1.0 - du)
        dv = VV - cv
        g = np.exp(-(du * du) / (2 * su * su) - (dv * dv) / (2 * sv * sv))
        img += (s * g)[..., None] * (np.asarray(col, np.float32) - img)  # airbrush lerp
    grain = (fbm(UU, VV, 30, 2, 46) - 0.5)[..., None] * 0.020
    return np.clip(img + grain, 0, 1)


ENVIRONMENTS = [
    ("nebula_drift", nebula_drift),
    ("aurora_veil", aurora_veil),
    ("neon_grid", neon_grid),
    ("ink_marble", ink_marble),
    ("ember_sunset", ember_sunset),
    ("prism_bloom", prism_bloom),
]

if __name__ == "__main__":
    rendered = []
    for name, fn in ENVIRONMENTS:
        rendered.append((name, save(fn(), name)))

    # contact sheet for one-shot visual review (3 cols x 2 rows, 512x256 thumbs)
    tw, th = 512, 256
    sheet = Image.new("RGB", (tw * 3, th * 2))
    d = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 22)
    except OSError:
        font = ImageFont.load_default()
    for i, (name, img) in enumerate(rendered):
        thumb = Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8)).resize((tw, th), Image.LANCZOS)
        x, y = (i % 3) * tw, (i // 3) * th
        sheet.paste(thumb, (x, y))
        d.rectangle([x + 6, y + 6, x + 260, y + 36], fill=(0, 0, 0))
        d.text((x + 14, y + 9), name, fill=(255, 220, 150), font=font)
    sheet.save("/tmp/render/env_sheet.png")
    print("contact sheet -> /tmp/render/env_sheet.png")
