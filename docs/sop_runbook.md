# SOP Runbook: USAspending Parent-Child-Award Pipeline

## 1) Purpose and Scope

This runbook defines how to operate the `usaspending_data_pull_refined.py` pipeline in a repeatable way that is stable enough for dashboard use and controlled enough for audit and review. The script can return many candidate parent records when search terms are ambiguous, so this SOP is designed to reduce noisy output while preserving traceability.

The core objective is to produce reliable normalized outputs:

- `entity_master.csv`
- `relationships.csv`
- `award_fact.csv`

These files are intended to be the preferred analytical path for downstream reporting and dashboard refreshes.

The script also creates dashboard-friendly readable exports in `output/powerbi_prototype`:

- `entity_master.csv`
- `award_fact_readable.csv`
- `relationships_readable.csv`

This runbook covers operations only. It does not require code changes.

---

## 2) Why This SOP Exists

The USAspending recipient search endpoint can return many valid-looking parent-level rows for one company name, especially short or ambiguous names. If all candidates are passed downstream, the `children` and `awards` steps process a large number of unrelated UEIs, which can increase runtime, timeout warnings, and false positives in reporting.

The SOP addresses this by separating work into two lanes:

- a production lane optimized for automation and stability
- an exception lane used for adjudicating new or ambiguous entities

This allows most runs to be automated while still preserving coverage through periodic review of edge cases.

---

## 3) Roles and Accountability

The pipeline is both a technical process and a data-governance process. The technical process fetches and transforms records. The governance process decides which parent mapping is authoritative.

Use the following role model:

| Role | Responsibility |
|---|---|
| Pipeline Operator | Runs commands, monitors logs, stores outputs, executes this SOP |
| Data Steward / Analyst | Reviews ambiguous parent matches and approves mappings |
| Product/Business Owner | Defines the business meaning of "parent" and sign-off policy |
| Dashboard Owner | Consumes normalized outputs and validates refresh quality |

Parent mapping policy should be defined once by the business owner and used consistently.

---

## 4) Data Model Intent

The pipeline outputs normalized hierarchy and award tables:

`entity_master.csv` stores one row per entity keyed by UEI and includes resolved ultimate parent fields. This table is the canonical entity dimension.

`relationships.csv` stores child-to-parent edges and confidence/source metadata. This table is the canonical hierarchy relationship table.

`award_fact.csv` stores award facts with both recipient UEI and resolved ultimate parent UEI. This table is the canonical dashboard fact table.

This structure avoids reliance on embedded JSON hierarchy context and supports stable joins in BI tools.

---

## 5) Operating Modes

### Production Mode (Default)

Production mode is designed for frequent refreshes with low warning volume and high consistency. Use strict matching and a curated input list.

### Exception Review Mode

Exception mode is used when onboarding new companies or when production results are ambiguous. Use assist matching to inspect candidates, then capture approved mappings before returning to production mode.

---

## 6) One-Time Setup

### 6.1 Environment and Dependencies

Create and activate your virtual environment, then install required packages.

```bash
python -m venv .venv
.\.venv\Scripts\activate
pip install pandas requests openpyxl
```

### 6.2 Create a Run Folder Convention

Use a dated run directory for each cycle so artifacts and logs stay organized.

Example naming convention:

- `runs/2026-04-09_prod`
- `runs/2026-04-09_exception`

### 6.3 Create Governance Files

Create and maintain two governance files outside the script:

1. `approved_parent_mappings.csv`
2. `parent_review_queue.csv`

Suggested columns for `approved_parent_mappings.csv`:

| Column | Description |
|---|---|
| `original_company_name` | Input name from Company Excel |
| `approved_parent_name` | Canonical parent name |
| `approved_parent_uei` | Canonical parent UEI |
| `approved_parent_duns` | Canonical parent DUNS (if available) |
| `status` | `approved` or `retired` |
| `effective_date` | Date mapping became active |
| `reviewed_by` | Reviewer |
| `review_notes` | Rationale / source |

Suggested columns for `parent_review_queue.csv`:

| Column | Description |
|---|---|
| `run_id` | Run identifier |
| `original_company_name` | Input name |
| `candidate_parent_name` | Candidate from parent step |
| `candidate_uei` | Candidate UEI |
| `candidate_duns` | Candidate DUNS |
| `candidate_rank` | Candidate rank from output |
| `match_score` | Score from output |
| `match_reason` | Match reason from output |
| `review_status` | `pending`, `approved`, `rejected` |
| `reviewed_by` | Reviewer |
| `review_date` | Review date |
| `review_notes` | Decision details |

---

## 7) Recommended Configuration Baseline

