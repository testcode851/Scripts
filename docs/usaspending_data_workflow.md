# USAspending Data Workflow

This tool pulls federal contract and award data from [USAspending.gov](https://www.usaspending.gov/) for a list of companies you provide. It finds parent companies, their subsidiaries, and all the federal awards/contracts associated with them, then writes normalized CSV outputs for hierarchy and award analysis.

---

## Table of Contents

- [What Does This Script Actually Do?](#what-does-this-script-actually-do)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [File Overview](#file-overview)
- [How Configuration Works](#how-configuration-works)
  - [config.json Breakdown](#configjson-breakdown)
  - [config_loader.py Breakdown](#config_loaderpy-breakdown)
  - [Priority Order](#priority-order)
  - [Environment Variables](#environment-variables)
- [The Main Script: Step by Step](#the-main-script-step-by-step)
  - [Step 1: Parents (Finding Parent Companies)](#step-1-parents-finding-parent-companies)
  - [Step 2: Children (Finding Subsidiaries)](#step-2-children-finding-subsidiaries)
  - [Step 3: Combine (Merging the Hierarchy)](#step-3-combine-merging-the-hierarchy)
  - [Step 4: Awards (Pulling Federal Awards)](#step-4-awards-pulling-federal-awards)
  - [Step 5: Power BI Exports (Readable Dashboard Files)](#step-5-power-bi-exports-readable-dashboard-files)
  - [Step 6: Analyze (Counting Active Awards)](#step-6-analyze-counting-active-awards)
  - [Running Everything at Once](#running-everything-at-once)
- [How the Code Works (Detailed Breakdown)](#how-the-code-works-detailed-breakdown)
  - [Configuration Classes (ApiConfig and WorkflowConfig)](#configuration-classes-apiconfig-and-workflowconfig)
  - [Helper Functions](#helper-functions)
  - [State File Management](#state-file-management)
  - [Input File Resolution](#input-file-resolution)
  - [The API Client](#the-api-client)
  - [Fuzzy Matching Engine](#fuzzy-matching-engine)
  - [Parent Candidate Scoring](#parent-candidate-scoring)
  - [Data Fetching Functions](#data-fetching-functions)
  - [The Awards Pipeline (Concurrency and Resume)](#the-awards-pipeline-concurrency-and-resume)
  - [The Analysis Function](#the-analysis-function)
  - [The CLI and main() Function](#the-cli-and-main-function)
- [Generated Output Files](#generated-output-files)
- [Checkpointing and Resume](#checkpointing-and-resume)
- [Throttling and Rate Limits](#throttling-and-rate-limits)
- [Troubleshooting](#troubleshooting)
- [Legacy Script](#legacy-script)

---

## What Does This Script Actually Do?

Imagine you have a list of company names (like "Raytheon", "Lockheed Martin", "Boeing") and you want to know: **what federal contracts do these companies and their subsidiaries have?**

This script automates that entire process:

1. **Searches** USAspending.gov for each company name you provide
2. **Identifies** the correct parent company using fuzzy name matching (because "Raytheon" might show up as "RAYTHEON TECHNOLOGIES CORPORATION" in the database)
3. **Finds subsidiaries** under each parent company
4. **Pulls all federal awards/contracts** for every company in that family tree
5. **Saves everything** to CSV files you can open in Excel (`entity_master.csv`, `relationships.csv`, `award_fact.csv`)

---

## Prerequisites

1. **Python 3.9 or newer** installed on your machine.

2. **Install the required Python packages:**

   ```bash
   pip install pandas requests openpyxl
   ```

   What each package does:
   - `pandas` -- handles all the data tables (reading Excel, writing CSV, filtering rows)
   - `requests` -- makes HTTP calls to the USAspending API
   - `openpyxl` -- lets pandas read `.xlsx` Excel files

3. **An Excel file** with a column named `Company` containing the company names you want to search for. Example:

   | Company |
   |---------|
   | Raytheon |
   | Boeing |
   | Lockheed Martin |

---

## Quick Start

**Run all steps at once:**
```bash
python company_management/usaspending_data_pull_refined.py --step all --input MyCompanies.xlsx
```

**Or run steps individually:**
```bash
python company_management/usaspending_data_pull_refined.py --step parents --input MyCompanies.xlsx
python company_management/usaspending_data_pull_refined.py --step children
python company_management/usaspending_data_pull_refined.py --step combine
python company_management/usaspending_data_pull_refined.py --step awards
python company_management/usaspending_data_pull_refined.py --step analyze --company "Raytheon"
```

---

## File Overview

| File | What It Does |
|------|-------------|
| `usaspending_data_pull_refined.py` | The main script. Has all the logic for searching companies, fuzzy matching, pulling awards, etc. |
| `config.json` | Settings file where you can customize API behavior, file paths, fuzzy matching thresholds, and more. |
| `config_loader.py` | A small helper that reads `config.json` and merges it with built-in default values. |
| `usaspending_data_pull.py` | The original/legacy version of the script. Kept for reference but not recommended for use. |

---

## How Configuration Works

The script uses a layered configuration system. You can set options in multiple places, and they get merged together with a clear priority order.

### config.json Breakdown

This is the main settings file. Here's what every section does:

```json
{
  "api": {
    "base_url": "https://api.usaspending.gov/api/v2",  // The USAspending API address
    "timeout_seconds": 30,             // Backward-compatible timeout default
    "connect_timeout_seconds": 10,     // How long to wait while opening the connection
    "read_timeout_seconds": 180,       // How long to wait for the response body
    "max_retries": 5,                  // How many times to retry a transient API failure
    "retry_delay_seconds": 2.0,        // Base retry delay before backoff/jitter
    "retry_backoff_multiplier": 2.0,   // Multiplies retry delay after each failed attempt
    "retry_max_delay_seconds": 30.0,   // Caps retry delay
    "retry_jitter_seconds": 1.0,       // Adds random delay so retries do not line up
    "page_pause_seconds": 5.0,         // Pause between paginated award-search requests
    "page_limit": 50                   // How many results per page
  },
  "workflow": {
    "company_names_excel": "",                           // Path to your Excel input file (usually set via --input instead)
    "parent_companies_csv": "parent_companies_ueis_duns.csv",  // Output file for Step 1
    "child_companies_csv": "child_companies_duns_ueis.csv",    // Output file for Step 2
    "hierarchy_csv": "company_hierarchy.csv",                   // Output file for Step 3
    "awards_csv": "usaspending_awards_by_uei.csv",             // Legacy awards output setting (kept for compatibility)
    "entity_master_csv": "entity_master.csv",                  // Normalized entity dimension output
    "relationships_csv": "relationships.csv",                  // Normalized child->parent relationship output
    "award_fact_csv": "award_fact.csv",                        // Normalized awards fact output (Step 4)
    "failed_award_requests_csv": "failed_award_requests.csv",  // Failed award request audit log
    "award_request_log_csv": "award_request_log.csv",          // Request-attempt audit log
    "award_progress_csv": "award_progress.csv",                // Completed UEI/date-window progress log
    "run_log_csv": "run_log.csv",                              // Award run summary log
    "powerbi_output_dir": "output/powerbi_prototype",          // Readable Power BI export folder
    "powerbi_entity_master_csv": "entity_master.csv",          // Entity export copy for Power BI
    "award_fact_readable_csv": "award_fact_readable.csv",      // Award fact export with names
    "relationships_readable_csv": "relationships_readable.csv",// Relationship export with names
    "parent_search_max_pages": 1,   // How many pages of search results to look through
    "fuzzy_mode": "strict",         // How to handle name matching: "strict", "assist", or "off"
    "fuzzy_threshold": 96.0,        // Minimum similarity score (0-100) to consider a match "confident"
    "fuzzy_min_gap": 12.0,          // Minimum score gap between #1 and #2 candidate
    "fuzzy_top_k": 3,               // How many top candidates to show in summary
    "throttle_after_n_ueis": 3,     // Pause after processing this many award windows
    "throttle_pause_seconds": 15,   // How long to pause (seconds)
    "start_date": "2025-01-01",     // Only pull awards starting from this date
    "end_date": "now",              // Pull awards up to this date ("now" = today)
    "award_date_chunk": "quarter"   // Pull awards by "month", "quarter", or "all"
  },
  "fields": {
    "awards": [                     // Which data fields to request from the awards API
      "Award ID",
      "Recipient Name",
      "recipient_id",
      "Recipient UEI",
      "Start Date",
      "End Date",
      "Award Amount",
      "Awarding Agency",
      "Awarding Sub Agency"
    ]
  },
  "analysis": {
    "default_company_name": ""      // Default company for the analyze step (set via --company instead)
  }
}
```

### config_loader.py Breakdown

This small file handles loading your config:

1. **Has its own copy of all defaults** -- so even if `config.json` is missing, the script still works
2. **Deep-merges your config with defaults** -- if you only set `api.timeout_seconds` in `config.json`, everything else still gets its default value. You don't need to include every setting.
3. **Validates the structure** -- makes sure the config file is a valid JSON object

The key function is `load_config(path)`:
- If the file doesn't exist or path is empty, it returns just the defaults
- If the file exists, it reads it and merges it on top of the defaults
- Nested sections (like `api`, `workflow`) are merged recursively, so you can override just one setting without losing the others

### Priority Order

When the same setting is defined in multiple places, here's what wins (highest priority first):

1. **CLI flags** (`--start-date`, `--end-date`, `--input`)
2. **Environment variables** (`USASPENDING_START_DATE`, etc.)
3. **config.json** values
4. **Built-in defaults** in the code

For the Excel input file specifically, there are two additional fallbacks:
5. **State file** (`.usaspending_state.json`) remembers the last file you used
6. **Interactive prompt** (asks you to type a path, unless `--non-interactive` is set)

### Environment Variables

You can override any workflow setting via environment variables. This is useful for automated/scheduled runs:

| Variable | Overrides |
|----------|-----------|
| `USASPENDING_COMPANY_NAMES_EXCEL` | `workflow.company_names_excel` |
| `USASPENDING_START_DATE` | `workflow.start_date` |
| `USASPENDING_END_DATE` | `workflow.end_date` |
| `USASPENDING_PARENT_CSV` | `workflow.parent_companies_csv` |
| `USASPENDING_CHILD_CSV` | `workflow.child_companies_csv` |
| `USASPENDING_HIERARCHY_CSV` | `workflow.hierarchy_csv` |
| `USASPENDING_AWARDS_CSV` | `workflow.awards_csv` |
| `USASPENDING_ENTITY_MASTER_CSV` | `workflow.entity_master_csv` |
| `USASPENDING_RELATIONSHIPS_CSV` | `workflow.relationships_csv` |
| `USASPENDING_AWARD_FACT_CSV` | `workflow.award_fact_csv` |
| `USASPENDING_POWERBI_OUTPUT_DIR` | `workflow.powerbi_output_dir` |
| `USASPENDING_POWERBI_ENTITY_MASTER_CSV` | `workflow.powerbi_entity_master_csv` |
| `USASPENDING_AWARD_FACT_READABLE_CSV` | `workflow.award_fact_readable_csv` |
| `USASPENDING_RELATIONSHIPS_READABLE_CSV` | `workflow.relationships_readable_csv` |
| `USASPENDING_FUZZY_MODE` | `workflow.fuzzy_mode` |
| `USASPENDING_FUZZY_THRESHOLD` | `workflow.fuzzy_threshold` |
| `USASPENDING_FUZZY_MIN_GAP` | `workflow.fuzzy_min_gap` |
| `USASPENDING_FUZZY_TOP_K` | `workflow.fuzzy_top_k` |
| `USASPENDING_PARENT_SEARCH_MAX_PAGES` | `workflow.parent_search_max_pages` |

---

## The Main Script: Step by Step

### Step 1: Parents (Finding Parent Companies)

**What it does:** Takes each company name from your Excel file and searches USAspending's recipient directory. It finds the "parent-level" entry for each company (the top-level corporate entity that has a UEI and DUNS number).

**Why this matters:** USAspending organizes companies in a hierarchy. "Raytheon Missile Systems" is a child of "RAYTHEON TECHNOLOGIES CORPORATION". To find ALL of Raytheon's awards, you need to start at the parent level.

**The fuzzy matching problem:** When you search for "Raytheon", the API might return 50 different entries. The script uses a custom fuzzy matching engine to figure out which one is the "real" match. It scores candidates based on:
- How similar the names are overall
- Whether they share the same words
- Whether one name starts with the other
- Whether they have the same acronym

**Command:**
```bash
python company_management/usaspending_data_pull_refined.py --step parents --input MyCompanies.xlsx
```

**Output:** `parent_companies_ueis_duns.csv` with columns:
- `Original Company Name` -- what you searched for
- `Recipient Name` -- what USAspending calls them
- `DUNS`, `UEI` -- unique identifiers
- `Match Score`, `Match Reason`, `Top Candidates`, `Potential Typo`, `Review Note` -- fuzzy match info (when fuzzy mode is on)

---

### Step 2: Children (Finding Subsidiaries)

**What it does:** For each parent company found in Step 1, asks the API: "What subsidiaries does this parent have?" Uses the UEI (preferred) or DUNS number as the identifier.

**Command:**
```bash
python company_management/usaspending_data_pull_refined.py --step children
```

**Output:** `child_companies_duns_ueis.csv` with the same column structure as the parent file, but with `Recipient Level` set to `"C"` (for child), plus parent linkage columns (`Parent Recipient Name`, `Parent UEI`, `Parent DUNS`) used for normalized schema creation.

---

### Step 3: Combine (Merging the Hierarchy)

**What it does:** Stacks the parent CSV and child CSV into one hierarchy file, then builds normalized hierarchy tables from those same inputs.

**Command:**
```bash
python company_management/usaspending_data_pull_refined.py --step combine
```

**Output:**
- `company_hierarchy.csv` (legacy combined hierarchy list)
- `entity_master.csv` (normalized entity table)
- `relationships.csv` (normalized child->parent relationship table)

---

### Step 4: Awards (Pulling Federal Awards)

**What it does:** This is the big one. For every unique UEI in the hierarchy file, it searches USAspending for all federal awards/contracts within the configured date range and writes normalized award facts.

**Key features:**
- **Deduplication:** If the same UEI appears multiple times in the hierarchy (e.g., a company that's both a parent for one search and a child for another), it only queries that UEI once
- **Resume support:** If the script stops halfway (crash, Ctrl+C, etc.), just run it again. It checks which UEIs are already in `award_fact.csv` and skips them
- **Parallel-safe appends:** Uses a thread-safe append flow so retries/resume and file writes stay safe under long runs
- **Throttling:** Automatically pauses after every N UEIs to avoid overwhelming the API
- **Exact matching:** After getting results from the API (which does fuzzy text matching), it filters to only keep rows where the UEI matches exactly
- **Award type codes:** The script filters to codes `A`, `B`, `C`, `D` which cover contracts (A = BPA Call, B = Purchase Order, C = Delivery Order, D = Definitive Contract). Grants, loans, and other award types are not included.

**Command:**
```bash
python company_management/usaspending_data_pull_refined.py --step awards
```

**Output:** `award_fact.csv` with normalized columns:
- `award_id`
- `recipient_uei`
- `ultimate_parent_uei`
- `award_amount`
- `awarding_agency`
- `awarding_sub_agency`
- `start_date`
- `end_date`

---

### Step 5: Power BI Exports (Readable Dashboard Files)

**What it does:** Creates readable dashboard/export files from the normalized source-of-truth tables. The normalized files remain canonical; these exports add company names so analysts do not have to repeat joins in notebooks or Power Query.

**Command:**
```bash
python company_management/usaspending_data_pull_refined.py --step powerbi-exports
```

**Output folder:** `output/powerbi_prototype`
- `entity_master.csv`
- `award_fact_readable.csv`
- `relationships_readable.csv`

---

### Step 6: Analyze (Counting Active Awards)

**What it does:** A bonus analysis step. It reads `award_fact.csv` + `entity_master.csv`, filters to a specific company, and counts how many awards are "active" (between their start and end dates) for each month. Useful for spotting trends.

**How it works:**
1. Resolves your company name to one or more normalized ultimate-parent UEIs from `entity_master.csv`
2. Filters `award_fact.csv` to those `ultimate_parent_uei` values
3. Deduplicates by `award_id`
4. Converts `start_date`/`end_date` to month periods
5. For each month in the range, counts how many awards span that month
6. Awards with no end date are assumed active for 1 year

**Command:**
```bash
python company_management/usaspending_data_pull_refined.py --step analyze --company "Raytheon"
```

**Output:** Printed to the console as a table of Month and Active Awards Count.

---

### Running Everything at Once

Instead of running the main production steps individually, you can run them all in one command:

```bash
python company_management/usaspending_data_pull_refined.py --step all --input MyCompanies.xlsx
```

This runs `parents -> children -> combine -> awards -> powerbi-exports` in order. If any step fails, it stops immediately and reports which step failed. The `analyze` step is NOT included in `--step all` since it requires a `--company` argument.

If `awards` ends with `status=partial_failure`, some award API windows failed after retries, but successful windows were already saved in `award_progress.csv` and any returned rows were appended to `award_fact.csv`. Review `failed_award_requests.csv`, then rerun only the awards step:

```bash
python company_management/usaspending_data_pull_refined.py --step awards
```

---

## How the Code Works (Detailed Breakdown)

This section walks through every major section of the code and explains what it does.

### Configuration Classes (ApiConfig and WorkflowConfig)

These are Python `dataclass` objects (think of them as structured containers for settings). Each one has fields with default values.

**ApiConfig** holds settings for talking to the API:
- `base_url` -- the API address (you'll never change this)
- `timeout_seconds` -- backward-compatible timeout default
- `connect_timeout_seconds` and `read_timeout_seconds` -- separate connect/read timeouts
- `max_retries` -- try 5 times before giving up on retryable failures
- `retry_delay_seconds`, `retry_backoff_multiplier`, `retry_max_delay_seconds`, `retry_jitter_seconds` -- exponential retry backoff with jitter
- `page_pause_seconds` -- pause between paginated award requests
- `page_limit` -- ask for 50 results per page

**WorkflowConfig** holds everything else:
- File paths for input/output CSVs
- Award request, failure, progress, and run log CSV paths
- Fuzzy matching settings (mode, threshold, gap, top_k)
- Throttling settings (how often to pause, how long)
- Date range and chunking mode for award queries

The `frozen=True` flag means once these objects are created, you can't accidentally change them.

### Helper Functions

**`dataclass_from_mapping()`** -- Converts a dictionary (like what comes from JSON) into a dataclass. If the dictionary has extra keys that the dataclass doesn't know about, they're quietly ignored.

**`normalize_date_value()`** -- Cleans up date strings. Turns `"now"` into today's date (e.g., `"2026-03-23"`), validates that the format is `YYYY-MM-DD`, and falls back to a default if the value is empty.

**`coerce_int()` / `coerce_float()`** -- Config values from JSON and environment variables come in as strings. These functions safely convert them to integers or floats, with clear error messages if the conversion fails.

### State File Management

The state file (`.usaspending_state.json`) is a small JSON file that remembers things between runs:
- Which Excel file you used last time
- Which step you ran last
- When you last ran the script

**`load_state_file()`** reads it (returns empty dict if it doesn't exist or is corrupted). **`save_state_file()`** writes it after each run. If saving fails (permissions, etc.), it logs the error but doesn't crash.

### Input File Resolution

**`resolve_company_names_excel()`** figures out where your company names Excel file is. It checks these sources in order:

1. `--input` CLI flag
2. `USASPENDING_COMPANY_NAMES_EXCEL` environment variable
3. `company_names_excel` from config.json
4. `last_company_names_excel` from the state file
5. Interactive prompt (unless `--non-interactive`)

First one that points to a file that actually exists wins. The helper function `_existing_path()` expands environment variables and `~` in paths, then checks if the file exists.

### The API Client

The `ApiClient` class wraps Python's `requests` library to add:

- **Connection reuse:** Uses a `requests.Session()` which keeps the connection open between requests (faster than reconnecting every time)
- **Automatic retries:** If a request fails, it waits a bit and tries again (up to `max_retries` times)
- **Error logging:** Logs the attempt number and error message for each failure, plus the response body at debug level

It has two methods:
- **`post()`** -- for sending search queries to the API (most endpoints use POST)
- **`get()`** -- for simple lookups by ID (like fetching child companies)

Both methods follow the same pattern: try the request, if it fails check if we have retries left, wait, try again.

### Fuzzy Matching Engine

Since the `rapidfuzz` library isn't available, the script implements its own fuzzy matching using Python's built-in `SequenceMatcher`. Here's what each function does:

**Text Processing:**
- `default_process()` -- lowercases text, removes punctuation, collapses spaces. `"Johnson & Johnson, Inc."` becomes `"johnson johnson inc"`
- `process_company_name()` -- same as above but also strips legal suffixes (Inc, Corp, LLC, etc). `"Raytheon Corporation"` becomes `"raytheon"`
- `COMPANY_SUFFIX_TOKENS` -- the set of legal suffix words to strip

**Scoring Functions (each returns a score from 0 to 100):**
- `ratio()` -- basic character-by-character similarity. How much of one string is in the other?
- `partial_ratio()` -- handles different-length strings by sliding the shorter one across the longer one and finding the best-matching window. `"3M"` should match `"3M Company"` well.
- `token_sort_ratio()` -- sorts both strings alphabetically by word before comparing. Word order doesn't matter.
- `token_set_ratio()` -- compares based on shared vs unique words. `"Lockheed Martin Corp"` vs `"Lockheed Martin Space"` should score high because they share `"lockheed martin"`.
- `wratio()` -- the "weighted ratio". Runs all four methods above and picks the best score, with adjustments for length differences. This is the primary scoring function used throughout the script.

**Search Functions:**
- `extract()` -- scores every candidate against a query and returns the top N matches, sorted by score
- `extract_one()` -- returns just the single best match

### Parent Candidate Scoring

**`score_parent_candidate()`** does a deep comparison between your search name and an API candidate:

1. Runs `wratio()` for the base score
2. Adds bonus points for shared word tokens (proportional to how many search words appear in the candidate)
3. Checks for special conditions:
   - **Exact match:** After cleaning and removing suffixes, are the names identical? Score = 100.
   - **Prefix match:** Does one name start with the other? `"3M"` vs `"3M Company"`. Bonus +3 points.
   - **Acronym match:** Do the first letters of each word spell the same thing? Bonus +4 points.
4. Returns the score, whether it was exact, and a human-readable reason string

**`summarize_top_candidates()`** creates a short text summary for the CSV output, like: `"1) RAYTHEON COMPANY [98.5]; 2) RAYTHEON MISSILES [85.2]"`.

### Data Fetching Functions

**`fetch_awards_by_company()`** -- Searches USAspending for awards matching a company name. Handles pagination automatically using the configured `page_limit`, so this function keeps requesting the next page until there are no more.

**`fetch_parent_recipients()`** -- Searches the USAspending recipient directory by keyword. Used in the parents step to find official company entries with UEI/DUNS numbers.

**`fetch_child_recipients()`** -- Given a parent's UEI or DUNS, fetches all child/subsidiary companies. Handles both list and dict response formats from the API.

**`fetch_awards_by_uei()`** -- Pulls awards for a specific UEI. After getting results, it applies an exact-match filter on the UEI column because the API's text search can return partial matches.

### The Awards Pipeline (Windowing and Resume)

**`process_hierarchy_for_awards()`** is the most complex function. Here's what it does step by step:

1. **Reads the hierarchy CSV** and builds a unique UEI list
2. **Builds UEI/date-window jobs** using `award_date_chunk`
3. **Checks `award_progress.csv`** so completed UEI/date windows are skipped on rerun
4. **Loads `entity_master.csv`** to map each recipient UEI to its `ultimate_parent_uei`
5. **For each remaining award window**, it fetches awards, applies exact UEI filtering, transforms rows into normalized `award_fact` schema, and appends progress/log rows
6. **Error handling:** Failed award windows are written to `failed_award_requests.csv`, and the run summary is written to `run_log.csv`

The `header_written` flag ensures the CSV header is only written once, even with multiple threads.

### The Analysis Function

**`analyze_active_awards_by_month()`** works like this:

1. Reads `award_fact.csv`
2. Reads `entity_master.csv`
3. Resolves the input company name to normalized ultimate-parent UEIs
4. Filters awards to matching `ultimate_parent_uei` values
5. Deduplicates by `award_id`
6. Converts `start_date`/`end_date` to month periods using pandas
7. Builds a range of all months from earliest start to latest end
8. For each month, counts how many awards are active (started before or during that month AND ending during or after that month)
9. Returns a clean DataFrame with Month and Active Awards Count

Awards with missing end dates are assumed to be active for one more year from today.

### The CLI and main() Function

**`build_cli_parser()`** defines all the command-line flags:
- `--step` (required): which step to run
- `--config`: path to config file
- `--input`: path to Excel file
- `--start-date` / `--end-date`: date range
- `--state-file`: path to state file
- `--non-interactive`: don't prompt for input
- `--company`: company name for the analyze step

**`main()`** is the entry point that ties everything together:

1. **Sets up logging** with timestamps and severity levels
2. **Loads config** from config.json via config_loader
3. **Applies overrides** from environment variables and CLI flags
4. **Validates everything** -- converts types, checks ranges, validates dates
5. **Creates the API client** and workflow config objects
6. **Defines step functions** (run_parents, run_children, etc.)
7. **Runs the requested step** (or all steps if `--step all`)
8. **Saves state** after a successful run
9. **Handles errors gracefully** -- catches KeyboardInterrupt (Ctrl+C) and general exceptions

---

## Generated Output Files

After a complete run, you'll have these CSV files:

| File | Created By | Description |
|------|-----------|-------------|
| `parent_companies_ueis_duns.csv` | Step 1 (parents) | Parent companies matching your search names, with fuzzy match scores |
| `child_companies_duns_ueis.csv` | Step 2 (children) | Subsidiary companies under each parent, including parent linkage columns |
| `company_hierarchy.csv` | Step 3 (combine) | Legacy combined hierarchy list (parents + children) |
| `entity_master.csv` | Step 3 (combine) | Normalized entity dimension with ultimate parent resolution |
| `relationships.csv` | Step 3 (combine) | Normalized child->parent relationship edges |
| `award_fact.csv` | Step 4 (awards) | Normalized awards fact table keyed by UEI and ultimate parent UEI |
| `output/powerbi_prototype/entity_master.csv` | Step 5 (powerbi-exports) | Copy of entity dimension for dashboard folder |
| `output/powerbi_prototype/award_fact_readable.csv` | Step 5 (powerbi-exports) | Award fact rows with recipient and ultimate-parent names |
| `output/powerbi_prototype/relationships_readable.csv` | Step 5 (powerbi-exports) | Relationship rows with child and parent names |
| `.usaspending_state.json` | Every run | Small state file tracking last-used values |

---

## Checkpointing and Resume

The awards step (Step 4) supports **automatic resume**. If the script is interrupted -- whether by a crash, Ctrl+C, or your computer going to sleep -- just run the same command again. It will:

1. Read the existing output CSV
2. See which UEIs have already been processed
3. Skip those and continue with the remaining UEIs

This means you never have to re-download data you already have.

**To start completely fresh**, delete the awards output and awards resume/log files, then rerun:
```bash
del award_fact.csv
del award_progress.csv
del failed_award_requests.csv
del award_request_log.csv
python company_management/usaspending_data_pull_refined.py --step awards
```

---

## Throttling and Rate Limits

The USAspending API doesn't publish official rate limits, but it will return errors if you hit it too hard. The script handles this in two ways:

1. **Page pacing:** Small pauses between paginated award requests (`page_pause_seconds`)
2. **Retry backoff:** Transient failures retry with exponential backoff and jitter
3. **Batch throttling:** After every N award windows (`throttle_after_n_ueis`, default 3), the script pauses for a configurable duration (`throttle_pause_seconds`, default 15 seconds)

If you're getting a lot of API errors, try increasing these values in `config.json`.

---

## Logging Output

The script uses Python's `logging` module instead of plain `print()`. Every message includes a timestamp and severity level. Here's what the output looks like:

```
2026-03-23 11:40:09 [INFO] Processing: Raytheon
2026-03-23 11:40:10 [INFO] Wrote 54 rows to parent_companies_ueis_duns.csv
2026-03-23 11:40:15 [WARNING] POST attempt 1 failed: ConnectionResetError(...)
2026-03-23 11:40:31 [ERROR] Step 'parents' failed. Stopping.
```

- **INFO** -- Normal progress updates (which company is being processed, how many rows were written)
- **WARNING** -- Something went wrong but the script is retrying (e.g., a failed API call)
- **ERROR** -- Something failed and couldn't be recovered

---

## Tips for Better Search Results

**Use specific company names, not abbreviations.** The USAspending API does text matching against both company names AND identifier fields (UEI, DUNS). Short or ambiguous search terms return noisy results.

| Search Term | What Happens |
|------------|-------------|
| `RTX` | Returns hundreds of unrelated companies because "RTX" matches inside UEI codes (e.g., `FXNFE4RTxG85`) |
| `RTX Corporation` | Much cleaner -- mostly returns actual RTX/Raytheon entities |
| `Raytheon` | Good results -- specific enough to match Raytheon entities |

**Rule of thumb:** If your company name is 3 characters or fewer, add "Corporation", "Company", or the full name to narrow results. The fuzzy matching scores will help you identify the real matches regardless, but cleaner API results mean less noise to sort through.

---

## Troubleshooting

**"Missing required columns" errors**
- Your input CSVs are missing expected column names. The script expects:
  - Excel input: `Company`
  - Parent/child/hierarchy CSVs: `Original Company Name`, `Recipient Name`, `DUNS`, `UEI`, `Recipient Level`
  - Analyze step inputs: `award_fact.csv` with `award_id`, `ultimate_parent_uei`, `start_date`, `end_date`; and `entity_master.csv` with `uei`, `entity_name`, `original_company_name`, `ultimate_parent_uei`

**"Excel file must contain 'Company' column"**
- Your Excel file's column header doesn't match. Rename it to `Company` (case-sensitive).

**Empty output CSVs**
- Check that your company names are spelled correctly. Try searching them manually on [usaspending.gov](https://www.usaspending.gov/) to see if they return results.
- Broad or unusual names might not match anything in the database.

**API errors or timeouts**
- The script automatically retries transient failures 5 times. If it keeps failing:
  - Increase `read_timeout_seconds` in config.json
  - Increase `retry_delay_seconds`, `retry_max_delay_seconds`, or `page_pause_seconds` to give the API more breathing room
  - Use more specific company names and/or `fuzzy_mode: "strict"` so Step 1 returns fewer parent candidates
  - Try running with fewer companies

**"No valid company input Excel file found"**
- Make sure you're passing `--input path/to/file.xlsx` or setting `USASPENDING_COMPANY_NAMES_EXCEL`
- Check that the file path is correct and the file exists

**Script was interrupted and you want to restart**
- Just run the same command again. The resume feature will skip already-completed UEI/date windows from `award_progress.csv`.
- To truly start fresh, delete the output CSV files first.

**`ConnectionResetError(10054, 'An existing connection was forcibly closed by the remote host')`**
- The USAspending API closed the connection. This usually means rate limiting, API maintenance, or a network/VPN issue.
- The script retries automatically, but if all retry attempts fail:
  - Wait a minute and try again (often temporary)
  - Increase `page_pause_seconds` or `retry_max_delay_seconds` in config.json
  - Try opening `https://api.usaspending.gov/api/v2/recipient/duns/` in your browser to check if the API is up
  - If you're on a VPN or corporate network, try disconnecting temporarily

**Results contain unrelated companies**
- This is expected with short or ambiguous search terms. The API matches your text against names AND identifier codes (UEI, DUNS). See [Tips for Better Search Results](#tips-for-better-search-results).
- The fuzzy matching scores help -- look at candidates above the threshold (default 96). Everything below that is noise.

---

## Legacy Script

The legacy script (`usaspending_data_pull.py`) is the original single-file version. It's kept for reference but:
- Does not support step-by-step execution
- Does not have CLI flags
- Does not support resume/checkpointing
- Does not have fuzzy matching

Use `usaspending_data_pull_refined.py` for all new work.

