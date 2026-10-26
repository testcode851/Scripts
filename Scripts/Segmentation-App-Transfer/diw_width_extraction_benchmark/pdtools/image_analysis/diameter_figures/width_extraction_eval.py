"""width_extraction_eval.py — SINGLE SOURCE OF TRUTH for the strand-width
measurement-method evaluation.

Everything downstream (the visual gallery, the analysis/error plots, and the
pytest regression gate) imports from here, so the geometry set, the tolerances,
and the four measurement heads have exactly ONE definition and can never drift.

Provides:
  GENERATORS  — the make_* synthetic-geometry builders (re-exported from the
                unit-test module, which remains their only definition)
  CASES       — list of dicts: name, gen (callable→mask), truth_um, tol_um,
                curved (bool), xfail (bool)
  METHODS     — [(name, fn), ...] the 4 heads: EDT, Global PCA, Local tangent,
                Robust spline
  per_strand_measure(mask, method_fn) — run one head over a mask → array of
                per-transect diameters (μm)
  RES         — μm/px (from strand_diameter.Config)
"""
import sys
from pathlib import Path
import numpy as np
from scipy.interpolate import UnivariateSpline
from skimage.morphology import medial_axis
from skimage.measure import label, regionprops

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
from pdtools.image_analysis.strand_diameter import Config
# Geometry generators live in one shared module, imported normally (no
# importlib hack, no circular dependency with the pytest suite).
from pdtools.image_analysis import width_extraction_geometries as GENERATORS

RES = Config().resolution_um_per_px  # 3.25 μm/px
_g = GENERATORS

# ── Within-strand outlier pre-trim (RETIRED, off by default) ─────────────────
# Every head used to clip per-transect widths to +/-10% of the strand median
# before aggregating. That pre-trim is now RETIRED (OUTLIER_TOL_FRAC = 0.0),
# matching the deployed isob pipeline: the per-strand point estimate is the
# MEDIAN, which is already robust to junction/necking transects, so trimming
# first is redundant. It also censored genuine >10% dimensional excursions (the
# taper/neck/bulge a process-control tool must catch) -- reviewer objection
# addressed. Kept reversible: set OUTLIER_TOL_FRAC > 0 to restore the old trim.
OUTLIER_TOL_FRAC = 0.0

def _trim(d):
    """Apply the (retired) +/-median outlier pre-trim if OUTLIER_TOL_FRAC > 0;
    otherwise return d unchanged. Empty-safe."""
    if OUTLIER_TOL_FRAC <= 0 or len(d) == 0:
        return d
    med = np.median(d)
    lo, hi = (1 - OUTLIER_TOL_FRAC) * med, (1 + OUTLIER_TOL_FRAC) * med
    return d[(d >= lo) & (d <= hi)]

# ── The reconciled case set (matches the pytest suite: 28 non-pathological +
#    3 xfail). truth_um and tol_um are the SAME values asserted in the tests.
#    curved=True marks geometries whose centreline bends (for figure marking).
def _c(name, gen, truth_um, tol_um, category, curved=False, xfail=False,
       cfg_kw=None, strand_truths=None):
    # cfg_kw: optional Config overrides for cases that need a relaxed gate.
    # strand_truths: per-strand true diameters (μm). Defaults to [truth_um] for
    # uniform cases; mixed-width cases pass the real list so each strand is
    # scored against ITS OWN truth (calibration data must not be scored against
    # an image-mean).
    return dict(name=name, gen=gen, truth_um=truth_um, tol_um=tol_um,
                category=category, curved=curved, xfail=xfail, cfg_kw=cfg_kw or {},
                strand_truths=strand_truths or [truth_um])

# CATEGORY_ORDER also drives the row grouping in the gallery: easy -> hard,
# pathological last. Cases are listed within each category easy -> hard.
CATEGORY_ORDER = ['Straight', 'Orientation & placement', 'Edge imperfections',
                  'Curves & sinusoids', 'Pathological (xfail)']

