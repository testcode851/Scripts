# Company Data Workflow

## Purpose

This document explains how to run and review the workflows in this repository. It covers:

1. The USAspending company hierarchy and federal-award pipeline.
2. The SEC company matching, filing, 10-K, and XBRL pipeline.
3. The consolidated company-profile export and Microsoft Access load.

These workflows are connected through normalized company identifiers and reviewable CSV outputs.

## Command-line convention

All runnable terminal examples in this document use **Git Bash** syntax and assume the current directory is the repository's `Scripts` folder. In particular, a backslash (`\`) at the end of a command line continues that command on the next line. Run the examples from the Git Bash terminal in Visual Studio Code, not PowerShell or Command Prompt.

## Workflow at a glance

The workflow starts with a list of company names and builds each later dataset from the results of the previous stage.

| Stage | What happens | Main result |
| --- | --- | --- |
| 1. Company list | The process reads company names from `config/CompanyNames.xlsx`. | The list of companies to research. |
| 2. USAspending | The pipeline identifies parent and child entities, builds the company hierarchy, and retrieves federal awards. | Normalized entities, relationships, and award records in `output/usaspending/`. |
| 3. SEC matching | USAspending ultimate parents are matched to SEC registrants. Unique exact matches are approved automatically; unmatched records remain available for review. | `output/sec/company_sec_crosswalk_candidates.csv`. |
| 4. SEC extraction | Approved matches are used to retrieve company profiles, annual XBRL financials, and selected 10-K sections. | Readable SEC datasets in `output/sec/`. |
| 5. Company profile | USAspending and SEC results are joined into one record per ultimate-parent UEI. | `output/powerbi/company_profile_readable.csv` and, when configured, the Microsoft Access table. |

In practical terms, the company list feeds the USAspending research, the USAspending results provide context for SEC matching, and both sources are combined into the final company profile.

## Repository layout

| Path | Responsibility |
| --- | --- |
| `company_management/usaspending_data_pull_refined.py` | USAspending command-line entry point and workflow implementation. |
| `company_management/sec_company_extraction.py` | SEC command-line entry point. |
| `company_management/build_and_load_company_profiles.py` | Builds the final company-profile CSV and replaces the configured Access table. |
| `src/config_loader.py` | Loads and recursively merges USAspending JSON configuration with defaults. |
| `src/sec_extraction/` | SEC client, crosswalk, XBRL transformations, 10-K extraction, schemas, and batch orchestration. |
| `src/company_profiles/` | Company-profile schema, joins, validation, CSV writer, and Access loader. |
| `config/config.json` | USAspending API, workflow, output, and analysis settings. |
| `config/config.ini` | Local Access connection configuration; required only for the Access load and not currently supplied. |
| `notebooks/` | Exploratory SEC and USAspending notebooks; not required by production commands. |
| `output/` | Generated data. The directory is created by workflows and ignored by Git. |
| `logs/` | USAspending run log output. |

## Prerequisites

### Python workflows

Use a supported Python 3 version and install these direct dependencies:

```bash
python -m pip install pandas requests openpyxl
```

`openpyxl` is needed when the company input is an Excel workbook. For the optional Microsoft Access load, also install:

```bash
python -m pip install pyodbc
```

The Access load additionally requires:

- Windows with an installed Microsoft Access ODBC driver matching the Python process architecture.
- An existing Access database.
- An existing table named `CompanyProfilePOC` with columns matching the profile schema.
- `config/config.ini` configured as described below.

This repository currently has no Python dependency lock file or automated test suite. Capture approved package versions before using the workflow as a controlled production process.

### Network access

The company pipelines require HTTPS access to:

- `https://api.usaspending.gov/api/v2`
- `https://data.sec.gov`
- `https://www.sec.gov/Archives/edgar`

SEC requests must use an identifying `User-Agent`. Set a current team-controlled value rather than relying on the source-code default:

```bash
export SEC_USER_AGENT="Organization Name contact@example.com"
```

Respect the agencies' current access policies and rate limits.

## Input and configuration

### Company name input

The default input is `config/CompanyNames.xlsx`. It must contain a column named exactly:

```text
Company
```

Each nonblank value is treated as a company to resolve. Both command-line scripts use `config/CompanyNames.xlsx` automatically, so `--input` is not needed when the workbook is stored at that default location.

Use the optional `--input` flag only to override the configured/default location. The SEC crosswalk reader also accepts CSV input through this override. For example:

```bash
python company_management/sec_company_extraction.py \
  --step all \
  --input path/to/AlternateCompanyNames.csv
```

