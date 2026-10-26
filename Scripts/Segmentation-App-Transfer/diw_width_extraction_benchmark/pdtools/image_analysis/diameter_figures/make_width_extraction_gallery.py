"""make_width_extraction_gallery.py — the comprehensive visual record.

Runs all four measurement heads on every synthetic geometry (from the single
source of truth, width_extraction_eval) and renders one tile per case: the
mask + a per-method ERROR table (signed bias + |err| μm, colour-graded by
magnitude). No pass/fail. Output: width_extraction_gallery.png.
"""
from pathlib import Path
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.gridspec as gridspec

import width_extraction_eval as W

HEAD_COLOR = '#333333'

def err_color(ae):
    if not np.isfinite(ae): return '#999999'
    if ae <= 3:  return '#1a7f37'
    if ae <= 8:  return '#b8860b'
    if ae <= 20: return '#d9730d'
    return '#c0392b'

rows = W.evaluate()

# ── text summary (errors, no pass/fail) ──────────────────────────────────────
mnames = [m[0] for m in W.METHODS]
print(f'\n{"case":<26} {"truth":>6}  ' + ' '.join(f'{n:>10}' for n in mnames) + '   (mean/worst per-strand |bias| μm)')
print('─' * 96)
for r in rows:
    cells = []
    for n in mnames:
        m = r['methods'][n]
        cells.append(' n/a' if not np.isfinite(m['mean_bias']) else f'{m["mean_bias"]:.0f}/{m["worst_bias"]:.0f}')
    tag = ' [xfail]' if r['xfail'] else ''
    print(f'{r["name"][:26]:<26} {r["truth_um"]:>6.1f}  ' + ' '.join(f'{c:>10}' for c in cells) + tag)

# ── layout plan: group by category, each category starts on a fresh grid row
#    with a full-width header band; cases ordered easy->hard within category. ──
ncols = 4
plan = []          # list of ('header', category) or ('case', row_dict, col)
grid_rows = 0      # number of TEST rows (each test row = 3 gridspec sub-rows)
header_rows = []   # gridspec-row index (in test-row units) that is a header
for cat in W.CATEGORY_ORDER:
    cat_rows = [r for r in rows if r['category'] == cat]
    if not cat_rows:
        continue
    header_rows.append(grid_rows)
    plan.append(('header', cat, grid_rows))
    grid_rows += 1                                   # header occupies one test-row slot
    for j, r in enumerate(cat_rows):
        tr = grid_rows + j // ncols
        tc = j % ncols
        plan.append(('case', r, tr, tc))
    grid_rows += (len(cat_rows) + ncols - 1) // ncols

fig_h = 5.0 * grid_rows
fig = plt.figure(figsize=(5.0 * ncols, fig_h), dpi=110)
gs = gridspec.GridSpec(3 * grid_rows, ncols, figure=fig,
                       height_ratios=[2.7, 1.7, 1.1] * grid_rows,
                       hspace=0.28, wspace=0.12,
                       top=0.995, bottom=0.005)

def _draw_case(r, tr, tc):
    ax_mask = fig.add_subplot(gs[3*tr, tc])
    ax_tab = fig.add_subplot(gs[3*tr+1, tc])
    ax_mask.imshow(r['mask'], cmap='gray'); ax_mask.set_xticks([]); ax_mask.set_yticks([])
    title = r['name'] + ('  [xfail]' if r['xfail'] else '') + ('  ·curved' if r['curved'] else '')
    ax_mask.set_title(f'{title}\ntruth {r["truth_um"]:.0f} μm', fontsize=9)
    ax_tab.axis('off')
    # method table: header + one row per method, spaced to fit within this axis
    nrows = len(mnames) + 1
    hy, rh = 0.98, 0.98 / nrows
    ax_tab.text(0.02, hy, 'Method',        transform=ax_tab.transAxes, fontsize=8.5,
                fontweight='bold', color=HEAD_COLOR, family='monospace', va='top')
    ax_tab.text(0.98, hy, 'mean (worst) μm', transform=ax_tab.transAxes, fontsize=8.5,
                fontweight='bold', color=HEAD_COLOR, family='monospace', va='top', ha='right')
    for k, nm in enumerate(mnames):
        md = r['methods'][nm]['mean_bias']
        wo = r['methods'][nm]['worst_bias']
        y = hy - (k + 1) * rh
        col = err_color(wo)   # colour by worst-strand error
        s = 'n/a' if not np.isfinite(md) else f'{md:.1f} ({wo:.1f})'
        ax_tab.text(0.02, y, nm, transform=ax_tab.transAxes, fontsize=8.5,
                    family='monospace', color=col, va='top')
        ax_tab.text(0.98, y, s, transform=ax_tab.transAxes, fontsize=8.5,
                    family='monospace', color=col, va='top', fontweight='bold', ha='right')
    # concise verified failure note (wrapped) — its OWN sub-row axis so it can
    # never overlap the table above or the tile below.
    ax_note = fig.add_subplot(gs[3*tr+2, tc])
    ax_note.axis('off')
    note = W.NOTES.get(r['name'], '')
    if note:
        import textwrap
        wrapped = '\n'.join(textwrap.wrap(note, width=58))
        ax_note.text(0.0, 0.95, wrapped, transform=ax_note.transAxes, fontsize=7.5,
                     style='italic', color='#4c566a', va='top')

for item in plan:
    if item[0] == 'header':
        _, cat, tr = item
        axh = fig.add_subplot(gs[3*tr:3*tr+2, :])   # full-width band
        axh.axis('off')
        axh.add_patch(plt.Rectangle((0, 0.15), 1, 0.6, transform=axh.transAxes,
                                    facecolor='#eceff4', edgecolor='#4c566a', linewidth=1))
        axh.text(0.01, 0.45, cat, transform=axh.transAxes, fontsize=15,
                 fontweight='bold', va='center', color='#2e3440')
    else:
        _, r, tr, tc = item
        _draw_case(r, tr, tc)

# (No suptitle/header strip — the per-method summary lives in the analysis
#  figure; the gallery starts directly at the first category band. The
#  method-level median/max summary is still printed to stdout below.)
def _pool(i):   # pooled per-strand |bias| across non-xfail cases
    v = []
    for r in rows:
        if r['xfail']: continue
        v += [abs(b) for b in r['methods'][mnames[i]]['strand_bias']]
    return np.array(v) if v else np.array([np.nan])
print('\npooled per-strand |bias| μm (excluding %d xfail): %s' % (
    sum(r['xfail'] for r in rows),
    ' · '.join(f'{n} med {np.median(_pool(i)):.1f}/mean {_pool(i).mean():.1f}/max {_pool(i).max():.0f}'
               for i, n in enumerate(mnames))))

out = str(Path(__file__).resolve().parent / 'width_extraction_gallery.png')
plt.savefig(out, dpi=120, bbox_inches='tight')
print(f'\nSaved: {out}')
