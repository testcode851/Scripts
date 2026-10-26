"""
strand_diameter.py
==================

Measure strand diameters from binary segmentation masks using per-strand
perpendicular transects.

USAGE (command line)
--------------------
    # Aggregate CSVs + full JSON (default):
    python strand_diameter.py --input <mask_dir> --output <output_dir>

    # One .out JSON file per image (for parse_measurements_part_level.py):
    python strand_diameter.py --input <mask_dir> --output <output_dir> --out-format out

    # Both:
    python strand_diameter.py --input <mask_dir> --output <output_dir> --out-format both

USAGE (as a library)
--------------------
    from strand_diameter import measure_strand_diameters
    result = measure_strand_diameters(mask, resolution_um_per_px=3.25)
    print(result['image_mean_um'])
    for strand_id, info in result['per_strand'].items():
        print(strand_id, info['mean_um'], info['n_measurements'])

METHOD
------
Each binary mask is processed as follows:

  1. POST-PROCESS: small-hole fill + median filter to clean the mask.
  2. CONNECTED COMPONENTS: separate individual strands via skimage.measure.label.
  3. SKELETON + EDT: medial-axis transform per strand.
  4. PCA: for each strand, fit principal axis = along-strand direction;
     perpendicular direction = orthogonal to it.
  5. STRIDE SAMPLING: sample every Kth skeleton pixel along the principal axis
     so that adjacent measurements are approximately independent.
  6. PERPENDICULAR TRANSECT: at each sampled point, walk pixel-by-pixel in
     +/- perpendicular direction until background is hit. Strand width at
     that cross-section = plus_walk + minus_walk + 1.
  7. EDGE REJECTION: keep only transects that closed on TWO real background
     boundaries; drop those truncated by the image frame (they read short).
  8. AGGREGATION: per-strand point estimate = MEDIAN of its transects; image
     estimate = MEAN across per-strand medians (median within, mean across).

  Retired filters (kept reversible, off by default): the 50 px border margin
  (superseded by step 7), the +/-10% within-strand pre-trim (the median is
  already robust), and the 500 px blob-area floor (skeleton pruning +
  min-transects already remove noise). Set the matching Config field > 0 to
  re-enable any of them.

Tests live in tests/. Run with: pytest tests/
"""

import argparse
import json
import statistics
import sys
import time
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Optional, Tuple

import numpy as np
from PIL import Image
from scipy.ndimage import binary_fill_holes
from skimage import filters, measure, morphology


# ═══════════════════════════════════════════════════════════════════════════
# CONFIGURATION
# ═══════════════════════════════════════════════════════════════════════════

@dataclass
class Config:
    """Parameters for strand diameter measurement."""
    resolution_um_per_px: float = 3.25
    # TAG, DON'T DROP: strands measured on few transects (short/truncated
    # skeletons, or segmentation crumbs) read low & noisy, but we no longer
    # silently discard them -- raw-first reporting. Instead every strand carries
    # a `low_transect_count` flag (True when n_measurements < low_transect_threshold)
    # so a downstream consumer can filter on it. The old hard DROP is retained for
    # reversibility: set min_transects > 0 to drop strands under that count.
    low_transect_threshold: int = 30        # flag (not drop) strands under this
    min_transects: int = 0                  # RETIRED hard-drop; 0 = tag only.
                                            # Set > 0 to restore the old drop.
    stride_px: int = 15
    # RETIRED (kept for reversibility, applied only if > 0):
    #   border_margin_px -- was a 50 px spatial frame exclusion. Retired in favour
    #     of per-transect edge REJECTION (see perpendicular_walk /
    #     measure_single_strand), which is a measurement-validity criterion with no
    #     magic pixel number. Left at 0 (interior_mask returns all-True). Set >0 to
    #     re-enable the old spatial margin.
    #   outlier_tol_frac -- was a +/-10% pre-filter on transects. Retired: the
    #     per-strand point estimate is now the MEDIAN, which is already robust to
    #     junction/necking outliers, so the pre-trim was redundant. Set >0 to
    #     re-enable the trim before the median.
    #   min_strand_area_px -- was a 500 px blob-area floor. Turned OFF (0) because
    #     skeleton pruning + min_transects already remove noise blobs, and a bare
    #     px threshold was hard to justify in the qual package. Set >0 to re-enable.
    border_margin_px: int = 0
    outlier_tol_frac: float = 0.0
    min_strand_area_px: int = 0
    max_transect_half_width_px: int = 200
    postproc_hole_kernel: int = 5
    postproc_median_disk: int = 2
    skeleton_pad_px: int = 10               # pad before medial-axis to avoid edge artifacts
    skeleton_prune_cutoff_ratio: float = 3.0

    def to_dict(self) -> dict:
        return asdict(self)