The input workbook is not present in the reviewed repository and must be supplied by the operator.

### USAspending configuration

The default file is `config/config.json`. The most operationally important settings are:

| Setting | Current default | Meaning |
| --- | --- | --- |
| `workflow.start_date` | `2025-01-01` | Earliest award date. |
| `workflow.end_date` | `now` | Latest award date; resolved to the run date. |
| `workflow.award_date_chunk` | `quarter` | Award requests are split into quarterly windows; `month` and `all` are also valid. |
| `workflow.fuzzy_mode` | `strict` | Parent-name matching behavior: `strict`, `assist`, or `off`. |
| `workflow.fuzzy_threshold` | `96.0` | Minimum strict fuzzy-match score. |
| `workflow.fuzzy_min_gap` | `12.0` | Required gap between the best and second-best match. |
| `workflow.parent_search_max_pages` | `1` | USAspending parent-search pages examined. |
| `workflow.throttle_after_n_ueis` | `3` | Pause after this many UEIs. Zero disables this count-based pause. |
| `workflow.throttle_pause_seconds` | `15` | Length of the count-based pause. |

Configuration precedence is built-in defaults, then the JSON file, then supported `USASPENDING_*` environment variables, and finally command-line date/input arguments. The lightweight `.usaspending_state.json` file remembers the last input and run; it is runtime state, not authoritative configuration.

Use `--non-interactive` for scheduled runs so a missing input fails immediately instead of prompting.

### Access configuration

Create `config/config.ini` locally:

```ini
[Database]
path=C:\path\to\company_profiles.accdb
driver=Microsoft Access Driver (*.mdb, *.accdb)
```

Do not commit local database paths or credentials. Confirm the destination database and take any required backup before running the loader.

## Recommended production run

### 1. Run the USAspending pipeline

Review the date range and matching settings in `config/config.json`, then run:

```bash
python company_management/usaspending_data_pull_refined.py \
  --step all \
  --non-interactive
```

The `all` step runs, in order:

1. `parents` — searches USAspending recipient data and selects or presents parent candidates.
2. `children` — discovers recipient children for the selected parents.
3. `combine` — creates a combined hierarchy and normalized entity/relationship tables.
4. `awards` — retrieves awards for hierarchy UEIs over the configured date range.
5. `powerbi-exports` — creates reporting-friendly copies of normalized outputs.

For greater control, run one stage at a time:

```bash
python company_management/usaspending_data_pull_refined.py --step parents --non-interactive
python company_management/usaspending_data_pull_refined.py --step children --non-interactive
python company_management/usaspending_data_pull_refined.py --step combine --non-interactive
python company_management/usaspending_data_pull_refined.py --step awards --non-interactive
python company_management/usaspending_data_pull_refined.py --step powerbi-exports --non-interactive
```

Optional command-line date overrides:

```bash
python company_management/usaspending_data_pull_refined.py \
  --step awards \
  --start-date 2024-01-01 \
  --end-date now \
  --non-interactive
```

To print monthly active-award counts for one company:

```bash
python company_management/usaspending_data_pull_refined.py \
  --step analyze \
  --company "Example Company" \
  --non-interactive
```

### 2. Review USAspending results

Before moving to SEC matching, review at least:

- Parent candidates and their match method, score, score gap, and review note.
- Child-to-parent relationships and any fallback relationship with confidence `0.7` rather than the direct API confidence `1.0`.
- Blank or duplicate UEIs.
- Failed award requests and incomplete date windows.
- Whether the configured award period is appropriate for the analysis.

The parent matching modes behave as follows:

- `strict` selects exact matches or only sufficiently strong, clearly separated fuzzy matches.
- `assist` emits candidates for human comparison.
- `off` emits parent-level results without fuzzy selection.

### 3. Run the complete SEC pipeline

The easiest method is to run the SEC workflow with `--step all`:

```bash
python company_management/sec_company_extraction.py --step all
```

This one command:

1. Builds `output/sec/company_sec_crosswalk_candidates.csv`.
2. Automatically approves unique normalized exact SEC-name matches.
3. Extracts SEC profiles, annual financials, and 10-K sections for the automatically approved rows.
4. Writes the combined SEC and USAspending reporting outputs.

The `all` command does not pause between crosswalk creation and extraction. It is convenient because the matching rules are conservative:

- A unique normalized exact SEC-name match is populated and marked `review_status=approved` with confidence `100`.
- Missing, non-unique, or unmatched records are marked `review_status=no_match` and are not extracted.
- The match is scoped to the USAspending ultimate parent, not every subsidiary.

