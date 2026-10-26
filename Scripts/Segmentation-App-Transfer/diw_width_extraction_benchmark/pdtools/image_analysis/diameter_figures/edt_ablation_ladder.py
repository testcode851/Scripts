"""EDT ablation ladder — isolates WHERE the improvement comes from.

Four rungs, identical aggregation (median-within-strand, mean-across-strands)
and identical rejection rules, so each step adds exactly ONE change:

  A  pooled EDT          : medial axis of the WHOLE mask, no CC separation,
                           ALL skeleton pixels, ONE median for the image
                           (the incumbent the paper criticises).
  B  component EDT       : + CC separation, per-strand median, ALL skel pixels.
  C  component+stride EDT: + stride-15 skeleton subsampling (== the eval's
                           current `method_edt`, i.e. Table 1's "EDT").
  D  transect (Global)   : replace the EDT read with a perpendicular walk
                           (== Table 1's proposed head).

Scored the SAME way as width_extraction_eval: each strand against ITS OWN
truth. Pooled (A) reports one number per image, so its per-strand bias is
|pooled_value - truth_i| for each strand i (this is exactly the paper's
"one mean describes no strand" argument, made quantitative).

Run:
  /Users/brianweston/miniforge3/envs/diw-metrology/bin/python \
      -m pdtools.image_analysis.diameter_figures.edt_ablation_ladder
"""
import sys
from pathlib import Path
import numpy as np
from skimage.morphology import medial_axis
from skimage.measure import label, regionprops

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
import pdtools.image_analysis.diameter_figures.width_extraction_eval as EV

RES = EV.RES


def rung_pooled_edt(mask):
    """A: medial axis on the whole foreground, no CC split, one median (μm)."""
    skel, dt = medial_axis(mask.astype(bool), return_distance=True, rng=0)
    d = 2.0 * dt[skel] * RES
    return float(np.median(d)) if d.size else np.nan


def rung_component_edt_allpix(mask):
    """B: per-strand EDT median over ALL skeleton pixels (stride=1)."""
    return EV.per_strand_medians(mask, EV.method_edt, stride=1)


def rung_component_stride_edt(mask):
    """C: per-strand EDT median over stride-15 pixels (== eval's method_edt)."""
    return EV.per_strand_medians(mask, EV.method_edt, stride=15)


def rung_transect_global(mask):
    """D: per-strand Global-PCA transect (== the proposed head)."""
    return EV.per_strand_medians(mask, EV.method_global, stride=15)


def per_strand_biases(case):
    """Return dict rung -> list of per-strand |bias| μm for one case."""
    mask = case['gen']()
    truths = case['strand_truths']
    out = {}

    # A: pooled → one value, compared against every strand's own truth
    pooled = rung_pooled_edt(mask)
    out['A_pooled'] = [abs(pooled - t) for t in truths] if np.isfinite(pooled) else []

    # B, C, D: per-strand medians, matched to truths by the eval's matcher
    for key, fn in [('B_component', rung_component_edt_allpix),
                    ('C_comp_stride', rung_component_stride_edt),
                    ('D_transect', rung_transect_global)]:
        meds, cents = fn(mask)
        pairs = EV._match_truths(meds, cents, truths)
        out[key] = [abs(m - t) for m, t in pairs]
    return out


def summarize(abias):
    a = np.array(abias, dtype=float)
    if a.size == 0:
        return dict(n=0, mean=np.nan, median=np.nan, max=np.nan)
    return dict(n=a.size, mean=float(a.mean()), median=float(np.median(a)),
                max=float(a.max()))


def main():
    cases = [c for c in EV.CASES if not c['xfail']]
    rungs = ['A_pooled', 'B_component', 'C_comp_stride', 'D_transect']
    pooled_all = {r: [] for r in rungs}

    print(f"\n{'case':<24}" + "".join(f"{r.split('_',1)[1]:>16}" for r in rungs))
    print(f"{'':24}" + "".join(f"{'mean/max':>16}" for r in rungs))
    print("-" * (24 + 16 * len(rungs)))
    for c in cases:
        b = per_strand_biases(c)
        for r in rungs:
            pooled_all[r].extend(b[r])
        row = f"{c['name']:<24}"
        for r in rungs:
            s = summarize(b[r])
            row += f"{s['mean']:6.1f}/{s['max']:<6.1f}".rjust(16) if s['n'] else f"{'---':>16}"
        print(row)

    print("-" * (24 + 16 * len(rungs)))
    print(f"{'POOLED (all strands)':<24}", end="")
    agg = {}
    for r in rungs:
        s = summarize(pooled_all[r])
        agg[r] = s
        print(f"{s['mean']:6.1f}/{s['max']:<6.1f}".rjust(16), end="")
    print()
    print(f"{'  n strands':<24}" + "".join(f"{agg[r]['n']:>16}" for r in rungs))
    print(f"{'  median |bias|':<24}" + "".join(f"{agg[r]['median']:>16.1f}" for r in rungs))

    print("\nWHERE THE JUMP IS (mean |bias| μm, pooled over all strands):")
    order = ['A_pooled', 'B_component', 'C_comp_stride', 'D_transect']
    labels = {'A_pooled': 'pooled EDT', 'B_component': 'component EDT (all px)',
              'C_comp_stride': 'component+stride EDT', 'D_transect': 'transect (Global)'}
    prev = None
    for r in order:
        m = agg[r]['mean']
        delta = "" if prev is None else f"   (Δ {m - prev:+.1f} from previous rung)"
        print(f"  {labels[r]:<24} mean {m:5.1f}  max {agg[r]['max']:6.1f}{delta}")
        prev = m


if __name__ == "__main__":
    main()