# ═══════════════════════════════════════════════════════════════════════════
# PRIMITIVES
# ═══════════════════════════════════════════════════════════════════════════

def load_mask(path: Path) -> np.ndarray:
    """Load a binary mask image as uint8 0/1 array."""
    img = np.asarray(Image.open(path))
    if img.ndim == 3:
        img = img[:, :, 0]
    threshold = 127 if img.max() > 1 else 0
    return (img > threshold).astype(np.uint8)


def post_process_mask(mask: np.ndarray, cfg: Config) -> np.ndarray:
    """Fill small holes and smooth the mask with a median filter."""
    kernel = cfg.postproc_hole_kernel
    out = mask
    if kernel:
        # Fill enclosed background holes inside strands only.
        # The invert-fill-invert pattern is intentionally omitted: on images with
        # large black borders (e.g. padded masks) it turns enclosed strands into
        # "holes" and wipes the entire foreground.
        out = binary_fill_holes(out, structure=np.ones((kernel, kernel))).astype(np.uint8)
    if cfg.postproc_median_disk:
        out = filters.median(out, morphology.disk(cfg.postproc_median_disk))
    return out.astype(np.uint8)


def compute_skeleton(mask: np.ndarray, pad: int = 10
                     ) -> Tuple[np.ndarray, np.ndarray]:
    """Return (skeleton, distance_transform) via medial_axis with padding."""
    padded = np.pad(mask, pad, mode='constant', constant_values=0)
    skel_p, dist_p = morphology.medial_axis(padded, return_distance=True)
    return (skel_p[pad:-pad, pad:-pad].astype(np.uint8),
            dist_p[pad:-pad, pad:-pad])


def prune_small_skeleton_fragments(skel: np.ndarray,
                                   cutoff_ratio: float = 3.0) -> np.ndarray:
    """Remove skeleton fragments smaller than mean_area / cutoff_ratio."""
    labels = measure.label(skel)
    if labels.max() == 0:
        return skel
    areas = [r.area for r in measure.regionprops(labels)]
    if not areas:
        return skel
    cutoff = statistics.mean(areas) / cutoff_ratio
    for region in measure.regionprops(labels):
        if region.area < cutoff:
            labels[labels == region.label] = 0
    return (labels > 0).astype(np.uint8)


def interior_mask(shape: Tuple[int, int], margin_px: int) -> np.ndarray:
    """Boolean mask: True away from the image border by >= margin_px."""
    m = np.ones(shape, dtype=bool)
    if margin_px <= 0:                       # guard: -0 slice would blank all
        return m
    m[:margin_px, :] = False
    m[-margin_px:, :] = False
    m[:, :margin_px] = False
    m[:, -margin_px:] = False
    return m


def median_outlier_filter(vals: np.ndarray, tol: float = 0.10) -> np.ndarray:
    if len(vals) == 0:
        return vals
    med = float(np.median(vals))
    return vals[(vals >= (1 - tol) * med) & (vals <= (1 + tol) * med)]