After the command finishes, review the crosswalk and batch summary. If an authorized reviewer corrects or approves additional crosswalk rows, rerun only the extraction stage against the edited file:

```bash
python company_management/sec_company_extraction.py --step extract
```

Only rows whose `review_status` equals `approved` (case-insensitive) are processed by default. Use `--review-status` only when an alternate reviewed status is intentional.

#### Optional individual SEC steps

Use these flags when troubleshooting or when project governance requires a manual checkpoint before any extraction:

- `--step crosswalk` builds the candidate file without extracting SEC data.
- `--step extract` extracts rows already carrying the requested review status.
- `--step single --ticker TICKER` or `--step single --cik CIK` tests one SEC registrant without using the crosswalk.
- `--entity-master PATH` overrides the default `output/usaspending/entity_master.csv` only when the entity master is stored elsewhere.
- `--crosswalk PATH` overrides the default `output/sec/company_sec_crosswalk_candidates.csv` only when extracting from a different reviewed crosswalk.

Running the SEC script without `--step` also defaults to the complete `all` workflow when no ticker or CIK is supplied. The documentation uses `--step all` explicitly so the operator's intent is clear.

Useful extraction options:

| Option | Effect |
| --- | --- |
| `--financial-years N` | Keeps up to `N` recent fiscal years in readable financial output; default is 10. |
| `--include-all-10k` | Downloads section data for all recent 10-K filings instead of only the latest. |
| `--save-raw-json` | Saves SEC submissions and company-facts JSON per company. |
| `--save-full-sec-extract` | Writes the broad audit-style `sec_company_extract.csv`. |
| `--output-dir PATH` | Changes the default `output/sec` destination. |
| `--award-fact-readable PATH` | Changes the USAspending readable award source used for the combined summary. |
| `--powerbi-output-dir PATH` | Changes the combined reporting output destination. |

To test a single SEC registrant independently of the crosswalk:

```bash
python company_management/sec_company_extraction.py --step single --ticker MMM
```

or:

```bash
python company_management/sec_company_extraction.py --step single --cik 0000066740
```

Single-company output is stored under `output/sec/<ticker-or-CIK>/`. Because this path bypasses the USAspending crosswalk, its readable rows do not provide the reviewed parent context used by the consolidated pipeline.

### 4. Review SEC results

Check `output/sec/sec_extraction_batch_summary.csv` first. For every approved row, confirm:

- `status` is successful or that warnings are understood.
- Filing, 10-K, XBRL fact, and section counts are plausible.
- `source_warnings` and `error` are blank or resolved.
- The SEC registrant and CIK still correspond to the intended USAspending parent.
- Financial units, periods, and source tags are appropriate before comparing values.

The annual financial transformer selects recent annual SEC facts and records selection details in `reported_source_tags` and `data_quality_notes`. `reported_revenue` is a curated revenue value assembled from supported XBRL tags; it should not be treated as a restatement of every possible issuer-specific revenue concept.

The 10-K output contains section previews, not a complete legal or financial interpretation of the filing.

### 5. Build and load consolidated profiles

Required inputs are fixed in `src/company_profiles/schema.py`:

- `output/usaspending/entity_master.csv`
- `output/usaspending/award_fact.csv`
- `output/sec/sec_company_profile_readable.csv`
- `output/sec/sec_company_financials_annual_readable.csv`

The builder produces one row per ultimate-parent UEI. It aggregates awards, selects the highest-confidence approved SEC profile, and selects the latest available SEC fiscal year.

Run:

```bash
python company_management/build_and_load_company_profiles.py
```

The command first writes `output/powerbi/company_profile_readable.csv`, then connects to Access. The loader executes `DELETE FROM [CompanyProfilePOC]`, inserts all newly built rows, and commits both operations as one transaction. On an insertion error it rolls back. This is a full table replacement, so review the CSV and database target before running the command.

The final `DataCoverageFlag` is:

- `complete` when award, SEC profile, and SEC financial coverage are present.
- `no_usaspending_awards` when no awards were aggregated.
- `missing_sec_profile` when no approved SEC profile is available.
- `missing_sec_financials` when a profile exists but financial data is absent.

Multiple missing conditions are separated by semicolons.

## Adding New Company Names

Use this procedure when adding companies while keeping all existing companies in the workflow.

### 1. Update the input workbook

Open `config/CompanyNames.xlsx` and append each new company as a separate row under the existing `Company` column. Do not rename or remove the `Company` header. Keep the existing company rows, save the workbook, and close it before running the pipeline so Excel does not leave the file locked.

Example:

| Company |
| --- |
| Existing Company A |
| Existing Company B |
| New Company C |
| New Company D |

