"""width_extraction_geometries.py — synthetic strand-mask generators with
KNOWN ground truth (Minkowski-dilation etc.). Single definition, imported by
both the pytest suite (tests/unit/test_strand_diameter.py) and the evaluation
module (width_extraction_eval.py). Moving them here removes the old importlib
hack and any circular-import risk.
"""
import numpy as np
from scipy.ndimage import gaussian_filter
from skimage.draw import disk as skdisk

from pdtools.image_analysis.strand_diameter import Config

RES = Config().resolution_um_per_px  # 3.25 um/px

def make_straight_horizontal(size=1200, widths_px=None, spacing_px=150):
    widths_px = widths_px or [77] * 5
    mask = np.zeros((size, size), dtype=np.uint8)
    y = spacing_px
    for w in widths_px:
        if y + w >= size:
            break
        mask[y:y + w, :] = 1
        y += w + spacing_px
    return mask


def make_diagonal(size=1200, n_strands=6, width_px=77, angle_deg=45):
    mask = np.zeros((size, size), dtype=np.uint8)
    n = np.array([np.sin(np.deg2rad(angle_deg)), -np.cos(np.deg2rad(angle_deg))])
    spacing = (size * 1.5) / n_strands
    yy, xx = np.mgrid[0:size, 0:size]
    for i in range(n_strands):
        offset = (i - n_strands / 2 + 0.5) * spacing
        signed = (yy - size / 2) * n[0] + (xx - size / 2) * n[1] - offset
        mask[np.abs(signed) <= width_px / 2] = 1
    return mask


def make_mixed_widths(size=1200, widths_px=None, spacing_px=80):
    """Mixed-width strands spanning 150–600 μm (46–185 px) by default."""
    widths_px = widths_px or [46, 77, 123, 154, 185]  # 150, 250, 400, 500, 600 μm
    mask = np.zeros((size, size), dtype=np.uint8)
    y = spacing_px
    for w in widths_px:
        if y + w >= size:
            break
        mask[y:y + w, :] = 1
        y += w + spacing_px
    return mask, widths_px


def make_edge_touching(size=1200, width_px=77):
    mask = make_straight_horizontal(size=size, widths_px=[width_px] * 7, spacing_px=77)
    mask = np.vstack([mask[30:, :], np.zeros((30, size), dtype=np.uint8)])
    mask[-width_px:, :] = 1
    return mask


def make_noisy_edges(size=1200, width_px=77, n_strands=5, noise_sigma=3, seed=42):
    np.random.seed(seed)
    mask = np.zeros((size, size), dtype=np.uint8)
    spacing = (size - n_strands * width_px) // (n_strands + 1)
    y = spacing
    for _ in range(n_strands):
        if y + width_px >= size:
            break
        top = gaussian_filter(
            (np.random.randn(size) * noise_sigma).astype(float), sigma=3
        ).round().astype(int)
        bot = gaussian_filter(
            (np.random.randn(size) * noise_sigma).astype(float), sigma=3
        ).round().astype(int)
        for x in range(size):
            mask[max(0, y + top[x]):min(size, y + width_px + bot[x]), x] = 1
        y += width_px + spacing
    return mask