def perpendicular_walk(y0: int, x0: int,
                       perp_dir: np.ndarray,
                       strand_mask: np.ndarray,
                       max_half_width: int) -> Tuple[int, bool, int, int]:
    """Walk pixel-by-pixel perpendicular to strand axis until background hit.

    Returns (total_width_px, edge, plus, minus). `edge` is True if EITHER side
    ran off the image frame or hit max_half_width without finding background --
    such a transect is truncated and reads short, so Global PCA rejects it (per
    Paper A per-transect edge rejection). `plus`/`minus` are the reach in each
    direction (for drawing the transect segment endpoints)."""
    H, W = strand_mask.shape

    def walk(sign: int) -> Tuple[int, bool]:
        for t in range(1, max_half_width):
            y = int(round(y0 + sign * t * perp_dir[0]))
            x = int(round(x0 + sign * t * perp_dir[1]))
            if y < 0 or y >= H or x < 0 or x >= W:
                return t - 1, True          # ran off the frame -> truncated
            if strand_mask[y, x] == 0:
                return t - 1, False         # found a real background boundary
        return max_half_width - 1, True     # never closed -> truncated

    plus, e_plus = walk(+1)
    minus, e_minus = walk(-1)
    return plus + minus + 1, (e_plus or e_minus), plus, minus