Use this baseline for production stability:

```json
{
  "api": {
    "timeout_seconds": 60,
    "connect_timeout_seconds": 10,
    "read_timeout_seconds": 180,
    "max_retries": 5,
    "retry_delay_seconds": 2.0,
    "retry_backoff_multiplier": 2.0,
    "retry_max_delay_seconds": 30.0,
    "retry_jitter_seconds": 1.0,
    "page_pause_seconds": 5.0,
    "page_limit": 50
  },
  "workflow": {
    "fuzzy_mode": "strict",
    "parent_search_max_pages": 1,
    "fuzzy_threshold": 96.0,
    "fuzzy_min_gap": 12.0,
    "fuzzy_top_k": 3,
    "throttle_after_n_ueis": 3,
    "throttle_pause_seconds": 15,
    "award_date_chunk": "quarter"
  }
}
```

Reasoning for this baseline:

`strict` mode and fewer parent pages reduce ambiguous candidates. Split timeouts, retry backoff, page pacing, and quarterly award windows reduce transient read-timeout warnings while reducing total request count. Throttling lowers API pressure during longer runs.

---

## 8) Input Standards

Use specific legal company names in the Excel `Company` column. Avoid short abbreviations when possible.

Good examples:

- `3M Company`
- `The Dow Chemical Company`
- `Raytheon Technologies Corporation`

Risky examples:

- `3M`
- `DOW`
- `RTX`

Short terms can match inside unrelated identifiers and names, increasing noise.

---

## 9) Production Run Procedure

This is the default path for dashboard refresh.

### 9.1 Pre-Run Checklist

Confirm virtual environment is active. Confirm `config.json` points to production-safe values. Confirm input Excel was updated and saved. Confirm working directory is correct.

### 9.2 Run Parents

```bash
.\.venv\Scripts\python company_management/usaspending_data_pull_refined.py --step parents --input .\config\CompanyNames.xlsx --non-interactive
```

### 9.3 Validate Parent Output Quickly

Check unique original names:

```powershell
Import-Csv .\parent_companies_ueis_duns.csv | Select-Object -ExpandProperty "Original Company Name" | Sort-Object -Unique
```

Check volume:

```powershell
(Import-Csv .\parent_companies_ueis_duns.csv).Count
```

If volume is unexpectedly high for a small input, stop and send candidates to review queue.

### 9.4 Run Children, Combine, Awards, and Power BI Exports

```bash
.\.venv\Scripts\python company_management/usaspending_data_pull_refined.py --step children --non-interactive
.\.venv\Scripts\python company_management/usaspending_data_pull_refined.py --step combine --non-interactive
.\.venv\Scripts\python company_management/usaspending_data_pull_refined.py --step awards --non-interactive
.\.venv\Scripts\python company_management/usaspending_data_pull_refined.py --step powerbi-exports --non-interactive
```

### 9.5 Run Analyze (Optional)

```bash
.\.venv\Scripts\python company_management/usaspending_data_pull_refined.py --step analyze --company "3M Company" --non-interactive
```

### 9.6 Post-Run Sanity Checks

Check file existence:

- `entity_master.csv`
- `relationships.csv`
- `award_fact.csv`
- `output\powerbi_prototype\entity_master.csv`
- `output\powerbi_prototype\award_fact_readable.csv`
- `output\powerbi_prototype\relationships_readable.csv`

Check basic row counts:

```powershell
@( "entity_master.csv", "relationships.csv", "award_fact.csv",
   "output\powerbi_prototype\entity_master.csv",
   "output\powerbi_prototype\award_fact_readable.csv",
   "output\powerbi_prototype\relationships_readable.csv" ) | ForEach-Object {
  "{0} => {1}" -f $_, (Import-Csv $_).Count
}
```

Check award fact required columns:

```powershell
(Import-Csv .\award_fact.csv | Select-Object -First 1).PSObject.Properties.Name
```

---

## 10) Exception Review Procedure

Use this when new names are introduced, parent output is unexpectedly large, or business users challenge entity attribution.

### 10.1 Run Parents in Assist Mode

Temporarily set `fuzzy_mode` to `assist`, then run:

```bash
.\.venv\Scripts\python company_management/usaspending_data_pull_refined.py --step parents --input .\config\CompanyNames.xlsx --non-interactive
```

### 10.2 Build Review Queue

Extract candidate rows for ambiguous names into `parent_review_queue.csv`. Include rank, score, and reason fields for analyst review.

### 10.3 Analyst Approval

Analyst chooses authoritative parent UEI based on your policy and records decision in `approved_parent_mappings.csv`.

### 10.4 Return to Production Mode

