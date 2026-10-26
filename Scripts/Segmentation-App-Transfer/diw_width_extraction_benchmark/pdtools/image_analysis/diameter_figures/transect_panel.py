"""Shared 3-panel transect visualisation for strand-diameter results.

  (a) raw image (CLAHE-equalised for legibility)
  (b) predicted mask
  (c) mask silhouette + per-strand perpendicular transects coloured by diameter
      (plasma), each strand annotated with its median diameter (+ solidity if
      available).

This is a RENDERER ONLY. It does not measure anything and does not impose an
aggregation method: pass `aggregate=` to control the number shown in the title so
the figure always matches whatever number your pipeline reports. It works with
either strand_diameter variant:

  * If per-strand dicts carry 'segments' (explicit transect endpoints, as the
    real-time-inference/processing build emits), the exact measured transects are
    drawn. Otherwise transect drawing is skipped and only the silhouette + labels
    are shown -- so the pdtools measurement dict (no 'segments') still renders.
  * 'solidity' is drawn if present; otherwise the solidity line is omitted.

Ported from code/real-time-inference/processing/panel.py (the isob deploy build),
generalised so Paper A / pdtools can share the same figure without adopting that
build's mean-of-medians aggregation or its geometry filters.
"""
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.collections import LineCollection
from matplotlib.colors import Normalize
from matplotlib.cm import ScalarMappable
from skimage import exposure


def mean_of_means(per_strand):
    """Mean across per-strand MEANS (Paper A / pdtools default)."""
    return float(np.mean([v["mean_um"] for v in per_strand.values()]))


def mean_of_medians(per_strand):
    """Mean across per-strand MEDIANS (isob deploy build default)."""
    return float(np.mean([v["median_um"] for v in per_strand.values()]))


def pooled_median(per_strand):
    """Median of all transects pooled across strands."""
    allw = np.concatenate([np.asarray(v["measurements_um"], dtype=float)
                           for v in per_strand.values()])
    return float(np.median(allw))


def render_3panel(raw_gray01, mask, per_strand, title_name, out_path,
                  resolution_um_per_px, label_mode="full",
                  aggregate=mean_of_means, summary_label="mean"):
    """raw_gray01 : (H,W) float [0,1] grayscale (already cropped to `mask`).
    mask         : (H,W) {0,1}.
    per_strand   : {sid: {'measurements_um', 'median_um', 'mean_um',
                          'centroid_x_px', 'centroid_y_px',
                          ['segments'], ['solidity']}}.
    label_mode   : 'full' = 'med <d>\\nsol <s>'; 'median' = just median;
                   'none' = no per-strand text (dense scenes).
    aggregate    : callable(per_strand) -> float for the title number. Pass
                   mean_of_means (default, matches Paper A), mean_of_medians
                   (matches the isob build), or pooled_median. The figure never
                   imposes an aggregation -- it shows whatever you report.
    summary_label: word shown before the value in the title (e.g. 'mean').
    Returns the summary value (um)."""
    img = (exposure.equalize_adapthist(raw_gray01, clip_limit=0.02,
                                       kernel_size=128) * 255.0).astype(np.uint8)
    H, W = mask.shape

    all_widths = np.concatenate([np.asarray(d["measurements_um"], dtype=float)
                                 for d in per_strand.values()])
    img_summary = float(aggregate(per_strand))
    vmin = float(np.percentile(all_widths, 1))
    vmax = max(float(np.percentile(all_widths, 99)), float(all_widths.max()))
    norm = Normalize(vmin=vmin, vmax=vmax)
    cmap = plt.get_cmap("plasma")

    fig, axes = plt.subplots(1, 3, figsize=(18, 6.4), constrained_layout=True)

    # (a) Raw
    ax = axes[0]
    ax.imshow(img, cmap="gray")
    ax.set_title(f"Raw image  ({W}×{H} px)", fontsize=12, fontweight="bold")
    ax.set_xticks([]); ax.set_yticks([])

    # (b) Predicted mask
    ax = axes[1]
    ax.imshow(mask, cmap="gray", vmin=0, vmax=1)
    ax.set_title("Predicted mask", fontsize=12, fontweight="bold")
    ax.set_xticks([]); ax.set_yticks([])

    # (c) Silhouette + transects + per-strand labels
    ax = axes[2]
    silhouette = np.where(mask > 0, 0.85, 0.55)
    ax.imshow(silhouette, cmap="gray", vmin=0, vmax=1)

    # Draw the exact measured transects only if the caller supplied segment
    # endpoints. The pdtools measurement dict does not, so we skip cleanly.
    all_segs, all_cols = [], []
    for d in per_strand.values():
        if not d.get("segments"):
            continue
        for seg, w in zip(d["segments"], d["measurements_um"]):
            all_segs.append(seg); all_cols.append(cmap(norm(w)))
    if all_segs:
        ax.add_collection(LineCollection(all_segs, colors=all_cols,
                                         linewidths=0.7, alpha=0.95))

    if label_mode != "none":
        sorted_strands = sorted(per_strand.items(),
                                key=lambda kv: kv[1]["centroid_x_px"])
        n = len(sorted_strands)
        y_min, y_max = H * 0.10, H * 0.90
        for i, (sid, d) in enumerate(sorted_strands):
            cx, cy = d["centroid_x_px"], d["centroid_y_px"]
            med = float(d["median_um"])
            sol = d.get("solidity", None)
            has_sol = sol is not None and not np.isnan(sol)
            fc = "#8b0000" if (has_sol and sol < 0.85) else "black"
            y_lab = y_min + (y_max - y_min) * (i / max(1, n - 1))
            if label_mode == "full" and has_sol:
                text = f"med {med:.0f}\nsol {sol:.2f}"
            else:
                text = f"{med:.0f}"
            ax.annotate(text, xy=(cx, cy), xytext=(cx, y_lab),
                        textcoords="data", ha="center", va="center",
                        fontsize=8, color="white",
                        bbox=dict(boxstyle="round,pad=0.25", fc=fc, ec="none",
                                  alpha=0.88),
                        arrowprops=dict(arrowstyle="-", color="black", lw=0.5,
                                        alpha=0.55),
                        zorder=6)

    ax.set_title(f"Perpendicular transects (color = diameter)\n"
                 f"{len(per_strand)} strands · image {summary_label} "
                 f"{img_summary:.1f} μm",
                 fontsize=12, fontweight="bold")
    ax.set_xticks([]); ax.set_yticks([])
    ax.set_xlim(0, W); ax.set_ylim(H, 0)

    fig.colorbar(ScalarMappable(norm=norm, cmap=cmap), ax=ax,
                 fraction=0.046, pad=0.02, shrink=0.92,
                 label="Perpendicular diameter (μm)")

    fig.suptitle(title_name, fontsize=10, y=1.02)
    plt.savefig(out_path, dpi=140, bbox_inches="tight")
    plt.close(fig)
    return img_summary
