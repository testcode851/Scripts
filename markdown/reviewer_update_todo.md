# Reviewer Update To-Do List

This checklist tracks the remaining work needed to make the USAspending and SEC extraction scripts match the reviewer-requested project structure and output behavior.

## Current Setup Status

Updated in `C:\Users\tonya\Repos\Scripts` on 2026-07-15.

Completed setup work:

- Copied workflow scripts into `company_management/`.
- Copied reusable modules into `src/`.
- Copied config files into `config/`.
- Copied Markdown documentation into `docs/`.
- Copied notebooks into `notebooks/`.
- Added `logs/.gitkeep`.
- Copied this checklist into `markdown/`.
- Removed obsolete root-level `sec_company_extraction.py` and root-level `sec_extraction/` after confirming the updated structured copies exist.
- Added `src/__init__.py` so `src.*` imports are explicit.
- Verified syntax/import viability with `py_compile` from the repo root.
- Consolidated generated files under `output/usaspending/`, `output/sec/`, and `output/powerbi/`.
- Kept operational logs under `logs/`.
- Created and manually verified the Access proof-of-concept table `CompanyProfilePOC` with `UltimateParentUEI` as its primary key.
- Added the one-command company-profile workflow at `company_management/build_and_load_company_profiles.py`.
- Added the reusable `src/company_profiles/` package with separate schema, builder, and Access-loading modules.
- Verified the 31-column company-profile schema, parent/child award aggregation, latest SEC fiscal-year selection, missing-data flags, CSV creation, and mocked Access transaction behavior.

Important remaining blocker:

- A live Access load has not been run. `config/config.ini` is not present in this workspace, `pyodbc` is not installed in the active Python environment, and the required USAspending/SEC output CSVs have not been generated here.

## Part 1 - Correct scripts for the new file locations

- [x] Confirm the current folder structure is correct:
  - `company_management/` contains runnable workflow scripts.
  - `src/` contains reusable Python modules/classes.
  - `config/` contains configuration files and user-provided input files.
  - `docs/` contains explanation/reference Markdown files.
  - `notebooks/` contains example or exploration notebooks.
  - `logs/` contains runtime log files.

- [x] Confirm these files are in their intended locations:
  - `company_management/usaspending_data_pull_refined.py`
  - `company_management/sec_company_extraction.py`
  - `src/config_loader.py`
  - `src/sec_extraction/`
  - `config/config.json`
  - `config/CompanyNames.xlsx`
  - `docs/usaspending_data_workflow.md`
  - `notebooks/sec_data_exploration_starter.ipynb`

- [x] Update `company_management/usaspending_data_pull_refined.py` imports for the new structure:
  - Changed `from config_loader import load_config`
  - To `from src.config_loader import load_config`

- [x] Update `company_management/sec_company_extraction.py` imports for the new structure:
  - Changed imports from `sec_extraction...`
  - To imports from `src.sec_extraction...`

- [x] Update default config path in `company_management/usaspending_data_pull_refined.py`:
  - From `config.json`
  - To `config/config.json`

- [x] Update default company input file paths:
  - From `CompanyNames.xlsx`
  - To `config/CompanyNames.xlsx`

- [x] Update `config/config.json` so workflow input paths point to the new locations:
  - `workflow.company_names_excel` now points to `config/CompanyNames.xlsx`.
  - `workflow.run_log_csv` now points to `logs/run_log.csv`.
  - USAspending outputs now point to `output/usaspending/`.
  - Power BI outputs now point to `output/powerbi/`.
  - SEC outputs default to `output/sec/`.

- [x] Check whether documentation still references old commands or paths:
  - Root-level script command examples were replaced in copied docs where found.

- [x] Update documentation examples to use the new script locations, for example:
  - `python company_management/usaspending_data_pull_refined.py ...`
  - `python company_management/sec_company_extraction.py ...`

- [x] Verify that moving files did not break package imports:
  - Added `src/__init__.py`.
  - Confirmed `src/sec_extraction/__init__.py` exists.
  - Confirmed scripts compile from the repo root with `py_compile`.

- [ ] Replace remaining `print(...)` calls with `logging` calls:
  - Remaining in `company_management/sec_company_extraction.py`.
  - Remaining in `company_management/usaspending_data_pull_refined.py`.
  - Remaining in `src/sec_extraction/pipeline.py`.
  - Use the existing logging pattern from `data_retrieval_main.py` on `main` if that file is provided or available.
  - Write logs to the `logs/` folder.
  - Make sure user-facing status messages are still available through logs.

- [x] Confirm generated/local files are ignored correctly:
  - Runtime CSV exports
  - `.usaspending_state.json`
  - Power BI files/output folders
  - Logs, except for `logs/.gitkeep`

- [x] Run a lightweight syntax/import check after path updates:
  - `python -m py_compile company_management/usaspending_data_pull_refined.py`
  - `python -m py_compile company_management/sec_company_extraction.py`

- [x] Run `git status` and verify only intended files are staged before committing:
  - Nothing was staged.
  - Expected changes are new structured folders, `.gitignore` update, and deletion of obsolete root-level SEC files.

