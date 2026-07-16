# Lead Request Summary: Coverage-Aware Company Scoring

## What My Lead Is Asking For

My lead wants a scoring approach that handles missing data gracefully. In the short term, we should define a small set of basic indicators (example given: reported profits going up, down, or staying the same). In the longer term, the vision is a broader multi-metric model where each metric is converted to LOW, MEDIUM, or HIGH. A company should be scored only on metrics it has data for, and missing metrics should be excluded from the average instead of penalizing the company.

## Practical Interpretation

The key requirement is a **coverage-aware scoring model**:

1. Each metric has clear scoring rules (`LOW`, `MEDIUM`, `HIGH`).
2. Each company is evaluated only on available metrics.
3. Composite score is calculated from available metrics only.
4. Coverage is shown separately so users know confidence level.

## Why This Is Needed

Companies will not all have the same data availability. If we force every company to have all metrics, results become biased and hard to compare. A coverage-aware approach standardizes scoring despite incomplete inputs and is easier to explain in dashboards and reviews.

## What We Can Do Now (Short-Term Plan)

1. Define a small v1 metric set (for example 3-5 metrics).
2. Include profit trend metric with thresholds for `UP`, `SAME`, `DOWN`.
3. Convert all metric outputs into LOW/MEDIUM/HIGH scoring bands.
4. Compute company composite from available metrics only.
5. Add coverage fields:
   - `available_metric_count`
   - `total_metric_count`
   - `coverage_pct`
6. Add a guardrail flag for low coverage (example: below 50% metrics available).

## Data Source Clarification

USAspending provides award/contract data, not reported profits. Profit trend must come from separate financial sources.

Likely sources:

1. SEC data for public companies (CIK/ticker-based).
2. Paid/private financial datasets for private companies.
3. Internal financial datasets if available.

## How SEC Data Can Be Linked to USAspending Entities

There is no universal direct key between SEC (CIK/ticker) and USAspending (UEI/DUNS). We should create and maintain a bridge/crosswalk table.

Example bridge fields:

- `uei`
- `duns`
- `recipient_name`
- `cik`
- `ticker`
- `match_method`
- `match_confidence`
- `last_verified_date`

This allows us to compute profit metrics from SEC data and join results back to our UEI-based schema.

## Schema Impact

The current normalized schema (`award_fact`, `entity_master`, `relationships`) does not need to be replaced. We can extend analytics with derived scoring tables.

Suggested additions:

1. `metric_scores` (company x metric x score x availability)
2. `company_score_summary` (overall score, rating, coverage, confidence flag)

This is a schema extension for analytics, not a redesign of the core model.

## Recommended Dashboard Outputs

1. Overall company rating (`LOW`/`MEDIUM`/`HIGH`).
2. Coverage/confidence indicator (`n available / n total`, `coverage_pct`).
3. Metric-level detail showing included vs missing metrics.
4. Profit trend indicator (`UP`/`SAME`/`DOWN`) with period definition.
5. Parent-level rollups using existing UEI hierarchy.

## Suggested Message Back to Lead

We can implement a coverage-aware scoring framework where each metric maps to LOW/MEDIUM/HIGH and companies are scored only on metrics with available data. Missing metrics will be excluded from the average, and we will show a separate coverage/confidence indicator so low-data companies are transparent. We can start with a small v1 indicator set (including profit trend), then expand over time. This can be implemented as derived scoring tables on top of the current normalized schema.