CASES = [
    # ── Straight strands, increasing complexity ──────────────────────────────
    _c('single_narrow',           lambda: _g.make_single_narrow(width_px=40),                                40*RES,  3.0, 'Straight'),
    _c('horizontal_uniform',      lambda: _g.make_straight_horizontal(widths_px=[31]*5),                     31*RES,  3.0, 'Straight'),
    _c('small_diameter_150um',    lambda: _g.make_straight_horizontal(widths_px=[46]*4, spacing_px=100),     46*RES,  4.0, 'Straight'),
    _c('close_strands',           lambda: _g.make_close_strands(width_px=77, gap_px=3, n_strands=4),         77*RES,  3.0, 'Straight'),
    _c('large_diameter_500um',    lambda: _g.make_straight_horizontal(widths_px=[154], spacing_px=400),     154*RES,  5.0, 'Straight'),
    _c('very_wide_strand',        lambda: _g.make_very_wide_strand(width_px=250),                           250*RES,  5.0, 'Straight'),
    _c('mixed_widths',            lambda: _g.make_mixed_widths()[0],           float(np.mean([46,77,123,154,185]))*RES, 4.0, 'Straight',
       strand_truths=[46*RES, 77*RES, 123*RES, 154*RES, 185*RES]),
    # ── Orientation & placement ──────────────────────────────────────────────
    _c('diagonal_45deg',          lambda: _g.make_diagonal(n_strands=6, width_px=62, angle_deg=45),          62*RES,  4.0, 'Orientation & placement'),
    _c('mixed_orientation',       lambda: _g.make_mixed_orientation(width_px=62),                            62*RES,  3.0, 'Orientation & placement'),
    _c('edge_touching',           lambda: _g.make_edge_touching(width_px=62),                                62*RES,  3.0, 'Orientation & placement'),
    _c('near_border_strand',      lambda: _g.make_near_border_strand(width_px=123, margin=20),              123*RES,  3.0, 'Orientation & placement'),
    _c('short_strand',            lambda: _g.make_short_strand(width_px=62, length_px=200),                  62*RES,  5.0, 'Orientation & placement',cfg_kw={'min_transects': 10}),
    # ── Edge imperfections ───────────────────────────────────────────────────
    _c('noisy_edges',             lambda: _g.make_noisy_edges(width_px=108, noise_sigma=3),                 108*RES,  4.0, 'Edge imperfections'),
    _c('very_rough_edges',        lambda: _g.make_very_rough_edges(width_px=138, noise_sigma=8),            138*RES,  6.0, 'Edge imperfections'),
    _c('blob_edges_sparse',       lambda: _g.make_blob_edges(width_px=77, n_strands=4, n_blobs=8, blob_radius=12), 77*RES, 5.0, 'Edge imperfections'),
    _c('holes_in_strand',         lambda: _g.make_holes_in_strand(width_px=123, hole_radius=18, n_holes=12),123*RES,  3.0, 'Edge imperfections'),
    _c('spurs_and_fragments',     lambda: _g.make_spurs(width_px=92, n_strands=3, n_spurs=10),               92*RES,  6.0, 'Edge imperfections'),
    _c('y_junction',              lambda: _g.make_y_junction(width_px=108),                                 108*RES,  5.0, 'Edge imperfections'),
    _c('diw_realistic',           lambda: _g.make_diw_realistic(),                                          2*38*RES, 10.0, 'Edge imperfections'),
    # ── Curves & sinusoids ───────────────────────────────────────────────────
    _c('tapered_strand',          lambda: _g.make_tapered_strand(w0_px=50, w1_px=100),                       75*RES,  4.0, 'Curves & sinusoids', curved=True, cfg_kw={'min_transects': 10}),
    _c('width_oscillating',       lambda: _g.make_width_oscillating(width_base=108, amp=15, period=300),    108*RES,  8.0, 'Curves & sinusoids', curved=True),
    _c('single_arc_30deg',        lambda: _g.make_single_arc(radius_px=60, bend_deg=30, chord_len=1000),    2*60*RES,  8.0, 'Curves & sinusoids', curved=True),
    _c('single_arc_45deg',        lambda: _g.make_single_arc(radius_px=38, bend_deg=45, chord_len=1000),    2*38*RES, 10.0, 'Curves & sinusoids', curved=True),
    _c('sinusoidal_small',        lambda: _g.make_curved_minkowski(radius_px=23, amplitude=30, period=700, n_strands=3), 2*23*RES,  5.0, 'Curves & sinusoids', curved=True),
    _c('curved_minkowski',        lambda: _g.make_curved_minkowski(radius_px=38, amplitude=40, period=700, n_strands=3), 2*38*RES, 12.0, 'Curves & sinusoids', curved=True),
    _c('sinusoidal_large',        lambda: _g.make_curved_minkowski(radius_px=77, amplitude=40, period=700, n_strands=2), 2*77*RES, 20.0, 'Curves & sinusoids', curved=True),
    _c('serpentine',              lambda: _g.make_serpentine(radius_px=38, n_runs=4),                      2*38*RES, 15.0, 'Curves & sinusoids', curved=True),
    # NOTE: the legacy 'curved_strands_slab' (make_curved, vertical-slab fill) was
    # dropped – it is a redundant sinusoid whose label was the VERTICAL fill height
    # (202μm) not the true perpendicular width (~172μm, confirmed by EDT ridge and
    # w·cos θ), so it rewarded over-reading. curved_minkowski covers the same
    # geometry with an exact 2R perpendicular truth.
    # ── Pathological (xfail) – hardest; reported separately, excluded from summaries ──
    _c('x_crossing',              lambda: _g.make_x_crossing(width_px=92),                                   92*RES,  5.0, 'Pathological (xfail)', xfail=True),
    _c('merged_strands',          lambda: _g.make_merged_strands(radius_px=77, overlap_px=4),              2*77*RES, 10.0, 'Pathological (xfail)', xfail=True),
    _c('sparse_strand',           lambda: _g.make_sparse_strand(width_px=62, dropout_frac=0.3),             62*RES, 10.0, 'Pathological (xfail)', xfail=True),
]