## Part 2 - Build company profiles and load the Access POC table

Design decision: keep USAspending and SEC CSVs as the extraction/staging layer. Build one combined company-profile CSV and load only that profile dataset into Access. Power BI reporting files remain CSVs.

- [x] Review the USAspending and SEC CSV-writing and reading locations.
  - Confirmed that the workflows depend on intermediate CSVs for restartability, review, and cross-workflow handoff.
  - Decided not to replace the extraction CSVs with direct Access writes.

- [x] Review the separate `database_manager.py` implementation supplied by screenshot.
  - Decided not to reuse it for this proof of concept.
  - Implemented a small, purpose-specific Access loader instead.

- [x] Define the Access configuration approach.
  - The loader expects `config/config.ini`.
  - It reads only `[Database] path` and `[Database] driver`.
  - The database path is not hardcoded in Python.

- [ ] Add `config/config.ini` to this workspace and point it to the test database.
  - Use `TestDB.accdb` for the first live load.
  - Do not point at the shared production database until the POC is verified.

- [x] Confirm and create the target Access table.
  - Table name: `CompanyProfilePOC`.
  - Primary key: `UltimateParentUEI`.
  - The 31 fields and Access data types were created and manually verified.

- [x] Define the POC source-to-profile mapping.
  - `output/usaspending/entity_master.csv` supplies company identity and ultimate-parent fields.
  - `output/usaspending/award_fact.csv` supplies award totals, counts, agencies, recipients, and date coverage.
  - `output/sec/sec_company_profile_readable.csv` supplies approved SEC identity/profile fields.
  - `output/sec/sec_company_financials_annual_readable.csv` supplies the latest SEC fiscal-year financials.
  - `output/powerbi/company_profile_readable.csv` is the reviewable combined profile loaded into Access.

- [x] Separate the profile workflow by responsibility.
  - `company_management/build_and_load_company_profiles.py` is the 37-line one-command entry point.
  - `src/company_profiles/schema.py` contains fixed paths, field mappings, and final column order.
  - `src/company_profiles/builder.py` builds and validates profiles.
  - `src/company_profiles/access.py` reads the INI file and performs the Access transaction.

- [x] Keep the command line simple.
  - Run with `python company_management/build_and_load_company_profiles.py`.
  - No command-line arguments are required for the POC.

- [x] Implement safe POC rerun behavior.
  - Build and validate the profile dataset before connecting to Access.
  - Delete and replace `CompanyProfilePOC` rows inside one transaction.
  - Commit on success and roll back on failure.
  - Use parameterized INSERT statements.

- [x] Keep the SEC crosswalk review flow as CSV.
  - Only approved SEC profile rows are used by the company-profile builder.
  - Human crosswalk review remains outside the Access POC load.

- [x] Run non-live validation.
  - All company-profile modules compile.
  - Representative parent/child award aggregation passed.
  - Latest SEC fiscal-year selection passed.
  - Missing SEC coverage flags passed.
  - The exact 31-column output order passed.
  - A mocked Access DELETE/INSERT/commit/close transaction passed.

- [ ] Install `pyodbc` and verify that the Microsoft Access ODBC driver is available to the active Python interpreter.

- [ ] Generate the required USAspending and SEC source CSVs in their new output folders.

- [ ] Run the one-command profile build/load against `TestDB.accdb`.

- [ ] Validate `CompanyProfilePOC` manually in Access.
  - Compare the Access row count with `company_profile_readable.csv`.
  - Spot-check several UEIs, award totals, approved SEC matches, and latest financial years.
  - Run the loader twice and confirm the second run does not create duplicates.

- [ ] Add file-based logging for live database loads if the reviewer requires logs under `logs/`.

- [ ] Update the user documentation after the first successful live load.

- [ ] Commit the final reviewer updates after live validation.

## Next 5 Actions

- [ ] Create `config/config.ini` with the `[Database]` path pointing to `TestDB.accdb` and the installed Access ODBC driver name.
- [ ] Install `pyodbc` in the active Python environment and verify that Python can see `Microsoft Access Driver (*.mdb, *.accdb)`.
- [ ] Run the USAspending and SEC workflows to generate the four required source CSVs under `output/usaspending/` and `output/sec/`.
- [ ] Run `python company_management/build_and_load_company_profiles.py` and verify the first live load into `CompanyProfilePOC`.
- [ ] Compare the Access table with `output/powerbi/company_profile_readable.csv`, rerun the loader to confirm no duplicates, then document the verified process.

## Additional steps to consider

- [ ] Add or update a small test script under `tests/` to verify imports from the new folder structure.

- [ ] Add a sample or template config file if `config/config.json` contains local/private values.

- [ ] Confirm whether `CompanyNames.xlsx` should be committed long-term or replaced by a sample/template workbook.

- [ ] Confirm whether Power BI files should remain local-only or be stored elsewhere.

- [ ] Confirm whether notebooks should be cleaned before commit to remove large outputs or local paths.

- [x] Confirm whether the old root-level SEC files should remain:
  - Removed obsolete root-level `sec_company_extraction.py` and `sec_extraction/` from `Scripts`.