### 2. Preserve reviewed SEC decisions

Generating a new SEC crosswalk overwrites `output/sec/company_sec_crosswalk_candidates.csv`. If the current file contains manual approvals, corrected identifiers, or review notes, copy it before continuing:

```bash
cp output/sec/company_sec_crosswalk_candidates.csv \
  output/sec/company_sec_crosswalk_candidates_backup.csv
```

Skip this command if the crosswalk does not exist yet. Keep the backup until the updated crosswalk has been reviewed and all required decisions have been transferred.

### 3. Rerun USAspending

From the repository's `Scripts` folder, run:

```bash
python company_management/usaspending_data_pull_refined.py \
  --step all \
  --non-interactive
```

This rebuilds the parent, child, hierarchy, entity, and relationship outputs using the complete workbook. The awards stage uses `output/usaspending/award_progress.csv` to skip previously completed UEI/date windows and retrieve applicable windows for newly discovered UEIs. Review the updated parent matches, relationships, failed requests, and Power BI-readable outputs before continuing.

This incremental behavior is intended for additions. If companies were removed or renamed, older rows can remain in `award_fact.csv`; follow the clean-rebuild guidance in [Restart and failure behavior](#restart-and-failure-behavior) instead of assuming the outputs removed them.

### 4. Run the complete SEC pipeline

```bash
python company_management/sec_company_extraction.py --step all
```

This rebuilds the crosswalk and immediately extracts every automatically approved unique exact match. Compare the new `output/sec/company_sec_crosswalk_candidates.csv` with the backup. Revalidate existing mappings, transfer any still-valid manual decisions according to project governance, and review every new company. Unmatched or ambiguous rows are skipped.

If an authorized reviewer adds or corrects approved mappings after the `all` command finishes, rerun only the extraction stage so those changes are included:

```bash
python company_management/sec_company_extraction.py --step extract
```

### 5. Review the updated SEC outputs

Review `output/sec/sec_extraction_batch_summary.csv` for failures and warnings. The batch-readable SEC outputs are regenerated from all currently approved crosswalk rows, not only the newly added companies.

### 6. Refresh the consolidated profile when required

If the final CSV and Access table need the new companies, first review the upstream results and confirm `config/config.ini` points to the intended database. Then run:

```bash
python company_management/build_and_load_company_profiles.py
```

Review `output/powerbi/company_profile_readable.csv`. Remember that this command also deletes and replaces all rows in the configured Access table `CompanyProfilePOC` within one transaction.

## Output reference

### USAspending working and normalized outputs

| Default output | Purpose |
| --- | --- |
| `output/usaspending/parent_companies_ueis_duns.csv` | Parent search results and matching/review information. |
| `output/usaspending/child_companies_duns_ueis.csv` | Child recipients discovered for selected parents. |
| `output/usaspending/company_hierarchy.csv` | Combined parent and child rows used by award retrieval. |
| `output/usaspending/entity_master.csv` | One normalized row per UEI, including ultimate-parent context. |
| `output/usaspending/relationships.csv` | Child-to-parent edges with source, confidence, and observed dates. |
| `output/usaspending/award_fact.csv` | Normalized award facts linked to recipient and ultimate-parent UEIs. |
| `output/usaspending/failed_award_requests.csv` | Award requests that exhausted retries or otherwise failed. |
| `output/usaspending/award_request_log.csv` | Request-level URL, status, timing, retry, page, and date-window diagnostics. |
| `output/usaspending/award_progress.csv` | Successfully completed UEI/date windows used for restart behavior. |
| `logs/run_log.csv` | Run and per-UEI progress/status records. |

`usaspending_awards_by_uei.csv` remains configurable in the code as a legacy path, but the current production awards stage writes normalized rows to `award_fact.csv`.

### Reporting-friendly outputs

| Default output | Purpose |
| --- | --- |
| `output/powerbi/entity_master.csv` | Readable copy of the normalized entity master. |
| `output/powerbi/award_fact_readable.csv` | Award facts with readable entity context. |
| `output/powerbi/relationships_readable.csv` | Relationships enriched with child and parent names. |
| `output/powerbi/company_award_sec_summary_readable.csv` | Fiscal-year USAspending award aggregates alongside selected SEC financial measures. |
| `output/powerbi/company_profile_readable.csv` | One consolidated company profile per ultimate-parent UEI. |

### SEC outputs

| Default output | Purpose |
| --- | --- |
| `output/sec/company_sec_crosswalk_candidates.csv` | Reviewable USAspending-parent-to-SEC mapping. |
| `output/sec/sec_company_profile_readable.csv` | Curated SEC identity, location, web, and match-review fields. |
| `output/sec/sec_company_financials_annual_readable.csv` | Annual XBRL-derived financial measures and quality notes. |
| `output/sec/sec_10k_sections_readable.csv` | High-value 10-K item headings, previews, and source URLs. |
| `output/sec/sec_extraction_batch_summary.csv` | Per-company extraction counts, warnings, status, and errors. |
| `output/sec/sec_company_extract.csv` | Optional broad audit extract enabled by `--save-full-sec-extract`. |
| `output/sec/<ticker-or-CIK>/ten_k_documents/` | Per-filing downloaded document indexes and filing text artifacts. |
| `output/sec/<ticker-or-CIK>/raw_submissions.json` | Optional raw SEC submissions response. |
| `output/sec/<ticker-or-CIK>/raw_companyfacts.json` | Optional raw SEC company-facts response. |

The `output/`, CSV, Excel, runtime state, and Markdown documentation patterns are ignored by the current `.gitignore`; account for that when packaging, reviewing, or committing generated documentation and data.

## Restart and failure behavior

The USAspending awards stage is designed for resumability:

- Award queries are divided into configured date windows.
- Successful UEI/window combinations are appended to `award_progress.csv`.
- Successful award rows are appended to `award_fact.csv`.
- Existing progress is reused on rerun.
- If progress metadata exists but the award output is missing or empty, progress is ignored so the output can be rebuilt.
- Older award output without progress metadata is treated as complete at the UEI level to preserve backward compatibility.

Do not casually delete only one file from the award/progress pair. If a clean rebuild is required, archive the existing `award_fact.csv`, `award_progress.csv`, request logs, and failure logs together, then rerun the awards stage.

The `all` USAspending workflow stops at the first stage returning failure. SEC batch extraction records supported per-company failures in the batch summary and continues with later approved rows.

## Validation checklist

Use this checklist before publishing or loading results:

- Confirm the intended company input file and row count.
- Record the USAspending configuration and date range used for the run.
- Review parent fuzzy matches and relationship fallback confidence.
- Resolve or document all failed award requests and incomplete windows.
- Check normalized UEIs and ultimate-parent assignments for duplicates or blanks.
- Review the SEC crosswalk and retain only authorized `approved` mappings.
- Inspect SEC batch errors, warnings, and data-quality notes.
- Confirm monetary units and fiscal periods before comparing awards with SEC values.
- Review `DataCoverageFlag` values in the final profile output.
- Confirm the Access database path, table schema, and backup before full-table replacement.
- Preserve input, configuration, review decisions, logs, and output files together for reproducibility.

## Troubleshooting

### Missing `CompanyNames.xlsx`

Supply `--input` with a valid path or update `workflow.company_names_excel`. With `--non-interactive`, the command fails immediately; without it, the USAspending workflow may prompt for a path.

### No SEC companies are extracted

Open `company_sec_crosswalk_candidates.csv` and inspect `review_status`, ticker, and CIK. Batch extraction processes only the requested review status, which defaults to `approved`.

### SEC returns request errors

Confirm internet/proxy access and provide a valid identifying `SEC_USER_AGENT`. Review the batch summary and rerun after transient failures. Avoid reducing request delays without confirming current SEC policy.

### USAspending award runs are slow

Award requests are paginated, retried with backoff, date-chunked, and deliberately throttled. Review `award_request_log.csv` for timing and retry details before changing page pauses, chunking, or throttle settings.

### Company-profile build reports a missing input or column

Run the USAspending and approved SEC extraction stages first. The profile builder validates fixed input paths and required columns; custom output paths used in earlier commands are not automatically discovered.

### Access load fails

Confirm `config/config.ini`, database existence, installed driver name, Python/driver architecture compatibility, table existence, and column types. The transaction rolls back if deletion or insertion fails.

## Implementation notes and limitations

- External agency data can change between runs; output should include a recorded run date and configuration snapshot.
- Company-name matching is conservative but still requires business review, especially for similarly named entities and parent/subsidiary changes.
- USAspending hierarchy results depend on available recipient data and may not represent a complete legal corporate hierarchy.
- SEC extraction is limited to SEC registrants and supported filing/XBRL concepts. Private companies may have no SEC record.
- The final company profile is keyed by ultimate-parent UEI and keeps one approved SEC profile and the latest fiscal-year financial row per parent.
- Power BI outputs are CSVs; no Power BI model or refresh automation is included in the reviewed repository.
- The Access destination table must already exist; the loader does not create or migrate its schema.