# Concise, verified failure notes per case (empirically checked this session).
# Keyed by case name; shown under the tile in the gallery. Blank = no notable
# failure mode for that case.
NOTES = {
    'very_rough_edges': 'jagged edge: EDT reads to the deepest inward bump so reads too narrow; Local aims its cut wrong on the jagged centerline so reads too wide',
    'holes_in_strand':  'holes make the centerline loop around each hole: EDT then reads the small hole gap (too narrow), Local cuts the wrong way and reads too wide',
    'y_junction':       'the fork has no single direction: Local and Robust cut across it (240 um too wide); EDT reads a bit low; Global survives by rejecting the bad cuts',
    'diw_realistic':    'Global slightly high: it uses one fixed cut angle while the strand tilts',
    'width_oscillating':'width varies along the strand, which stresses the outlier filter; all stay near tolerance',
    'single_arc_30deg': 'Global cuts at a fixed angle so it over-reads where the strand bends; Local and Robust re-aim the cut and stay accurate',
    'single_arc_45deg': 'same as the 30 deg arc, stronger bend: Global over-reads on the tilt, rotating-cut methods track the curve',
    'curved_minkowski': 'Global over-reads on the tilt (fixed cut angle vs a curving strand); Local and Robust re-aim and stay flat',
    'sinusoidal_large': 'strand tilts up to 20 deg: Global over-reads by 1/cos(tilt); Local and Robust re-aim the cut so stay accurate',
    'x_crossing':       'xfail: the two strands cross and merge into one blob; no method can tell them apart',
    'merged_strands':   'xfail: the strands overlap into one blob, so it is measured as one double-wide strand',
    'sparse_strand':    'xfail: 30 percent of the strand is dropped out, breaking it into fragments that are lost',
    'serpentine':       'folded back-and-forth path; edge-rejection + median-within reject the U-turn leak transects so Global now tracks it (244 vs 247 um)',
}

# ── Per-strand runner + the four measurement heads ───────────────────────────
def _order_skel(skel_yx):
    if len(skel_yx) < 2: return np.arange(len(skel_yx))
    c = skel_yx - skel_yx.mean(axis=0)
    cov = np.cov(c.T)
    if cov.ndim == 0 or np.any(~np.isfinite(cov)): return np.arange(len(skel_yx))
    _, v = np.linalg.eigh(cov)
    return np.argsort(c @ v[:, -1])

def _walk(mask, y, x, perp, max_half=300):
    H, W = mask.shape
    total, edge = 1, False
    for sign in (+1, -1):
        hit = False
        for step in range(1, max_half):
            yi = int(round(y + sign*step*perp[0])); xi = int(round(x + sign*step*perp[1]))
            if yi < 0 or yi >= H or xi < 0 or xi >= W:
                hit = True; break
            if not mask[yi, xi]: break
            total += 1
        else: hit = True
        if hit: edge = True
    return total, edge

