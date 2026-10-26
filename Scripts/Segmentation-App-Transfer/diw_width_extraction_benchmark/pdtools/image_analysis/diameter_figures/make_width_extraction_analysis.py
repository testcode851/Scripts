"""make_width_extraction_analysis.py — the compact error/analysis figure.

Consumes the single source of truth (width_extraction_eval) and produces:
  (a) |median bias| vs ground-truth diameter, 4 methods, 27 non-pathological
      cases; curved cases drawn as OPEN markers so the curvature behaviour is
      visible in one figure (no separate curvature plot).
  (b) per-method error boxplots (threshold-free).
Output: width_extraction_analysis.png  (+ width_extraction_errors.csv)
"""
from pathlib import Path
import csv
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

import width_extraction_eval as W

STYLE = {'EDT': ('#d62728', 'o'), 'Global': ('#1f77b4', 'D'),
         'Local': ('#ff7f0e', '^'), 'Robust': ('#2ca02c', 's'),
         'BoundGrad': ('#9467bd', 'P')}
LABEL = {'EDT': 'EDT + skeleton', 'Global': 'Global PCA (proposed)',
         'Local': 'Local tangent', 'Robust': 'Robust spline',
         'BoundGrad': 'Boundary-normal march'}

rows = W.evaluate()
nonpath = [r for r in rows if not r['xfail']]
mnames = [m[0] for m in W.METHODS]

fig, (axA, axB) = plt.subplots(1, 2, figsize=(11, 4.6),
                               gridspec_kw={'width_ratios': [2.4, 1]})

# (a) PER-STRAND |bias| vs that strand's own true diameter (every strand is a
#     point; straight=filled, curved=open). Sorted-match pairs each measured
#     strand to its truth, so multi-width cases contribute one point per strand.
def _strand_points(r, nm):
    tr_sorted = sorted(r['strand_truths']) if len(r['strand_truths']) > 1 else None
    biases = r['methods'][nm]['strand_bias']
    if tr_sorted is None:
        return [(r['truth_um'], abs(b)) for b in biases]
    n = min(len(biases), len(tr_sorted))
    return [(tr_sorted[i], abs(biases[i])) for i in range(n)]
for nm in mnames:
    color, mk = STYLE[nm]
    st, cv = [], []
    for r in nonpath:
        pts = _strand_points(r, nm)
        (cv if r['curved'] else st).extend(pts)
    if st:
        xs, ys = zip(*st)
        axA.scatter(xs, ys, c=color, marker=mk, s=42, alpha=0.85,
                    edgecolors='k', linewidth=0.3, label=LABEL[nm], zorder=3)
    if cv:
        xs, ys = zip(*cv)
        axA.scatter(xs, ys, facecolors='none', marker=mk, s=52,
                    edgecolors=color, linewidth=1.4, zorder=4)
axA.axhspan(0, 3, color='green', alpha=0.10, zorder=0)
axA.axhline(3, color='green', ls='--', lw=1, zorder=1)
axA.text(120, 3.4, r'$\pm$3 μm reference band', fontsize=8, color='green')
axA.scatter([], [], facecolors='none', edgecolors='gray', marker='o',
            linewidth=1.4, s=52, label='(open = curved case)')
axA.set_yscale('symlog', linthresh=10)
axA.set_yticks([0, 3, 10, 30, 100, 300, 900])
axA.set_yticklabels(['0', '3', '10', '30', '100', '300', '900'])
axA.set_xlabel('Ground-truth diameter (μm)', fontsize=11)
axA.set_ylabel('per-strand |bias| (μm, symlog)', fontsize=11)
nstr = sum(r['methods'][mnames[0]]['n_strands'] for r in nonpath)
axA.set_title(f'(a) Per-strand bias vs diameter — {nstr} strands, {len(nonpath)} cases', fontsize=11)
axA.legend(fontsize=8, loc='upper right', framealpha=0.95)
axA.grid(alpha=0.25, ls=':')

# (b) pooled per-strand error boxplots (every strand a point)
data = [np.array([abs(b) for r in nonpath for b in r['methods'][nm]['strand_bias']])
        for nm in mnames]
pos = np.arange(len(mnames))[::-1]
bp = axB.boxplot(data, positions=pos, vert=False, widths=0.6, showfliers=True,
                 patch_artist=True, medianprops=dict(color='k', lw=1.5),
                 flierprops=dict(marker='.', markersize=4, alpha=0.5))
for patch, nm in zip(bp['boxes'], mnames):
    patch.set_facecolor(STYLE[nm][0]); patch.set_alpha(0.7)
for p, nm in zip(pos, mnames):
    axB.text(np.median(data[mnames.index(nm)]), p + 0.33,
             f'med {np.median(data[mnames.index(nm)]):.1f}', fontsize=8, ha='center')
axB.set_yticks(pos)
axB.set_yticklabels([LABEL[n].replace(' (proposed)', '\n(proposed)') for n in mnames], fontsize=9)
axB.set_xscale('symlog', linthresh=10)
axB.set_xticks([0, 3, 10, 30, 100, 300]); axB.set_xticklabels(['0', '3', '10', '30', '100', '300'])
axB.set_xlabel('per-strand |bias| (um, symlog)', fontsize=11)
axB.set_title(f'(b) Per-strand error distribution ({nstr} strands)', fontsize=11)
axB.grid(axis='x', alpha=0.25, ls=':')

plt.tight_layout()
out = Path(__file__).resolve().parent / 'width_extraction_analysis.png'
plt.savefig(out, dpi=300, bbox_inches='tight')
print('saved', out)

# stats + per-case CSV
print('\nmethod       median  mean   p90    max')
for nm in mnames:
    v = data[mnames.index(nm)]
    print('%-10s %6.1f %5.1f %5.1f %6.1f' % (LABEL[nm][:10], np.median(v), v.mean(), np.percentile(v, 90), v.max()))
with open(Path(__file__).resolve().parent / 'width_extraction_errors.csv', 'w', newline='') as f:
    w = csv.writer(f)
    w.writerow(['case', 'truth_um', 'n_strands', 'curved', 'xfail']
               + [f'{n}_mean' for n in mnames] + [f'{n}_worst' for n in mnames])
    for r in rows:
        ns = r['methods'][mnames[0]]['n_strands']
        w.writerow([r['name'], f'{r["truth_um"]:.1f}', ns, r['curved'], r['xfail']]
                   + [f'{r["methods"][n]["mean_bias"]:.1f}' if np.isfinite(r['methods'][n]['mean_bias']) else 'nan' for n in mnames]
                   + [f'{r["methods"][n]["worst_bias"]:.1f}' if np.isfinite(r['methods'][n]['worst_bias']) else 'nan' for n in mnames])
print('wrote width_extraction_errors.csv (per-strand across-strand MEAN + worst)')