def make_curved(size=1200, width_px=77, n_strands=3):
    mask = np.zeros((size, size), dtype=np.uint8)
    spacing = size // (n_strands + 1)
    for i in range(1, n_strands + 1):
        y_base = i * spacing
        for x in range(size):
            yc = int(y_base + 80 * np.sin(2 * np.pi * x / 600))
            mask[max(0, yc - width_px // 2):min(size, yc + width_px // 2 + 1), x] = 1
    return mask


def make_single_narrow(size=1200, width_px=40):
    mask = np.zeros((size, size), dtype=np.uint8)
    y = size // 2 - width_px // 2
    mask[y:y + width_px, :] = 1
    return mask


def make_curved_minkowski(size=1200, radius_px=38, n_strands=3,
                          amplitude=40, period=700):
    """Sinusoidal strand built as Minkowski-dilation of its centreline
    (disk of radius_px stamped at every centerline pixel). The TRUE
    perpendicular diameter is 2*radius_px everywhere.
    The `make_curved` generator above uses vertical-slab fill which gives
    a different truth — this one is what you want if you care about
    perpendicular width."""
    mask = np.zeros((size, size), dtype=np.uint8)
    spacing = size // (n_strands + 1)
    for i in range(1, n_strands + 1):
        y_base = i * spacing
        for x in range(size):
            yc = int(y_base + amplitude * np.sin(2 * np.pi * x / period))
            rr, cc = skdisk((yc, x), radius_px, shape=(size, size))
            mask[rr, cc] = 1
    return mask


def make_very_rough_edges(size=1200, width_px=77, n_strands=5,
                          noise_sigma=8, seed=42):
    """Same as make_noisy_edges but with stronger edge roughness (σ=8 px).
    Stresses the 'EDT measures to innermost notch' bias."""
    np.random.seed(seed)
    mask = np.zeros((size, size), dtype=np.uint8)
    spacing = (size - n_strands * width_px) // (n_strands + 1)
    y = spacing
    for _ in range(n_strands):
        if y + width_px >= size:
            break
        top = gaussian_filter(
            (np.random.randn(size) * noise_sigma).astype(float), sigma=3
        ).round().astype(int)
        bot = gaussian_filter(
            (np.random.randn(size) * noise_sigma).astype(float), sigma=3
        ).round().astype(int)
        for x in range(size):
            mask[max(0, y + top[x]):min(size, y + width_px + bot[x]), x] = 1
        y += width_px + spacing
    return mask


def make_diw_realistic(size=1200, radius_px=38, n_strands=5, spacing_px=180,
                       slope_deg=12, wobble_amp=6, wobble_period=350,
                       edge_noise_sigma=3, seed=42):
    """Multiple near-horizontal strands at a gentle slope with small
    print-wander wobble and mild edge roughness – what C2 / KCNSC masks
    look like in practice. Each strand has TRUE diameter 2*radius_px."""
    np.random.seed(seed)
    mask = np.zeros((size, size), dtype=np.uint8)
    for s in range(n_strands):
        y_base = 120 + s * spacing_px
        if y_base >= size - radius_px:
            break
        base = np.random.standard_normal(size) * edge_noise_sigma
        radius_offset = gaussian_filter(base, sigma=3.0)
        for x in range(size):
            slope = np.tan(np.deg2rad(slope_deg)) * x
            wobble = wobble_amp * np.sin(2 * np.pi * x / wobble_period)
            yc = int(y_base + slope + wobble)
            if yc >= size - radius_px:
                break
            r_eff = max(2, int(round(radius_px + radius_offset[x])))
            rr, cc = skdisk((yc, x), r_eff, shape=(size, size))
            mask[rr, cc] = 1
    return mask


def make_close_strands(size=1200, width_px=77, gap_px=3, n_strands=4):
    """Parallel horizontal strands with only `gap_px` between them.
    Checks that connected-components still separates them correctly."""
    mask = np.zeros((size, size), dtype=np.uint8)
    y = 100
    for _ in range(n_strands):
        if y + width_px >= size:
            break
        mask[y:y + width_px, :] = 1
        y += width_px + gap_px
    return mask


# ── Difficult / edge-case generators ─────────────────────────────────────────

def make_tapered_strand(size=1200, w0_px=50, w1_px=100):
    """Linear taper from w0_px at left to w1_px at right. Truth = mean width."""
    mask = np.zeros((size, size), dtype=np.uint8)
    yc = size // 2
    for x in range(size):
        w = int(w0_px + (w1_px - w0_px) * x / (size - 1))
        mask[yc - w // 2:yc + w // 2 + 1, x] = 1
    return mask


def make_holes_in_strand(size=1200, width_px=123, n_strands=3, hole_radius=18,
                         n_holes=12, seed=0):
    """Strands with SUBSTANTIAL interior dropouts – hole radius ~15% of the
    strand width. Tests that post_process_mask's binary_fill_holes still
    recovers the strand correctly even with visible holes. Default truth
    = 400 μm (123 px wide strand), hole radius = 18 px (φ ≈ 117 μm)."""
    rng = np.random.default_rng(seed)
    mask = np.zeros((size, size), dtype=np.uint8)
    spacing = (size - n_strands * width_px) // (n_strands + 1)
    y = spacing
    for _ in range(n_strands):
        mask[y:y + width_px, :] = 1
        for _ in range(n_holes):
            hx = rng.integers(hole_radius + 2, size - hole_radius - 2)
            hy = rng.integers(y + hole_radius + 2, y + width_px - hole_radius - 2)
            rr, cc = skdisk((hy, hx), hole_radius, shape=(size, size))
            mask[rr, cc] = 0
        y += width_px + spacing
    return mask


def make_y_junction(size=1200, width_px=77):
    """Y-shaped strand: horizontal trunk splitting into two diagonal branches."""
    mask = np.zeros((size, size), dtype=np.uint8)
    mask[size // 2 - width_px // 2:size // 2 + width_px // 2 + 1, :size // 2] = 1
    for t in range(size // 2, size):
        yc = size // 2 - int((t - size // 2) * 0.6)
        if yc < width_px // 2:
            break
        mask[yc - width_px // 2:yc + width_px // 2 + 1, t] = 1
    for t in range(size // 2, size):
        yc = size // 2 + int((t - size // 2) * 0.6)
        if yc > size - width_px // 2:
            break
        mask[yc - width_px // 2:yc + width_px // 2 + 1, t] = 1
    return mask


def make_spurs(size=1200, width_px=77, n_strands=3, n_spurs=20, seed=1):
    """Strands with small edge bumps + detached fragments – stresses
    skeleton-fragment pruning + area-threshold filtering."""
    rng = np.random.default_rng(seed)
    mask = np.zeros((size, size), dtype=np.uint8)
    spacing = (size - n_strands * width_px) // (n_strands + 1)
    y = spacing
    for _ in range(n_strands):
        mask[y:y + width_px, :] = 1
        for _ in range(n_spurs):
            sx = rng.integers(20, size - 20)
            spur_len = rng.integers(3, 15)
            if rng.random() < 0.5:
                mask[y - spur_len:y, sx:sx + 3] = 1
            else:
                mask[y + width_px:y + width_px + spur_len, sx:sx + 3] = 1
        y += width_px + spacing
    for _ in range(10):
        cx = rng.integers(20, size - 20)
        cy = rng.integers(20, size - 20)
        rr, cc = skdisk((cy, cx), 5, shape=(size, size))
        mask[rr, cc] = 1
    return mask


def make_x_crossing(size=1200, width_px=77):
    """Horizontal and vertical strand crossing at image center – known failure
    mode: one connected component whose skeleton is X-shaped."""
    mask = np.zeros((size, size), dtype=np.uint8)
    mask[size // 2 - width_px // 2:size // 2 + width_px // 2 + 1, :] = 1
    mask[:, size // 2 - width_px // 2:size // 2 + width_px // 2 + 1] = 1
    return mask


def make_short_strand(size=1200, width_px=77, length_px=200):
    """Single strand only 200 px long – barely enough skeleton pixels to sample."""
    mask = np.zeros((size, size), dtype=np.uint8)
    yc = size // 2
    x0 = size // 2 - length_px // 2
    mask[yc - width_px // 2:yc + width_px // 2 + 1, x0:x0 + length_px] = 1
    return mask


def make_merged_strands(size=1200, radius_px=38, overlap_px=4, length_px=1100):
    """Two parallel strands with a 4 px overlap → one connected component.
    Known failure mode: no algorithm separates them without extra logic."""
    mask = np.zeros((size, size), dtype=np.uint8)
    y1 = size // 2 - radius_px + overlap_px // 2
    y2 = size // 2 + radius_px - overlap_px // 2
    for x in range(min(length_px, size)):
        for yc in (y1, y2):
            rr, cc = skdisk((yc, x), radius_px, shape=(size, size))
            mask[rr, cc] = 1
    return mask


def make_near_border_strand(size=1200, width_px=77, margin=20):
    """Three strands, two only 20 px from the image edges. Tests that the
    50 px border-margin doesn't drop legitimate interior skeletons."""
    mask = np.zeros((size, size), dtype=np.uint8)
    mask[margin:margin + width_px, :] = 1
    mask[size - margin - width_px:size - margin, :] = 1
    mask[size // 2:size // 2 + width_px, :] = 1
    return mask


def make_very_wide_strand(size=1200, width_px=250):
    """Single 250 px wide strand. Tests that max_transect_half_width_px=200
    does not silently clip wider strands."""
    mask = np.zeros((size, size), dtype=np.uint8)
    yc = size // 2
    mask[yc - width_px // 2:yc + width_px // 2 + 1, :] = 1
    return mask


def make_width_oscillating(size=1200, width_base=77, amp=15, period=300):
    """Single strand whose width oscillates sinusoidally along its length
    (simulating real extrusion flow variation). Truth = base width."""
    mask = np.zeros((size, size), dtype=np.uint8)
    yc = size // 2
    for x in range(size):
        w = int(width_base + amp * np.sin(2 * np.pi * x / period))
        mask[yc - w // 2:yc + w // 2 + 1, x] = 1
    return mask


def make_mixed_orientation(size=1200, width_px=77):
    """Horizontal strands in the top half + vertical strands in the bottom half
    of the same image — stresses per-strand PCA direction determination."""
    mask = np.zeros((size, size), dtype=np.uint8)
    for y_base in [100, 300, 500]:
        mask[y_base:y_base + width_px, :] = 1
    for x_base in [300, 700]:
        mask[700:size, x_base:x_base + width_px] = 1
    return mask


def make_single_arc(size=1200, radius_px=60, bend_deg=30, chord_len=1000):
    """Single circular-arc strand (Minkowski-dilation) with a total bend
    of `bend_deg`. Truth diameter = 2 * radius_px."""
    mask = np.zeros((size, size), dtype=np.uint8)
    theta = np.deg2rad(bend_deg)
    if theta == 0:
        xs = np.arange(chord_len, dtype=float)
        ys = np.zeros_like(xs)
    else:
        radius = chord_len / (2 * np.sin(theta / 2))
        n = int(chord_len * 1.4)
        t = np.linspace(-theta / 2, theta / 2, n)
        xs = radius * np.sin(t)
        ys = radius * (1 - np.cos(t))
        xs -= xs.min(); ys -= ys.min()
    yoff = size // 2 - (ys.max() - ys.min()) / 2 - ys.min()
    xoff = size // 2 - (xs.max() - xs.min()) / 2 - xs.min()
    for y, x in zip(ys, xs):
        rr, cc = skdisk((int(y + yoff), int(x + xoff)), radius_px, shape=(size, size))
        mask[rr, cc] = 1
    return mask


def make_sparse_strand(size=1200, width_px=77, dropout_frac=0.3, seed=7):
    """Single strand with 30% of columns missing — simulates a severely
    under-segmented mask. Known degraded-mask mode."""
    rng = np.random.default_rng(seed)
    mask = np.zeros((size, size), dtype=np.uint8)
    yc = size // 2
    mask[yc - width_px // 2:yc + width_px // 2 + 1, :] = 1
    cols = rng.choice(size, int(size * dropout_frac), replace=False)
    mask[yc - width_px // 2:yc + width_px // 2 + 1, cols] = 0
    return mask


def make_serpentine(size=1200, radius_px=38, n_runs=4, margin=120):
    """Single boustrophedon (serpentine) strand: horizontal runs joined by
    180° U-turns at alternating ends. Built by Minkowski-dilation of the
    centerline (disk of radius_px stamped along the path), so the TRUE
    perpendicular diameter is 2*radius_px everywhere except inside the
    U-turn corners. Inspired by the Hilbert-curve test images — stresses
    both the EDT curvature shortcut (under-reads on the bends) and the
    perpendicular-walk over-read where a transect can leak across a U-turn
    into the adjacent run."""
    mask = np.zeros((size, size), dtype=np.uint8)
    x_lo, x_hi = margin, size - margin
    pitch = (size - 2 * margin) / (n_runs - 1)
    pts = []
    for i in range(n_runs):
        y = margin + i * pitch
        xs = range(x_lo, x_hi + 1) if i % 2 == 0 else range(x_hi, x_lo - 1, -1)
        for x in xs:
            pts.append((y, x))
        if i < n_runs - 1:  # vertical connector (U-turn) to the next run
            x_end = x_hi if i % 2 == 0 else x_lo
            for y2 in range(int(y), int(y + pitch) + 1):
                pts.append((y2, x_end))
    for y, x in pts:
        rr, cc = skdisk((int(y), int(x)), radius_px, shape=(size, size))
        mask[rr, cc] = 1
    return mask


def make_blob_edges(size=1200, width_px=77, n_strands=4, n_blobs=40,
                    blob_radius=12, seed=3):
    """Parallel straight strands with small semicircular 'blobs' bulging out
    of the edges (extrusion beads). Blobs only add material outward, so they
    perturb individual transects upward; the per-strand median should reject
    them and recover the base width_px. Sparse by construction so most
    transects still hit a clean edge."""
    rng = np.random.default_rng(seed)
    mask = np.zeros((size, size), dtype=np.uint8)
    spacing = (size - n_strands * width_px) // (n_strands + 1)
    y = spacing
    for _ in range(n_strands):
        if y + width_px >= size:
            break
        mask[y:y + width_px, :] = 1
        for _ in range(n_blobs):
            bx = rng.integers(blob_radius, size - blob_radius)
            cy = y if rng.random() < 0.5 else y + width_px  # top or bottom edge
            rr, cc = skdisk((cy, bx), blob_radius, shape=(size, size))
            mask[rr, cc] = 1
        y += width_px + spacing
    return mask