def per_strand_medians(mask, method, stride=15):
    """Return (medians, centroids): one median diameter (μm) per separated
    strand, plus each strand's (row, col) centroid for matching to truths.
    Connected-component separation is done ONCE here and shared by every
    method — the methods differ only in the per-point width step."""
    labels = label(mask)
    meds, cents = [], []
    for region in regionprops(labels):
        if region.area < 200: continue
        sm = (labels == region.label).astype(np.uint8)
        # rng=0 pins medial_axis tie-breaking → reproducible run-to-run.
        skel, dt = medial_axis(sm, return_distance=True, rng=0)
        skel_yx = np.argwhere(skel)
        if len(skel_yx) < 10: continue
        order = _order_skel(skel_yx)
        sidx = order[np.arange(0, len(order), stride)]
        if len(sidx) < 3: continue
        vals = method(sm, skel_yx, dt, sidx)
        if len(vals) == 0: continue
        meds.append(float(np.median(vals)))
        cents.append(tuple(region.centroid))
    return meds, cents

def per_strand_measure(mask, method, stride=15):
    """Back-compat: pooled per-transect diameters across all strands."""
    labels = label(mask)
    all_vals = []
    for region in regionprops(labels):
        if region.area < 200: continue
        sm = (labels == region.label).astype(np.uint8)
        skel, dt = medial_axis(sm, return_distance=True, rng=0)
        skel_yx = np.argwhere(skel)
        if len(skel_yx) < 10: continue
        order = _order_skel(skel_yx)
        sidx = order[np.arange(0, len(order), stride)]
        if len(sidx) < 3: continue
        all_vals.extend(method(sm, skel_yx, dt, sidx).tolist())
    return np.array(all_vals, dtype=float)

def _match_truths(medians, cents, strand_truths):
    """Match measured per-strand medians to their true widths.
    If one scalar truth (uniform case) → every strand uses it. If a list
    (e.g. mixed_widths) → sort both by width and pair (strands are built in
    width order along the image). Returns list of (measured, truth)."""
    if len(medians) == 0:
        return []
    if len(strand_truths) == 1:
        return [(m, strand_truths[0]) for m in medians]
    # multiple distinct truths: pair sorted-by-value (generator lays strands in
    # ascending-width order top→bottom; sorting both is order-robust).
    ms = sorted(medians)
    ts = sorted(strand_truths)
    n = min(len(ms), len(ts))
    return list(zip(ms[:n], ts[:n]))

def method_edt(sm, skel_yx, dt, sidx):
    d = np.array([2.0 * dt[y, x] for y, x in skel_yx[sidx]]) * RES
    return _trim(d)

def method_global(sm, skel_yx, dt, sidx):
    c = skel_yx - skel_yx.mean(axis=0)
    _, v = np.linalg.eigh(np.cov(c.T)); perp = v[:, 0]
    # Edge-rejection: keep only transects that hit two real strand boundaries;
    # drop those truncated by the image frame (edge=True), which read short and
    # bias the median low on corner/border strands. Fall back to all transects
    # if every walk is edge-truncated (nothing else to use).
    walks = [_walk(sm, *skel_yx[i], perp) for i in sidx]
    clean = np.array([w for w, edge in walks if not edge]) * RES
    d = clean if len(clean) else np.array([w for w, _ in walks]) * RES
    return _trim(d)

def method_local(sm, skel_yx, dt, sidx, K=21):
    order = _order_skel(skel_yx)
    ordered = skel_yx[order].astype(float)
    inv = np.empty_like(order); inv[order] = np.arange(len(order))
    half = K // 2
    vals = []
    for i in sidx:
        pos = inv[i]
        nbrs = ordered[max(0, pos-half):min(len(ordered), pos+half+1)]
        if len(nbrs) < 2: continue
        _, v = np.linalg.eigh(np.cov((nbrs - nbrs.mean(axis=0)).T))
        vals.append(_walk(sm, *skel_yx[i], v[:, 0])[0])
    d = np.array(vals, dtype=float) * RES
    return _trim(d)

