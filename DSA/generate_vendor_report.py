"""Create a Word/PDF report from the LIVE results after notebook Section 8.4.

Notebook usage (keep this file next to the notebook):
    from generate_vendor_report import generate_report
    files = generate_report(globals(), source_label="Optimus export September 2026")

No notebook execution, CSV edits, cleanup, tolerance pooling, or network access.
See REPORT_GENERATION_README.md for setup and the optional portable bundle mode.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
from decimal import Decimal
import hashlib
import importlib.util
import json
from pathlib import Path
from uuid import uuid4
from xml.sax.saxutils import escape

import numpy as np
import pandas as pd

VERSION = "1.1"
KEYS = ["feature_type", "material_family", "size", "unit", "nominal",
        "upper_tolerance", "lower_tolerance"]
REQUIRED = {
    "broad_records": ["broad_id", "vendor_id", "actual"],
    "broad_inventory": ["broad_id", "comparison_available"],
    "broad_measured": ["broad_id", "vendor_id", "part_number", "comparison_id", "feature_name",
                       "actual", "calculated_deviation", "date", "unit_assumed_standard"] + KEYS,
    "broad_vendor_metrics": ["broad_id", "vendor_id", "measurements", "parts", "feature_groups",
        "median_deviation", "median_absolute_deviation_from_nominal", "iqr_deviation",
        "p95_absolute_deviation", "first_date", "last_date", "missing_dates", "assumed_standard_records"],
    "broad_equal_part": ["broad_id", "vendor_id", "equal_part_mean_feature_median",
                         "small_feature_groups", "small_parts"],
    "broad_part_mix": ["broad_id", "vendor_id", "part_number", "measurements", "feature_groups",
                       "record_share_percent", "included_in_comparison"],
    "broad_pair_comparison": ["broad_id", "vendor_a", "vendor_b", "shared_eligible_feature_groups",
        "shared_comparison_ids", "pooled_difference_b_minus_a", "equal_part_difference_b_minus_a",
        "shared_difference_b_minus_a", "observed_date_ranges_overlap"],
}


def number(value):
    """Retain small nonzero differences rather than rounding them to zero."""
    return "Unavailable" if pd.isna(value) else format(Decimal(f"{float(value):.5g}"), "f")


def date_text(value):
    return "Unknown" if pd.isna(value) else pd.Timestamp(value).strftime("%Y-%m-%d")


def direction(value):
    if pd.isna(value):
        return "No shared reference"
    if abs(float(value)) <= 1e-12:
        return "Approximately equal"
    return "B lower" if value < 0 else "B higher"


def validate_results(namespace):
    """Fail clearly on incomplete or inconsistent notebook results before writing."""
    missing = [name for name in REQUIRED if name not in namespace]
    if missing:
        raise ValueError("Run the notebook through Section 8.4 first. Missing: " + ", ".join(missing))
    for name, columns in REQUIRED.items():
        frame = namespace[name]
        if not isinstance(frame, pd.DataFrame):
            raise TypeError(f"{name} must be a pandas DataFrame.")
        absent = set(columns) - set(frame.columns)
        if absent:
            raise ValueError(f"{name} is missing {sorted(absent)}. Rerun Sections 6-8.")
    minimum = namespace.get("MIN_VENDOR_MEASUREMENTS")
    if not isinstance(minimum, (int, np.integer)) or minimum < 2:
        raise ValueError("MIN_VENDOR_MEASUREMENTS must be an integer of at least 2.")
    data = namespace["broad_measured"]
    metrics = namespace["broad_vendor_metrics"]
    if data.empty:
        if not metrics.empty or not namespace['broad_pair_comparison'].empty or not namespace['broad_equal_part'].empty:
            raise ValueError("Empty records but populated summaries. Rerun Section 8.")
        return
    if data[KEYS + ["vendor_id", "part_number", "comparison_id"]].isna().any().any():
        raise ValueError("Included records have missing context or identifiers. Rerun the eligibility checks.")
    if not np.isfinite(data[["actual", "nominal", "calculated_deviation"]].astype(float)).all().all():
        raise ValueError("Included measurements must be finite.")
    if not np.allclose(data.actual - data.nominal, data.calculated_deviation, rtol=1e-10, atol=1e-12):
        raise ValueError("Deviation no longer matches actual minus nominal.")
    if not data.feature_type.str.strip().str.casefold().eq("parallelism").all():
        raise ValueError("This report template is for parallelism only.")
    if not data.groupby("broad_id")[KEYS].nunique().eq(1).all().all():
        raise ValueError("A broad ID contains different recorded requirements.")
    if not data.groupby('comparison_id')[KEYS + ['part_number', 'feature_name']].nunique().eq(1).all().all():
        raise ValueError("A detailed comparison ID contains different parts, features, or requirements.")
    identity = ["broad_id", "vendor_id"]
    counts = data.groupby(identity).size().sort_index()
    recorded = metrics.set_index(identity).measurements.sort_index()
    if not counts.index.equals(recorded.index) or not np.array_equal(counts.values, recorded.values):
        raise ValueError("Record counts and summaries disagree. Rerun Section 8.")
    if counts.lt(minimum).any() or data.groupby("broad_id").vendor_id.nunique().lt(2).any():
        raise ValueError("Included vendors do not meet the notebook comparison thresholds.")
    medians = data.assign(_absolute=data.calculated_deviation.abs()).groupby(identity)._absolute.median()
    if not np.allclose(medians.sort_index(), metrics.set_index(identity)
                       .median_absolute_deviation_from_nominal.sort_index(), rtol=1e-10, atol=1e-12):
        raise ValueError("Medians and records disagree. Rerun Section 8.")
    feature = data.assign(_absolute=data.calculated_deviation.abs()).groupby(
        identity + ["part_number", "comparison_id"])._absolute.median()
    balanced = feature.groupby(level=[0, 1, 2]).mean().groupby(level=[0, 1]).mean().sort_index()
    stored = namespace["broad_equal_part"].set_index(identity).equal_part_mean_feature_median.sort_index()
    if not balanced.index.equals(stored.index) or not np.allclose(balanced, stored, rtol=1e-10, atol=1e-12):
        raise ValueError("Equal-part summaries disagree with records. Rerun Section 8.")
    # The narrative relies on pair differences, so verify these against records too.
    from itertools import combinations
    pair_frame = namespace['broad_pair_comparison']
    expected_pairs = {(bid, a, b) for bid, group in data.groupby('broad_id')
                      for a, b in combinations(sorted(group.vendor_id.unique()), 2)}
    actual_pairs = set(pair_frame[['broad_id', 'vendor_a', 'vendor_b']].itertuples(index=False, name=None))
    if expected_pairs != actual_pairs or len(actual_pairs) != len(pair_frame):
        raise ValueError('Vendor-pair coverage is stale. Rerun Section 8.4.')
    feature_counts = data.groupby(identity + ['part_number', 'comparison_id']).size()
    for pair in pair_frame.itertuples():
        bid, a, b = pair.broad_id, pair.vendor_a, pair.vendor_b
        fa, fb = feature.loc[(bid, a)], feature.loc[(bid, b)]
        ca, cb = feature_counts.loc[(bid, a)], feature_counts.loc[(bid, b)]
        common = ca.loc[ca.ge(minimum)].index.intersection(cb.loc[cb.ge(minimum)].index)
        shared = (fb.loc[common].groupby(level=0).mean().mean() -
                  fa.loc[common].groupby(level=0).mean().mean()) if len(common) else np.nan
        expected = [medians.loc[(bid, b)] - medians.loc[(bid, a)],
                    balanced.loc[(bid, b)] - balanced.loc[(bid, a)], shared]
        actual = [pair.pooled_difference_b_minus_a, pair.equal_part_difference_b_minus_a,
                  pair.shared_difference_b_minus_a]
        if pair.shared_eligible_feature_groups != len(common) or not np.allclose(
                actual, expected, equal_nan=True, rtol=1e-10, atol=1e-12):
            raise ValueError('Vendor-pair differences are stale. Rerun Section 8.4.')


def _chart(data, path, palette):
    """Fresh report figure using the same records, full range, and KDE convention."""
    import matplotlib.pyplot as plt
    from matplotlib.lines import Line2D
    from matplotlib.ticker import MaxNLocator
    import seaborn as sns

    vendors = sorted(data.vendor_id.unique(), key=str)
    height = max(3.1, 1.6 + .31 * len(vendors))
    with plt.rc_context({"font.size": 9, "axes.titlesize": 10, "axes.labelsize": 9,
                         "savefig.facecolor": "white"}):
        fig, (box, kde) = plt.subplots(1, 2, figsize=(10, height), sharex=True,
                                     gridspec_kw={"width_ratios": [1, 1.15]})
        try:
            vectors = [data.loc[data.vendor_id.eq(v), "calculated_deviation"].astype(float) for v in vendors]
            artists = box.boxplot(vectors, vert=False, patch_artist=True, widths=.5,
                                 flierprops={"marker": "o", "markersize": 2, "alpha": .4},
                                 medianprops={"color": "#222222"})
            handles, labels = [], []
            for i, (v, values, patch) in enumerate(zip(vendors, vectors, artists["boxes"])):
                color = palette[str(v)]
                patch.set_facecolor(color)
                selected = data.loc[data.vendor_id.eq(v)]
                n_parts, n_features = selected.part_number.nunique(), selected.comparison_id.nunique()
                labels.append(f"{v}  n={len(values):,}\n{n_parts} part{'s' if n_parts != 1 else ''} / "
                              f"{n_features} feature{'s' if n_features != 1 else ''}")
                style = ["-", "--", "-.", ":"][i % 4]
                constant = values.nunique() < 2 or values.std() == 0
                if constant:
                    kde.axvline(float(values.iloc[0]), color=color, linestyle=style, linewidth=1.8)
                else:
                    # Seaborn uses Scott bandwidth by default; one call per vendor
                    # normalizes each curve independently, regardless of sample count.
                    sns.kdeplot(x=values, fill=True, alpha=.18, color=color, cut=0, linewidth=0, ax=kde)
                    sns.kdeplot(x=values, fill=False, color=color, cut=0, linewidth=1.7, linestyle=style, ax=kde)
                handles.append(Line2D([0], [0], color=color, linestyle=style,
                    label=f"{v} (n={len(values):,})" + (" constant" if constant else "")))
            box.set_yticks(range(1, len(vendors) + 1), labels)
            box.invert_yaxis()
            box.set_title("Typical value and spread")
            kde.set_title("Where measurements cluster")
            kde.set_ylabel("Density (not a count or percent)")
            kde.legend(handles=handles, fontsize=8, loc="upper right", framealpha=.85)
            lo = min(0., float(data.calculated_deviation.min()))
            hi = max(0., float(data.calculated_deviation.max()))
            pad = (hi - lo) * .035 if hi > lo else .00001
            for ax in (box, kde):
                ax.axvline(0, color="#666666", linestyle=":", linewidth=.8)
                ax.set_xlim(lo - pad, hi + pad)
                ax.set_xlabel("Difference from target (actual - nominal)")
                ax.ticklabel_format(axis="x", style="plain", useOffset=False)
                ax.xaxis.set_major_locator(MaxNLocator(5))
                ax.tick_params(axis="x", labelsize=8)
                ax.grid(axis="x", alpha=.18)
                ax.set_axisbelow(True)
            fig.tight_layout(pad=1)
            fig.savefig(path, dpi=180)
        finally:
            plt.close(fig)


def _context(row):
    return (f"{row['feature_type']} | {row['material_family']} | {row['size']} | units recorded as {row['unit']}. "
            f"Target (nominal): {number(row['nominal'])}. Recorded tolerances: "
            f"upper {number(row['upper_tolerance'])}, lower {number(row['lower_tolerance'])}.")


def prepare_report(namespace, *, source_label, output_dir=None, data_kind="production"):
    """Snapshot the report content and figures without changing notebook objects.

    Returns a JSON path; this portable bundle can be rendered in another Python
    environment. A NEW subfolder is always created to avoid overwriting reports.
    data_kind is 'production' or 'synthetic'; both reports remain review drafts.
    """
    validate_results(namespace)
    if not str(source_label).strip():
        raise ValueError("Provide a source_label identifying the dataset or export date.")
    if data_kind not in ("production", "synthetic"):
        raise ValueError("data_kind must be production or synthetic.")
    data = namespace["broad_measured"]
    metrics = namespace["broad_vendor_metrics"]
    pairs = namespace["broad_pair_comparison"]
    equal = namespace["broad_equal_part"]
    minimum = int(namespace["MIN_VENDOR_MEASUREMENTS"])
    now = datetime.now(timezone.utc)
    base = Path(output_dir) if output_dir else Path(__file__).resolve().parent / "vendor_reports"
    folder = base / (now.strftime("report_%Y%m%d_%H%M%S_") + uuid4().hex[:6])
    folder.mkdir(parents=True, exist_ok=False)
    (folder / "figures").mkdir()
    blocks = []

    def paragraph(text):
        blocks.append({"kind": "paragraph", "text": text})

    def heading(text, level=1):
        blocks.append({"kind": "heading", "text": text, "level": level})

    def table(headers, rows, widths, chunk=14):
        rows = [[str(x) for x in row] for row in rows]
        if not rows:
            paragraph("No qualifying results are available for this table.")
        for start in range(0, len(rows), chunk):
            if start:
                blocks.append({"kind": "pagebreak"})
                heading("Table continued", 2)
            blocks.append({"kind": "table", "headers": headers, "rows": rows[start:start + chunk], "widths": widths})

    def page(title):
        blocks.append({"kind": "pagebreak"})
        heading(title)

    def chart(frame, filename):
        _chart(frame, folder / "figures" / filename, palette)
        blocks.append({"kind": "image", "path": "figures/" + filename,
                       "alt": "Vendor boxplots and independently normalized density curves"})

    heading("Parallelism vendor comparison results", 0)
    paragraph("Draft for project review" + (" - SYNTHETIC TEST DATA" if data_kind == "synthetic" else ""))
    paragraph(f"Source: {source_label}. Generated {now.strftime('%Y-%m-%d %H:%M UTC')}.")
    paragraph("We compared vendors' parallelism measurements to see how their results differ. We started "
              "with parts that have matching material, size, units, and specifications, then checked the "
              "findings against cases where vendors measured the same feature on the same part.")
    eligible = len(namespace["broad_records"])
    included = len(data)
    matched = pairs.loc[pairs.shared_eligible_feature_groups.gt(0)]
    agree = sum(direction(r.pooled_difference_b_minus_a) == direction(r.shared_difference_b_minus_a)
                for r in matched.itertuples())
    changed = sum(direction(r.pooled_difference_b_minus_a) != direction(r.equal_part_difference_b_minus_a)
                  for r in pairs.itertuples())
    paragraph(f"The comparison covers {included:,} of {eligible:,} measurements available after the earlier "
              f"data checks ({100 * included / eligible:.1f}%)." if eligible else "No parallelism measurements are available after the data checks.")
    paragraph(f"Of {len(namespace['broad_inventory']):,} combinations of recorded requirements, "
              f"{data.broad_id.nunique():,} had enough measurements from at least two vendors. "
              f"The remaining {eligible - included:,} measurements could not be included under this rule. "
              "Being left out does not mean a measurement is incorrect.")
    if len(matched):
        paragraph(f"We could check {len(matched):,} of the {len(pairs):,} vendor comparisons using the same "
                  "parts and features. " +
                  ("All of these checks supported the broader finding about which vendor had the smaller "
                   "typical distance from the target, or whether their results were about equal."
                   if agree == len(matched) else
                   f"In {agree:,} of these checks, the result agreed with the broader comparison about which "
                   "vendor had the smaller typical distance from the target, or whether they were about equal. "
                   "The other comparisons need a closer look at the parts and features included."))
    else:
        paragraph("No vendor comparison had enough measurements of the same part and feature for a direct check.")
    weighting_note = (
        "Giving each part an equal say in the summary did not change which vendor had the smaller value "
        "in any comparison, including cases where the values were about equal."
        if changed == 0 else
        f"Giving each part an equal say changed the result in {changed:,} of {len(pairs):,} comparisons. "
        "This shows that the number of measurements from each part or feature can affect the overall picture."
    ) if len(pairs) else "There are no qualifying vendor pairs for the check that gives each part equal weight."
    paragraph(weighting_note)
    paragraph("These findings help us decide where to look more closely. They do not establish which vendor "
              "is best overall: vendors may be making parts of different difficulty, and the measurements "
              "may come from different inspection periods or batches.")
    group_rows = []
    for bid, frame in data.groupby("broad_id", sort=True):
        r = frame.iloc[0]
        group_rows.append([bid, r.material_family, r['size'], r.unit, frame.vendor_id.nunique(),
                           frame.part_number.nunique(), f"{len(frame):,}"])
    table(["Group", "Material", "Size", "Unit label", "Vendors", "Parts", "Records"],
          group_rows, [.65, 1.15, .7, 1.05, .65, .6, .8])

    page("How we made the comparisons")
    paragraph("A feature is a specific characteristic measured on a part. For the broader comparison, we "
              "allowed different parts and feature names, but kept the feature type, material, size category, "
              "unit, target value, and both tolerances the same. We also made a more direct comparison wherever "
              "vendors measured the same named feature on the same part.")
    paragraph(f"Each broader group needed at least two vendors with {minimum} usable measurements each. "
              "Those measurements can come from several parts or features. For a direct check, both vendors "
              f"needed at least {minimum} measurements of the same feature on the same part.")
    heading("How we prepared the data", 2)
    paragraph("We removed extra copies of identical rows and left out rows without a size. As agreed, we "
              "treated blank units as Standard and kept Standard and Metric separate. We assumed matching "
              "unit labels and parallelism definitions mean the same thing across vendors. Measurements "
              "without the other information needed for comparison were also left out.")
    paragraph("Different target values or tolerances stayed in separate groups, even when the numbers "
              "were close. The charts show the measured value minus the target value, also called deviation. "
              "Zero means the measurement equals the target; a negative value is below the target.")
    heading("Why we checked the results two ways", 2)
    paragraph("The combined charts include every usable measurement, so a part measured frequently has "
              "more influence. We also calculated a summary that gives each part equal weight. This checks "
              "whether one heavily measured part is driving the comparison. The calculation details and "
              "counts are included at the back of the report.")
    heading("How to read the charts and tables", 2)
    paragraph("In each boxplot, the line inside the box is the middle value, called the median. The box "
              "holds the middle half of the measurements; a wider box means more spread. Dots beyond the "
              "whiskers show unusual values, but do not automatically mean a part failed inspection.")
    paragraph("The smooth curves show where measurements tend to cluster. A curve farther to the right "
              "shows larger differences from the target. Curve height is not a count, percentage, or quality "
              "score. Each vendor's curve is scaled separately so vendors with different sample sizes can "
              "be compared. If all values are the same, a line replaces the curve.")
    paragraph("The tables show the typical difference, the spread of the middle half, and a value that "
              "about 95% of distances from the target fall at or below. These describe different aspects "
              "of the results: a smaller typical value does not necessarily mean less variation.")

    import seaborn as sns
    vendor_ids = sorted(data.vendor_id.unique(), key=str)
    palette = dict(zip(map(str, vendor_ids), sns.color_palette("colorblind", max(1, len(vendor_ids))).as_hex()))
    # Preserve the notebook's existing color identity where available.
    from matplotlib.colors import to_hex
    for key, color in namespace.get("parallelism_vendor_colors", {}).items():
        if str(key) in palette:
            palette[str(key)] = to_hex(color)

    for bid, frame in data.groupby("broad_id", sort=True):
        row = frame.iloc[0]
        page(f"{bid} {row['size']} part results")
        paragraph(_context(row))
        paragraph("These charts show the measurements for the parts each vendor supplied. Keep the parts "
                  "in mind when comparing vendors: matching specifications do not necessarily mean the "
                  "parts are equally difficult to make.")
        # Split large vendor sets into readable panels; preserve all vendors and
        # explicitly disclose that each panel has its own full data range.
        vendors = sorted(frame.vendor_id.unique(), key=str)
        for start in range(0, len(vendors), 6):
            if start:
                page(f"{bid} vendor figures continued")
            subset = frame.loc[frame.vendor_id.isin(vendors[start:start + 6])]
            if len(vendors) > 6:
                paragraph(f"Vendor panel {start // 6 + 1}. Each panel shows its own full measurement range; compare axis values.")
            chart(subset, f"broad_{bid}_{start // 6 + 1}.png")
        part = metrics.loc[metrics.broad_id.eq(bid)]
        table(["Vendor", "Measurements", "Typical difference (median)", "Spread of middle half", "95% distance value"],
              [[r.vendor_id, f"{r.measurements:,}", number(r.median_deviation), number(r.iqr_deviation),
                number(r.p95_absolute_deviation)] for r in part.itertuples()], [.85, .75, 1.1, 1.1, 1.8])
        pp = pairs.loc[pairs.broad_id.eq(bid)]
        paragraph(f"We could check {int(pp.shared_eligible_feature_groups.gt(0).sum())} of the {len(pp)} "
                  "vendor comparisons in this group using the same parts and features. The supporting "
                  "tables and charts at the back show which parts and features were included.")
        comparisons = pp.loc[pp.shared_eligible_feature_groups.gt(0)]
        for check in comparisons.head(3).itertuples():
            delta = check.shared_difference_b_minus_a
            if abs(delta) <= 1e-12:
                observation = f"Vendors {check.vendor_a} and {check.vendor_b} had about the same typical distance from the target on the features they both measured."
            else:
                lower, higher = ((check.vendor_b, check.vendor_a) if delta < 0 else (check.vendor_a, check.vendor_b))
                observation = (f"On the features both vendors measured, vendor {lower} had a smaller typical "
                               f"distance from the target than {higher}. The difference between their summaries "
                               f"was {number(abs(delta))} in the recorded units.")
            same = direction(delta) == direction(check.pooled_difference_b_minus_a)
            count = check.shared_eligible_feature_groups
            paragraph(observation + f" This check covers {count} matching feature{'s' if count != 1 else ''} "
                      f"({check.shared_comparison_ids}). "
                      + ("It supports the broader finding." if same else
                         "This differs from the broader finding, so the parts and features included need a closer look."))
        if len(comparisons) > 3:
            paragraph("The first three shared comparisons are described here; all remaining pairs appear in the appendix.")
        if not comparisons.empty:
            paragraph("This finding concerns typical distance from the target. The spread and unusually large "
                      "values still need to be considered separately.")

    page("What the results mean and what to check next")
    paragraph("The broader charts show how vendors' measurements differ across the work they supplied. "
              "The checks using the same parts and features give us a more direct comparison. Even then, "
              "inspection dates, batches, and measurement methods may differ.")
    paragraph(weighting_note + " Giving parts equal weight helps us check the effect of measurement counts, "
              "but it does not make different parts equally difficult to manufacture.")
    paragraph("The next step is to review the differences with engineering and quality. Check whether the "
              "parts are comparable in practice, whether vendors were inspected during similar periods, "
              "and whether unusual measurements can be explained by the inspection records. Any decision "
              "to combine similar tolerances should be agreed with engineering.")
    paragraph("Use this report to guide those discussions and decide where further investigation is "
              "worthwhile. It does not establish an overall vendor ranking, prove that a difference is "
              "caused by the vendor, or calculate inspection failure rates.")
    paragraph("The appendix contains the full comparison tables and supporting charts, including missing "
              "dates and cases where vendors do not have measurements of the same parts and features.")

    page("Appendix comparison details")
    paragraph("In these tables, distance from the target means the size of the difference, whether a "
              "measurement is above or below the target. The combined result, labeled Pooled, is the median "
              "of these distances across all included measurements for a vendor.")
    paragraph("For the Equal part result, we take the median distance for each feature, average the feature "
              "medians within each part, then average those part summaries. This gives features equal weight "
              "within a part and gives parts equal weight overall. It is not the median of all measurements. "
              "The Shared result uses the same calculation, restricted to the exact features both vendors "
              "measured on the same parts.")
    paragraph("Every difference below is vendor B's result minus vendor A's result, in the recorded units. "
              "A negative number means B has the smaller distance; a positive number means B has the larger "
              "distance. No reference means we could not make a direct check using the same parts and features.")
    for bid, frame in pairs.groupby("broad_id", sort=True):
        heading(str(bid), 2)
        table(["Vendor A", "Vendor B", "Shared features", "Pooled difference", "Equal part difference", "Shared difference"],
              [[r.vendor_a, r.vendor_b, r.shared_eligible_feature_groups, number(r.pooled_difference_b_minus_a),
                number(r.equal_part_difference_b_minus_a),
                "No reference" if pd.isna(r.shared_difference_b_minus_a) else number(r.shared_difference_b_minus_a)]
               for r in frame.itertuples()], [.85, .85, .65, .95, 1., 1.3], chunk=10)

    page("Appendix parts included in the comparison")
    paragraph("Share percent shows how much of a vendor's data in that group comes from each part. Included "
              "is No when a vendor does not have enough measurements to enter the comparison. Those counts "
              "remain visible so you can see what was left out.")
    mix = namespace["broad_part_mix"]
    table(["Group", "Vendor", "Part", "Records", "Features", "Share percent", "Included"],
          [[r.broad_id, r.vendor_id, r.part_number, f"{r.measurements:,}", r.feature_groups,
            f"{r.record_share_percent:.1f}", "Yes" if r.included_in_comparison else "No"]
           for r in mix.itertuples()], [.55, .8, 1.1, .7, .65, .95, .85], chunk=14)
    heading("Equal part summary", 2)
    paragraph(f"Small features and small parts have fewer than {minimum} measurements each. They still "
              "contribute if the vendor qualifies for the broader group; their counts are shown so their "
              "influence can be reviewed.")
    m_index = metrics.set_index(["broad_id", "vendor_id"])
    table(["Group", "Vendor", "Pooled absolute median", "Equal part summary", "Small features", "Small parts"],
          [[r.broad_id, r.vendor_id, number(m_index.loc[(r.broad_id, r.vendor_id), "median_absolute_deviation_from_nominal"]),
            number(r.equal_part_mean_feature_median), r.small_feature_groups, r.small_parts]
           for r in equal.itertuples()], [.6, .8, 1.2, 1.2, .9, .95], chunk=14)

    page("Appendix inspection dates and units")
    paragraph("These are the earliest and latest inspection dates available for each vendor in each group. "
              "Overlapping date ranges do not mean the same batches or inspection dates were compared. "
              "Assumed units counts the measurements where a blank unit was filled with Standard.")
    table(["Group", "Vendor", "First date", "Last date", "Missing dates", "Assumed units"],
          [[r.broad_id, r.vendor_id, date_text(r.first_date), date_text(r.last_date), r.missing_dates,
            int(r.assumed_standard_records)] for r in metrics.itertuples()], [.6, .8, 1.05, 1.05, 1.05, 1.1])
    table(["Group", "Vendor A", "Vendor B", "Date ranges overlap"],
          [[r.broad_id, r.vendor_a, r.vendor_b, r.observed_date_ranges_overlap] for r in pairs.itertuples()],
          [.7, 1.15, 1.15, 2.6])

    # Derive shared IDs from actual records instead of parsing comma-delimited labels.
    counts = data.groupby(["broad_id", "comparison_id", "vendor_id"]).size()
    qualifying = counts.loc[counts.ge(minimum)].reset_index(name="n")
    shared_ids = qualifying.groupby(["broad_id", "comparison_id"]).vendor_id.nunique()
    shared_ids = shared_ids.loc[shared_ids.ge(2)]
    for index, ((bid, gid), _) in enumerate(shared_ids.items()):
        if index % 2 == 0:
            page("Appendix comparisons on the same parts and features")
        allowed = qualifying.loc[qualifying.broad_id.eq(bid) & qualifying.comparison_id.eq(gid), "vendor_id"]
        subset = data.loc[data.broad_id.eq(bid) & data.comparison_id.eq(gid) & data.vendor_id.isin(allowed)]
        row = subset.iloc[0]
        heading(f"{gid} Part {row.part_number}", 2)
        paragraph(f"{row.feature_name}. {_context(row)}")
        # Larger sets remain complete and are split as in the broad figures.
        vendors = sorted(subset.vendor_id.unique(), key=str)
        for start in range(0, len(vendors), 6):
            if start:
                page("Shared feature vendors continued")
            chart(subset.loc[subset.vendor_id.isin(vendors[start:start + 6])],
                  f"shared_{bid}_{index}_{start}.png")
        paragraph("These vendors measured the same part and feature. Their inspection periods and batches may still differ.")
    if shared_ids.empty:
        paragraph("No detailed feature in the included broad groups has two vendors meeting the per-feature minimum.")

    # Hash the report's record snapshot for traceability, not the source file.
    hashed = pd.util.hash_pandas_object(data, index=True).values.tobytes()
    metadata = {"generator_version": VERSION, "created_utc": now.isoformat(), "source_label": source_label,
                "data_kind": data_kind, "minimum_vendor_measurements": minimum,
                "eligible_records": eligible, "included_records": included,
                "broad_contexts": len(namespace["broad_inventory"]), "qualifying_contexts": len(group_rows),
                "pair_comparisons": len(pairs), "pairs_with_shared_reference": len(matched),
                "pooled_shared_direction_agreements": agree, "weighting_direction_changes": changed,
                "record_snapshot_sha256": hashlib.sha256(hashed).hexdigest()}
    bundle = folder / "report_content.json"
    bundle.write_text(json.dumps({"metadata": metadata, "blocks": blocks}, indent=2, ensure_ascii=False), encoding="utf-8")
    return bundle


def _asset(folder, relative):
    path = (folder / relative).resolve()
    if not path.is_relative_to(folder.resolve()):
        raise ValueError("Report images must be inside the report bundle folder.")
    return path


def _write_docx(content, folder):
    from docx import Document
    from docx.enum.table import WD_TABLE_ALIGNMENT, WD_CELL_VERTICAL_ALIGNMENT
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    from docx.shared import Inches, Pt, RGBColor

    doc = Document()
    section = doc.sections[0]
    section.page_width, section.page_height = Inches(8.5), Inches(11)
    section.top_margin = section.bottom_margin = Inches(.65)
    section.left_margin = section.right_margin = Inches(.7)
    styles = doc.styles
    for name in ("Normal", "Title", "Heading 1", "Heading 2"):
        styles[name].font.name = "Calibri"
        styles[name].font.color.rgb = RGBColor(0, 0, 0)
    styles["Normal"].font.size = Pt(10)
    styles["Normal"].paragraph_format.space_after = Pt(6)
    styles["Normal"].paragraph_format.line_spacing = 1.05
    styles["Title"].font.size = Pt(24)
    styles["Heading 1"].font.size = Pt(17)
    styles["Heading 2"].font.size = Pt(12)
    footer = section.footer.paragraphs[0]
    footer.text = "Parallelism comparison | Draft for review | "
    field = OxmlElement("w:fldSimple")
    field.set(qn("w:instr"), "PAGE")
    footer._p.append(field)
    footer.style = styles["Normal"]
    if content["metadata"]["data_kind"] == "synthetic":
        section.header.paragraphs[0].text = "SYNTHETIC TEST DATA - NOT PRODUCTION FINDINGS"
    for block in content["blocks"]:
        kind = block["kind"]
        if kind == "heading":
            doc.add_paragraph(block["text"], style="Title" if block["level"] == 0 else f"Heading {block['level']}")
        elif kind == "paragraph":
            doc.add_paragraph(block["text"])
        elif kind == "pagebreak":
            doc.add_page_break()
        elif kind == "image":
            p = doc.add_paragraph()
            p.paragraph_format.keep_with_next = True
            shape = p.add_run().add_picture(str(_asset(folder, block["path"])), width=Inches(7.05))
            shape._inline.docPr.set("descr", block["alt"])
        elif kind == "table":
            table = doc.add_table(rows=1, cols=len(block["headers"]))
            table.alignment = WD_TABLE_ALIGNMENT.CENTER
            table.autofit = False
            scale = 7.05 / sum(block["widths"])
            for col, width in zip(table.columns, block["widths"]):
                col.width = Inches(width * scale)
            header_flag = OxmlElement("w:tblHeader")
            table.rows[0]._tr.get_or_add_trPr().append(header_flag)
            for i, values in enumerate([block["headers"]] + block["rows"]):
                row = table.rows[0] if i == 0 else table.add_row()
                no_split = OxmlElement("w:cantSplit")
                row._tr.get_or_add_trPr().append(no_split)
                for j, (cell, value) in enumerate(zip(row.cells, values)):
                    cell.width = Inches(block["widths"][j] * scale)
                    cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
                    cell.text = str(value)
                    props = cell._tc.get_or_add_tcPr()
                    shade = OxmlElement("w:shd")
                    shade.set(qn("w:fill"), "E2EAF0" if i == 0 else ("F5F7F9" if i % 2 == 0 else "FFFFFF"))
                    props.append(shade)
                    borders = OxmlElement("w:tcBorders")
                    margins = OxmlElement("w:tcMar")
                    for side in ("top", "left", "bottom", "right"):
                        edge = OxmlElement(f"w:{side}")
                        edge.set(qn("w:val"), "single"); edge.set(qn("w:sz"), "4"); edge.set(qn("w:color"), "D9D9D9")
                        borders.append(edge)
                        margin = OxmlElement(f"w:{side}")
                        margin.set(qn("w:w"), "75"); margin.set(qn("w:type"), "dxa")
                        margins.append(margin)
                    props.append(borders); props.append(margins)
                    for paragraph in cell.paragraphs:
                        paragraph.paragraph_format.space_after = Pt(2)
                        for run in paragraph.runs:
                            run.font.size = Pt(8.5); run.bold = i == 0
            doc.add_paragraph().paragraph_format.space_after = Pt(2)
    path = folder / "parallelism_vendor_report.docx"
    doc.save(path)
    return path


def _write_pdf(content, folder):
    from reportlab.lib import colors
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import inch
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Table, TableStyle, Image, PageBreak, Spacer
    from PIL import Image as PILImage

    path = folder / "parallelism_vendor_report.pdf"
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle("Body", fontName="Helvetica", fontSize=10, leading=13, spaceAfter=7))
    styles.add(ParagraphStyle("Cell", fontName="Helvetica", fontSize=8, leading=10))
    styles["Title"].alignment = 0
    styles["Title"].fontSize = 24
    styles["Title"].leading = 28
    styles["Heading1"].fontSize = 17
    styles["Heading1"].leading = 21
    styles["Heading2"].fontSize = 12
    width = 7.05 * inch
    story = []
    for block in content["blocks"]:
        kind = block["kind"]
        if kind in ("heading", "paragraph"):
            style = styles["Body"] if kind == "paragraph" else styles["Title" if block["level"] == 0 else f"Heading{block['level']}"]
            story.append(Paragraph(escape(block["text"]), style))
        elif kind == "pagebreak":
            story.append(PageBreak())
        elif kind == "image":
            p = _asset(folder, block["path"])
            with PILImage.open(p) as im:
                w, h = im.size
            story.append(Image(str(p), width=width, height=width * h / w))
            story.append(Spacer(1, 5))
        elif kind == "table":
            data = [[Paragraph(escape(str(x)), styles["Cell"]) for x in row]
                    for row in [block["headers"]] + block["rows"]]
            table = Table(data, colWidths=[width * w / sum(block["widths"]) for w in block["widths"]], repeatRows=1)
            table.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#E2EAF0")),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F5F7F9")]),
                ("GRID", (0, 0), (-1, -1), .5, colors.HexColor("#D9D9D9")),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]))
            story.extend([table, Spacer(1, 9)])
    def footer(canvas, doc):
        canvas.saveState()
        canvas.setFont("Helvetica", 8)
        canvas.drawString(.7 * inch, .35 * inch, "Parallelism comparison | Draft for review")
        canvas.drawRightString(7.8 * inch, .35 * inch, str(doc.page))
        if content["metadata"]["data_kind"] == "synthetic":
            canvas.drawString(.7 * inch, 10.65 * inch, "SYNTHETIC TEST DATA - NOT PRODUCTION FINDINGS")
        canvas.restoreState()
    SimpleDocTemplate(str(path), pagesize=(8.5 * inch, 11 * inch), leftMargin=.7 * inch,
        rightMargin=.7 * inch, topMargin=.65 * inch, bottomMargin=.65 * inch,
        title="Parallelism vendor comparison results", author="").build(story, onFirstPage=footer, onLaterPages=footer)
    return path


def write_report(bundle, formats=("docx", "pdf")):
    """Render the same content to Word and PDF without requiring Word/LibreOffice."""
    formats = tuple(formats)
    if not formats or set(formats) - {"docx", "pdf"}:
        raise ValueError("formats must contain docx and/or pdf.")
    modules = {"docx": "docx", "pdf": "reportlab"}
    for fmt in formats:
        if importlib.util.find_spec(modules[fmt]) is None:
            raise RuntimeError("Missing report dependencies. In a notebook cell run: %pip install python-docx reportlab")
    bundle = Path(bundle).resolve()
    content = json.loads(bundle.read_text(encoding="utf-8"))
    outputs = {"content": bundle}
    for fmt in formats:
        target = bundle.parent / f"parallelism_vendor_report.{fmt}"
        if target.exists():
            raise FileExistsError(f"{target} already exists. Generate a new report to preserve the previous version.")
    for fmt in formats:
        outputs[fmt] = (_write_docx if fmt == "docx" else _write_pdf)(content, bundle.parent)
    return outputs


def generate_report(namespace, *, source_label, output_dir=None, data_kind="production", formats=("docx", "pdf")):
    """Public notebook entry point. Reads existing results; writes a new report folder."""
    bundle = prepare_report(namespace, source_label=source_label, output_dir=output_dir, data_kind=data_kind)
    return write_report(bundle, formats=formats)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle", type=Path, help="Render a report_content.json previously made by prepare_report")
    parser.add_argument("--formats", nargs="+", choices=["docx", "pdf"], default=["docx", "pdf"])
    args = parser.parse_args()
    if not args.bundle:
        parser.error("Use generate_report(globals(), source_label=...) in the notebook after Section 8.4, or pass --bundle.")
    for kind, path in write_report(args.bundle, args.formats).items():
        print(f"{kind}: {path}")