def strand_pca(coords: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
    """Return (along_strand_direction, perpendicular_direction) unit vectors."""
    centered = coords - coords.mean(axis=0)
    cov = np.cov(centered.T)
    eigvals, eigvecs = np.linalg.eigh(cov)
    along = eigvecs[:, -1]       # largest eigenvalue
    perpendicular = eigvecs[:, 0]  # smallest eigenvalue
    return along, perpendicular


# ═══════════════════════════════════════════════════════════════════════════
# CORE MEASUREMENT
# ═══════════════════════════════════════════════════════════════════════════

def measure_single_strand(strand_mask: np.ndarray,
                          cfg: Config,
                          interior: np.ndarray) -> Optional[dict]:
    """Measure diameters along a single strand. Returns None if strand is
    unusable (too small, not enough interior skeleton pixels, etc.)."""
    if strand_mask.sum() < cfg.min_strand_area_px:
        return None

    skel, _ = compute_skeleton(strand_mask, pad=cfg.skeleton_pad_px)
    skel = prune_small_skeleton_fragments(skel, cfg.skeleton_prune_cutoff_ratio)
    skel_interior = skel.astype(bool) & interior
    if skel_interior.sum() < 10:
        return None

    coords = np.argwhere(skel_interior)
    along, perp = strand_pca(coords)

    # Order skeleton pixels along the strand axis, then sample at stride.
    # errstate: BLAS matmul raises spurious divide/overflow/invalid FP warnings
    # on some large float arrays even though the result is finite and correct.
    centered = coords - coords.mean(axis=0)
    with np.errstate(divide='ignore', over='ignore', invalid='ignore'):
        projections = centered @ along
    order = np.argsort(projections)
    sampled_idx = order[::cfg.stride_px]
    sampled_coords = coords[sampled_idx]

    # Perpendicular transect at each sampled point. Keep the segment endpoints
    # (in x,y) so the 3-panel renderer draws the SAME transects that were measured.
    widths_px, edges, segs = [], [], []
    for (y0, x0) in sampled_coords:
        w, edge, plus, minus = perpendicular_walk(
            int(y0), int(x0), perp, strand_mask, cfg.max_transect_half_width_px)
        widths_px.append(w)
        edges.append(edge)
        y_a, x_a = y0 + plus * perp[0],  x0 + plus * perp[1]
        y_b, x_b = y0 - minus * perp[0], x0 - minus * perp[1]
        segs.append([(float(x_a), float(y_a)), (float(x_b), float(y_b))])
    widths_px = np.asarray(widths_px, dtype=float)
    edges = np.asarray(edges, dtype=bool)

    # Per-transect edge rejection: keep only transects that closed on TWO real
    # background boundaries (a complete cross-section). Unlike Paper A's Global
    # PCA, there is NO all-edge fallback: a strand whose every transect runs
    # off-frame is a side-clipped partial strand with no measureable cross-section
    # anywhere -> it returns None below and is dropped. This is a
    # measurement-validity criterion (report a strand only when a full
    # cross-section exists), not a spatial border margin -- it drops side-clipped
    # slivers while keeping strands merely shortened at their ends. See
    # border_margin_px=0 in Config.
    keep = ~edges
    widths_px = widths_px[keep]
    segs = [s for s, k in zip(segs, keep) if k]

    diameters_um = widths_px * cfg.resolution_um_per_px
    # Optional +/-10% pre-trim (RETIRED, off when outlier_tol_frac == 0): the
    # per-strand point estimate is the MEDIAN, already robust to junction/necking
    # outliers, so trimming first is redundant. Applied to widths AND their
    # segments in lockstep when re-enabled.
    tol = cfg.outlier_tol_frac
    if tol and len(diameters_um):
        med = float(np.median(diameters_um))
        keep2 = (diameters_um >= (1 - tol) * med) & (diameters_um <= (1 + tol) * med)
        diameters_um = diameters_um[keep2]
        segs = [s for s, k in zip(segs, keep2) if k]

    # Require at least 3 measurements — blobs that barely pass the area threshold
    # can produce 1-2 skeleton pixels at stride, yielding unreliable strand means.
    if len(diameters_um) < 3:
        return None

    # Strand centroid, for downstream reporting
    cy, cx = coords.mean(axis=0)

    return {
        'n_measurements': int(len(diameters_um)),
        'mean_um': float(np.mean(diameters_um)),
        'median_um': float(np.median(diameters_um)),
        'std_um': float(np.std(diameters_um)),
        'min_um': float(np.min(diameters_um)),
        'max_um': float(np.max(diameters_um)),
        'centroid_y_px': float(cy),
        'centroid_x_px': float(cx),
        'strand_area_px': int(strand_mask.sum()),
        'skeleton_interior_px': int(skel_interior.sum()),
        'measurements_um': diameters_um.tolist(),
        'segments': segs,
    }


def measure_strand_diameters(mask: np.ndarray,
                             cfg: Optional[Config] = None
                             ) -> dict:
    """Measure strand diameters in a binary mask using perpendicular transects.

    Parameters
    ----------
    mask : np.ndarray
        Binary mask (H, W) with foreground = 1.
    cfg : Config, optional
        Measurement parameters. Defaults to Config().

    Returns
    -------
    dict with keys:
        'image_mean_um'       : mean across-strand of per-strand means
        'image_std_um'        : std across-strand of per-strand means
        'image_cv_pct'        : CV of across-strand per-strand means
        'pooled_mean_um'      : mean of all measurements from all strands
        'pooled_std_um'       : std of all measurements from all strands
        'n_strands'           : number of strands measured
        'n_measurements_total': total sampled measurements
        'per_strand'          : { strand_id: {...} }
        'config'              : dict of configuration used
    """
    cfg = cfg or Config()
    processed = post_process_mask(mask, cfg)
    labels = measure.label(processed)
    interior = interior_mask(mask.shape, cfg.border_margin_px)
    solidity_for = {r.label: float(r.solidity)
                    for r in measure.regionprops(labels)}

    per_strand = {}
    for sid in range(1, labels.max() + 1):
        strand_mask = (labels == sid).astype(np.uint8)
        result = measure_single_strand(strand_mask, cfg, interior)
        if result is None:
            continue
        result['solidity'] = solidity_for.get(sid, float('nan'))
        # TAG, DON'T DROP: flag strands measured on too few transects (short/
        # truncated skeletons, e.g. clipped by the crop edge, or segmentation
        # crumbs) -- they read low & noisy -- but keep them in the output so
        # nothing is silently discarded. Downstream code can filter on
        # `low_transect_count`.
        result['low_transect_count'] = bool(
            result['n_measurements'] < cfg.low_transect_threshold)
        # Reversible hard-drop: only when min_transects > 0 (retired; default 0).
        if cfg.min_transects and result['n_measurements'] < cfg.min_transects:
            continue
        per_strand[int(sid)] = result

    if not per_strand:
        return {
            'image_mean_um': float('nan'),
            'image_std_um': float('nan'),
            'image_cv_pct': float('nan'),
            'pooled_mean_um': float('nan'),
            'pooled_std_um': float('nan'),
            'n_strands': 0,
            'n_low_transect': 0,
            'n_measurements_total': 0,
            'per_strand': {},
            'config': cfg.to_dict(),
        }

    # Two-level collapse (mean-of-medians): the per-strand point estimate is the
    # MEDIAN of its transects (robust to junction/necking transects that survive
    # the +/-10% filter), then we take the MEAN across strands. Median within,
    # mean across: the across-strand mean is deliberately NOT a median so a
    # genuinely anomalous strand still moves the image number (anomaly-flagging),
    # instead of being masked by the majority of clean strands.
    strand_medians = np.array([v['median_um'] for v in per_strand.values()])
    all_meas = np.concatenate([v['measurements_um'] for v in per_strand.values()])
    n_low = int(sum(v.get('low_transect_count', False) for v in per_strand.values()))

    return {
        'image_mean_um': float(strand_medians.mean()),
        'image_std_um': float(strand_medians.std()),
        'image_cv_pct': float(100 * strand_medians.std() / strand_medians.mean()),
        'pooled_mean_um': float(all_meas.mean()),
        'pooled_std_um': float(all_meas.std()),
        'n_strands': int(len(per_strand)),
        'n_low_transect': n_low,  # strands flagged low_transect_count (kept, not dropped)
        'n_measurements_total': int(len(all_meas)),
        'per_strand': per_strand,
        'config': cfg.to_dict(),
    }


# ═══════════════════════════════════════════════════════════════════════════
# BATCH PROCESSING
# ═══════════════════════════════════════════════════════════════════════════

def write_out_json(result: dict, out_path: Path) -> None:
    """Write a .out JSON file in the format expected by parse_measurements_part_level.py.

    Format: {"diameter_data": {"0": val0, "1": val1, ...}}
    All raw transect measurements are flattened across strands and numbered sequentially.
    """
    flat = []
    for sid in sorted(result['per_strand'].keys()):
        flat.extend(result['per_strand'][sid]['measurements_um'])
    diameter_data = {str(i): float(v) for i, v in enumerate(flat)}
    with open(out_path, 'w') as f:
        json.dump({'diameter_data': diameter_data}, f)


def derive_out_filename(mask_path: Path) -> str:
    """Given a mask filename, produce the .out filename.

    The .out filename must match the *image* filename (not the mask filename),
    because downstream parse_filename() parses image_id and X/Y/Z from it.
    So we strip common mask suffixes before appending .out.

    Examples:
        'foo__X1 Y2 Z3-mask.png'        -> 'foo__X1 Y2 Z3.png.out'
        'foo__X1 Y2 Z3_mask.png'        -> 'foo__X1 Y2 Z3.png.out'
        'foo__X1 Y2 Z3-marked-mask.png' -> 'foo__X1 Y2 Z3-marked-mask.png.out'
        'foo__X1 Y2 Z3.png'             -> 'foo__X1 Y2 Z3.png.out'
    """
    name = mask_path.name  # e.g. 'foo__X1 Y2 Z3-mask.png'
    stem = mask_path.stem  # e.g. 'foo__X1 Y2 Z3-mask'
    ext = mask_path.suffix  # e.g. '.png'

    # Strip mask suffixes but preserve '-marked-mask' as a special case that
    # parse_filename handles directly (per user spec).
    if stem.endswith('-marked-mask'):
        image_stem = stem  # leave as-is, parse_filename knows this form
    elif stem.endswith('-mask'):
        image_stem = stem[:-len('-mask')]
    elif stem.endswith('_mask'):
        image_stem = stem[:-len('_mask')]
    else:
        image_stem = stem

    return f'{image_stem}{ext}.out'


def process_folder(input_dir: Path,
                   output_dir: Path,
                   cfg: Config,
                   out_format: str = 'csv',
                   extensions=('.png', '.tif', '.tiff', '.bmp')) -> None:
    """Process all masks in input_dir and write results to output_dir.

    Parameters
    ----------
    out_format : str
        'csv'  -> per_image_summary.csv, per_strand_results.csv, full_results.json (default)
        'out'  -> one <image>.png.out JSON file per mask (for parse_measurements_part_level.py)
        'both' -> produce both sets of outputs
    """
    output_dir.mkdir(parents=True, exist_ok=True)

    mask_paths = sorted([p for p in input_dir.iterdir()
                         if p.suffix.lower() in extensions])
    if not mask_paths:
        raise FileNotFoundError(f'No mask files found in {input_dir} '
                                f'with extensions {extensions}')

    write_csv_output = out_format in ('csv', 'both')
    write_out_output = out_format in ('out', 'both')

    print(f'Found {len(mask_paths)} mask files in {input_dir}')
    print(f'Output format: {out_format}')
    all_results = {}
    per_image_rows = []
    per_strand_rows = []

    for i, path in enumerate(mask_paths, 1):
        t0 = time.time()
        mask = load_mask(path)
        result = measure_strand_diameters(mask, cfg)
        dt = time.time() - t0
        image_id = path.stem
        all_results[image_id] = result
        result['runtime_s'] = dt
        result['image_path'] = str(path)

        n_low = result.get('n_low_transect', 0)
        low_note = f', {n_low} low-transect flagged' if n_low else ''
        print(f'  [{i}/{len(mask_paths)}] {path.name}: '
              f'{result["n_strands"]} strands{low_note}, '
              f'{result["n_measurements_total"]} measurements, '
              f'mean={result["image_mean_um"]:.2f} um, '
              f'cv={result["image_cv_pct"]:.2f}%, '
              f'{dt:.2f}s')

        # .out JSON per image (for parse_measurements_part_level.py)
        if write_out_output:
            out_name = derive_out_filename(path)
            write_out_json(result, output_dir / out_name)

        # Rows for aggregate CSVs
        per_image_rows.append({
            'image_id': image_id,
            'n_strands': result['n_strands'],
            'n_low_transect': result.get('n_low_transect', 0),
            'n_measurements_total': result['n_measurements_total'],
            'image_mean_um': result['image_mean_um'],
            'image_std_um': result['image_std_um'],
            'image_cv_pct': result['image_cv_pct'],
            'pooled_mean_um': result['pooled_mean_um'],
            'pooled_std_um': result['pooled_std_um'],
            'runtime_s': dt,
        })
        for sid, info in result['per_strand'].items():
            per_strand_rows.append({
                'image_id': image_id,
                'strand_id': sid,
                'n_measurements': info['n_measurements'],
                'low_transect_count': info.get('low_transect_count', False),
                'mean_um': info['mean_um'],
                'median_um': info['median_um'],
                'std_um': info['std_um'],
                'min_um': info['min_um'],
                'max_um': info['max_um'],
                'centroid_y_px': info['centroid_y_px'],
                'centroid_x_px': info['centroid_x_px'],
                'strand_area_px': info['strand_area_px'],
            })

    # Write CSVs
    def write_csv(path, rows):
        if not rows:
            return
        keys = list(rows[0].keys())
        with open(path, 'w') as f:
            f.write(','.join(keys) + '\n')
            for row in rows:
                f.write(','.join(str(row[k]) for k in keys) + '\n')

    if write_csv_output:
        write_csv(output_dir / 'per_image_summary.csv', per_image_rows)
        write_csv(output_dir / 'per_strand_results.csv', per_strand_rows)
        with open(output_dir / 'full_results.json', 'w') as f:
            json.dump(all_results, f, indent=2)

    print(f'\nWrote outputs to {output_dir}')
    if write_csv_output:
        print(f'  per_image_summary.csv, per_strand_results.csv, full_results.json')
    if write_out_output:
        print(f'  {len(mask_paths)} .out JSON files (parse_measurements_part_level format)')


# ═══════════════════════════════════════════════════════════════════════════
# CLI
# ═══════════════════════════════════════════════════════════════════════════

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description='Measure strand diameters from segmentation masks '
                    'using per-strand perpendicular transects.',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='Example:\n'
               '  python strand_diameter.py --input masks/ --output results/\n'
               '  python strand_diameter.py --test')
    p.add_argument('--input', '-i', type=Path,
                   help='Input folder containing mask images (.png/.tif/.bmp)')
    p.add_argument('--output', '-o', type=Path,
                   help='Output folder (CSVs and JSON written here)')
    p.add_argument('--resolution', type=float, default=3.25,
                   help='Pixel resolution in microns per pixel (default 3.25)')
    p.add_argument('--border-margin', type=int, default=0,
                   help='RETIRED spatial frame exclusion (superseded by per-transect '
                        'edge rejection). Skeleton pixels within N px of image edge '
                        'are excluded; default 0 = off. Set >0 to re-enable.')
    p.add_argument('--min-transects', type=int, default=0,
                   help='RETIRED hard-drop (tag-dont-drop replaced it). Drop '
                        'strands measured on fewer than N transects; default 0 = '
                        'off (strands are FLAGGED via low_transect_count instead). '
                        'Set >0 to restore the old drop behaviour.')
    p.add_argument('--low-transect-threshold', type=int, default=30,
                   help='Flag (do NOT drop) strands measured on fewer than N '
                        'transects as low_transect_count (short/truncated skeletons '
                        'or segmentation crumbs read low & noisy); default 30.')
    p.add_argument('--stride', type=int, default=15,
                   help='Sample every Kth skeleton pixel along strand axis '
                        '(default 15)')
    p.add_argument('--outlier-tol', type=float, default=0.0,
                   help='RETIRED +/-tol pre-trim (the per-strand median is already '
                        'robust). Reject values > tol fraction from per-strand '
                        'median; default 0.0 = off. Set e.g. 0.10 to re-enable.')
    p.add_argument('--min-strand-area', type=int, default=0,
                   help='RETIRED blob-area floor (skeleton pruning + min-transects '
                        'already remove noise blobs). Ignore components smaller than '
                        'this area; default 0 = off. Set >0 to re-enable.')
    p.add_argument('--out-format', choices=['csv', 'out', 'both'], default='csv',
                   help='Output format: '
                        'csv = aggregate CSVs + full JSON (default); '
                        'out = one .out JSON per image for parse_measurements_part_level.py; '
                        'both = produce both')
    return p.parse_args()


def main():
    args = parse_args()

    if args.input is None or args.output is None:
        print('ERROR: --input and --output are required (or use --test).',
              file=sys.stderr)
        sys.exit(2)

    cfg = Config(
        resolution_um_per_px=args.resolution,
        border_margin_px=args.border_margin,
        min_transects=args.min_transects,
        low_transect_threshold=args.low_transect_threshold,
        stride_px=args.stride,
        outlier_tol_frac=args.outlier_tol,
        min_strand_area_px=args.min_strand_area,
    )

    process_folder(args.input, args.output, cfg, out_format=args.out_format)


if __name__ == '__main__':
    main()