def method_robust(sm, skel_yx, dt, sidx):
    order = _order_skel(skel_yx)
    ordered = skel_yx[order].astype(float)
    n = len(ordered)
    if n < 8: return method_global(sm, skel_yx, dt, sidx)
    t = np.arange(n, dtype=float)
    s = max(n*2.0, 10.0)
    sy = UnivariateSpline(t, ordered[:, 0], s=s, k=3)
    sx = UnivariateSpline(t, ordered[:, 1], s=s, k=3)
    dsy, dsx = sy.derivative(), sx.derivative()
    inv = np.empty_like(order); inv[order] = np.arange(n)
    raw, raw_edge = [], []
    for i in sidx:
        tv = inv[i]
        dy, dx = float(dsy(tv)), float(dsx(tv))
        nrm = np.hypot(dy, dx)
        if nrm == 0:
            c = skel_yx - skel_yx.mean(axis=0); _, v = np.linalg.eigh(np.cov(c.T))
            perp = v[:, 0]
        else:
            perp = np.array([-dx/nrm, dy/nrm])
        w, edge = _walk(sm, *skel_yx[i], perp)
        raw.append(w); raw_edge.append(edge)
    raw = np.array(raw, dtype=float); raw_edge = np.array(raw_edge)
    ae = raw[~raw_edge]
    if len(ae) == 0: return np.array([])
    # 2.5x-median rejection is the robust-spline's OWN gross-outlier gate (kept);
    # the final +/-10% trim is the retired pre-trim (via _trim).
    med = np.median(ae); aw = ae[ae <= 2.5*med]
    if len(aw) == 0: return np.array([])
    return _trim(aw * RES)

# ── Third family: boundary-normal march (no skeleton) ────────────────────────
# Distinct from EDT (distance transform) and the skeleton transects. It works
# from the strand BOUNDARY: blur the mask, take the Sobel gradient at each
# boundary pixel (the inward normal), march inward until it exits foreground,
# with IQR + angle-consensus filters. Ported from the vendor mask_measure.py.
def _bg_box_blur(img, radius):
    if radius <= 0:
        return img.astype(np.float32, copy=False)
    k = 2 * radius + 1
    kern = np.ones(k, dtype=np.float32) / float(k)
    a = np.pad(img.astype(np.float32), ((0, 0), (radius, radius)), mode='edge')
    a = np.apply_along_axis(lambda m: np.convolve(m, kern, mode='valid'), axis=1, arr=a)
    b = np.pad(a, ((radius, radius), (0, 0)), mode='edge')
    return np.apply_along_axis(lambda m: np.convolve(m, kern, mode='valid'), axis=0, arr=b).astype(np.float32)

def _bg_sobel(img):
    p = np.pad(img, ((1, 1), (1, 1)), mode='edge')
    gx = (p[:-2,:-2] + 2*p[1:-1,:-2] + p[2:,:-2]) - (p[:-2,2:] + 2*p[1:-1,2:] + p[2:,2:])
    gy = (p[:-2,:-2] + 2*p[:-2,1:-1] + p[:-2,2:]) - (p[2:,:-2] + 2*p[2:,1:-1] + p[2:,2:])
    return gx.astype(np.float32), gy.astype(np.float32)

def _bg_boundary(mask):
    m = mask.astype(bool)
    up = np.zeros_like(m); up[1:] = m[:-1]
    dn = np.zeros_like(m); dn[:-1] = m[1:]
    lf = np.zeros_like(m); lf[:,1:] = m[:,:-1]
    rt = np.zeros_like(m); rt[:,:-1] = m[:,1:]
    return np.argwhere(m & (~up | ~dn | ~lf | ~rt))

def _bg_in(mask, x, y):
    H, W = mask.shape
    xi = int(round(x)); yi = int(round(y))
    if xi < 0 or yi < 0 or xi >= W or yi >= H: return False
    return bool(mask[yi, xi])

def _bg_march(mask, x0, y0, dx, dy, step=0.75, max_dist=600.0):
    if not _bg_in(mask, x0, y0): return None
    t = 0.0
    while t <= max_dist:
        t += step
        xi = int(round(x0 + dx*t)); yi = int(round(y0 + dy*t))
        if xi < 0 or yi < 0 or xi >= mask.shape[1] or yi >= mask.shape[0]: return None
        if not mask[yi, xi]: return max(t - step, 0.0)
    return None

