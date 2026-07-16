# USAspending Pipeline Improvement To Do List

Use this file to track reliability, throttling, and dashboard-readiness work for `usaspending_data_pull_refined.py`.

## Phase 1: Observability And Traceability

- [x] Add detailed request logging for award pulls.
  - Track endpoint, UEI, page number, date range, attempt number, elapsed seconds, HTTP status code, and error type.
- [x] Add `failed_award_requests.csv`.
  - Include UEI, date window, page/cursor, endpoint, error message, timestamp, and retry status.
- [x] Add a run summary log.
  - Track run start time, end time, completed steps, rows written, failed requests, and output files.
- [x] Add clear console messages for resume behavior.
  - Show how many UEIs or date windows are already complete and how many remain.

## Phase 2: Stabilize Current Search-Based Award Pulls

- [x] Add exponential backoff with jitter for API retries.
  - Replace fixed retry waits with increasing waits for timeout, 429, 500, 502, 503, and 504 errors.
- [x] Split timeout settings.
  - Use separate connect and read timeouts instead of one `timeout_seconds` value.
- [x] Add page-level pacing.
  - Pause between paginated `/search/spending_by_award/` requests, not only after each UEI.
- [x] Add date-window chunking.
  - Pull awards monthly or quarterly instead of one large date range per UEI.
- [x] Save progress at the UEI/date-window level.
  - Avoid restarting successful work after a later timeout.

## Phase 3: Evaluate Download-Based Award Ingestion

- [ ] Test `/api/v2/download/awards/` with one small date window.
  - Record ZIP size, extracted size, total rows, matching UEI rows, and runtime.
- [ ] Confirm whether exact recipient UEI filtering is supported in the download request.
  - If not, plan for local filtering after download.
- [ ] Add optional award ingestion mode.
  - Support `search` mode and `download` mode without removing the existing workflow.
- [ ] Build download-mode processing.
  - Submit download job, poll status, download ZIP, extract CSVs, filter target UEIs, and normalize output.
- [ ] Compare search mode vs download mode.
  - Compare reliability, runtime, row counts, and operational complexity.

## Phase 4: Dashboard-Ready Outputs

- [ ] Standardize dashboard tables.
  - `entity_master.csv`
  - `relationships.csv`
  - `award_fact.csv`
  - `run_log.csv`
- [ ] Add lineage columns to `award_fact.csv`.
  - Include `source_run_id`, `source_file`, `source_mode`, and `loaded_at`.
- [ ] Define stable column names and data types.
  - Make Power BI refreshes predictable.
- [ ] Add duplicate prevention.
  - Use `award_id` and `recipient_uei` to avoid appending duplicate award rows.
- [ ] Consider Parquet or database storage.
  - Keep CSV for prototype use; move to Parquet, SQLite, PostgreSQL, or SQL Server if the dataset grows.

## Phase 5: Incremental Refresh And Scheduling

- [ ] Add an ingestion state file.
  - Track completed date windows and last successful run.
- [ ] Process only missing or new date windows.
  - Avoid full historical reloads unless explicitly requested.
- [ ] Add a retry-only mode.
  - Reprocess rows from `failed_award_requests.csv`.
- [ ] Add a scheduled run option.
  - Prepare for Windows Task Scheduler, cron, or another external scheduler.
- [ ] Document the dashboard refresh workflow.
  - Explain how Power BI should consume the output tables.

## Current Recommended Implementation Order

1. Add request/failure logging.
2. Add date-window chunking to the current awards step.
3. Add exponential backoff and page-level pacing.
4. Add optional download mode.
5. Compare search mode and download mode on one month of data.
6. Standardize dashboard output tables.
7. Add incremental refresh state.
8. Schedule the ingestion outside Power BI.