Restore `fuzzy_mode: "strict"` and rerun production steps.

---

## 11) Resume and Recovery

The awards step supports resume by reading existing output and skipping already processed UEIs.

If a run is interrupted or `awards` ends with `status=partial_failure`:

1. Review `failed_award_requests.csv` for the failed UEI/date windows and error messages.
2. Re-run only the awards step so completed windows in `award_progress.csv` are skipped.
3. Review warnings and completion logs.
4. Verify row count increased only for newly processed windows.

```bash
.\.venv\Scripts\python company_management/usaspending_data_pull_refined.py --step awards --non-interactive
```

To force a clean awards rebuild:

```bash
del award_fact.csv
del award_progress.csv
del failed_award_requests.csv
del award_request_log.csv
.\.venv\Scripts\python company_management/usaspending_data_pull_refined.py --step awards --non-interactive
```

Do this only when intentionally rebuilding.

---

## 12) Warning Management and Escalation

Warnings such as read timeouts do not always indicate failure. They indicate retry behavior.

Treat warnings by severity:

- Low severity: intermittent retries with eventual success.
- Medium severity: repeated retries for many UEIs but continued progress.
- High severity: repeated failures with no row growth in outputs.

Escalate when:

- warnings persist for more than one hour across reruns
- row counts remain flat after retried awards runs
- API endpoint availability appears degraded

First response actions:

1. Confirm input size and parent candidate volume.
2. Confirm strict settings are active.
3. Increase delay and timeout values if needed.
4. Retry during lower-traffic periods.

---

## 13) Dashboard Handoff Contract

The dashboard team should treat normalized outputs as the governed source of truth:

`entity_master.csv` as entity dimension.

`relationships.csv` as hierarchy edges.

`award_fact.csv` as facts.

Expected join keys:

- `award_fact.recipient_uei` -> `entity_master.uei`
- `award_fact.ultimate_parent_uei` -> `entity_master.uei`
- `relationships.child_uei` and `relationships.parent_uei` -> `entity_master.uei`

For analyst-friendly visuals, use script-generated readable exports:

- `output\powerbi_prototype\entity_master.csv`
- `output\powerbi_prototype\award_fact_readable.csv`
- `output\powerbi_prototype\relationships_readable.csv`

Recommended dashboard checks before publish:

1. Verify output file timestamps match current run.
2. Verify no required columns are missing.
3. Verify row counts are within expected control ranges.
4. Verify target flagship company rollups look directionally consistent.

---

## 14) Change Control

Any changes to config thresholds, run cadence, or mapping policy should be recorded in a change log entry with:

- change date
- owner
- reason
- expected impact
- observed impact after one run cycle

Any code change should be tested in a non-production branch and documented with before/after row counts and warning levels.

---

## 15) Operational Cadence Recommendation

A practical cadence for most teams:

Daily or weekly production run:

- strict mode
- approved mappings
- publish dashboard extract

Monthly exception cycle:

- assist mode for new names only
- analyst adjudication
- mapping table update

This keeps recurring runs mostly automated while preserving data quality over time.

---

## 16) Quick Command Reference

### Full production sequence

```bash
.\.venv\Scripts\python company_management/usaspending_data_pull_refined.py --step parents --input .\config\CompanyNames.xlsx --non-interactive
.\.venv\Scripts\python company_management/usaspending_data_pull_refined.py --step children --non-interactive
.\.venv\Scripts\python company_management/usaspending_data_pull_refined.py --step combine --non-interactive
.\.venv\Scripts\python company_management/usaspending_data_pull_refined.py --step awards --non-interactive
```

### One-command main flow

```bash
.\.venv\Scripts\python company_management/usaspending_data_pull_refined.py --step all --input .\config\CompanyNames.xlsx --non-interactive
```

### Analyze example

```bash
.\.venv\Scripts\python company_management/usaspending_data_pull_refined.py --step analyze --company "3M Company" --non-interactive
```

---

## 17) Definition of Done for a Production Run

A run is considered complete when:

1. `parents`, `children`, `combine`, `awards`, and `powerbi-exports` finish without terminal failure.
2. `entity_master.csv`, `relationships.csv`, `award_fact.csv`, and readable Power BI exports are present and non-empty where expected.
3. Row counts and sample spot checks are within expected ranges.
4. Any warning spikes are documented in run notes.
5. Outputs are handed off to dashboard process with run timestamp.

---

## 18) Notes for New Operators

If you are new to Git or merge request workflow, run this SOP in a separate test clone first. Validate process and outputs there. Only promote artifacts or process changes after review.

This runbook is intentionally procedural. Follow it as written until your team formally updates the policy.