def method_boundgrad(sm, skel_yx, dt, sidx,
                     samples=200, step_px=0.75, max_dist=600.0,
                     blur_radius=2, min_grad=1e-3, iqr_k=3.0, angle_tol_deg=5.0):
    score = _bg_box_blur(sm.astype(np.float32), blur_radius)
    gx, gy = _bg_sobel(score)
    boundary = _bg_boundary(sm)
    if boundary.size == 0: return np.array([])
    rng = np.random.default_rng(0)   # seeded → reproducible
    n = min(samples, boundary.shape[0])
    pts = boundary[rng.choice(boundary.shape[0], size=n, replace=False)]
    widths_px, angles = [], []
    probe = max(step_px, 1.0)
    for y0, x0 in pts:
        gxx = float(gx[y0, x0]); gyy = float(gy[y0, x0])
        mag = float(np.hypot(gxx, gyy))
        if mag < min_grad: continue
        dx, dy = gxx / mag, gyy / mag
        plus_in = _bg_in(sm, x0 + dx*probe, y0 + dy*probe)
        minus_in = _bg_in(sm, x0 - dx*probe, y0 - dy*probe)
        if plus_in and not minus_in:    dxi, dyi = dx, dy
        elif minus_in and not plus_in:  dxi, dyi = -dx, -dy
        elif plus_in and minus_in:      dxi, dyi = dx, dy
        else: continue
        w = _bg_march(sm, x0, y0, dxi, dyi, step=step_px, max_dist=max_dist)
        if w is None or w < probe: continue
        widths_px.append(w); angles.append(np.arctan2(dyi, dxi) % np.pi)
    if not widths_px: return np.array([])
    widths_px = np.array(widths_px, dtype=float); angles = np.array(angles, dtype=float)
    if len(widths_px) >= 8:
        q1, q3 = np.quantile(widths_px, [0.25, 0.75]); iqr = q3 - q1
        if iqr > 0:
            keep = (widths_px >= q1 - iqr_k*iqr) & (widths_px <= q3 + iqr_k*iqr)
            widths_px = widths_px[keep]; angles = angles[keep]
    if len(widths_px) >= 8:
        cc = float(np.cos(2*angles).mean()); ss = float(np.sin(2*angles).mean())
        if cc*cc + ss*ss > 1e-12:
            mean_ang = (0.5 * np.arctan2(ss, cc)) % np.pi
            dd = np.abs(angles - mean_ang) % np.pi
            dd = np.minimum(dd, np.pi - dd)
            widths_px = widths_px[dd <= np.deg2rad(angle_tol_deg)]
    return widths_px * RES

METHODS = [
    ('EDT',       method_edt),
    ('Global',    method_global),
    ('Local',     method_local),
    ('Robust',    method_robust),
    ('BoundGrad', method_boundgrad),
]

def evaluate(cases=None, methods=None):
    """Run every method on every case, scoring EACH strand against ITS OWN true
    diameter (calibration data is never scored against an image mean).

    Per case/method returns:
      strand_bias : list of (measured - true) per strand, μm
      med_bias    : median per-strand |bias| for that case (tile 'typical')
      worst_bias  : max per-strand |bias| for that case (tile 'worst')
      n_strands   : strands measured
    The pooled per-strand-bias list across the whole suite is the headline
    calibration distribution (every strand is one point)."""
    cases = cases if cases is not None else CASES
    methods = methods if methods is not None else METHODS
    out = []
    for c in cases:
        mask = c['gen']()
        rec = dict(name=c['name'], truth_um=c['truth_um'], tol_um=c['tol_um'],
                   category=c['category'], curved=c['curved'], xfail=c['xfail'],
                   strand_truths=c['strand_truths'], mask=mask, methods={})
        for mname, mfn in methods:
            meds, cents = per_strand_medians(mask, mfn)
            pairs = _match_truths(meds, cents, c['strand_truths'])
            biases = [m - t for m, t in pairs]
            abias = [abs(b) for b in biases]
            rec['methods'][mname] = dict(
                strand_bias=biases,
                # across-strand summary: MEAN |bias| (every strand weighted
                # equally) + WORST |bias|. Mean is used (not median) so a single
                # failing strand is not masked by many good ones — e.g.
                # edge_touching, where 7 perfect strands + 1 doubled strand give
                # median 0 but mean ~25 and worst 201.
                mean_bias=(float(np.mean(abias)) if abias else np.nan),
                med_bias=(float(np.median(abias)) if abias else np.nan),
                worst_bias=(float(np.max(abias)) if abias else np.nan),
                n_strands=len(biases))
        out.append(rec)
    return out
