# Selected Companies Output Guide

## Purpose

`config/CompanyNames.xlsx` contains the companies submitted for review. The output files show which companies were found in USAspending and which parent companies could be matched to SEC records.

The outputs identify parent companies. Child companies may appear in supporting files, but they are not additional companies from the original Excel list.

## Main file: `output/powerbi/company_profile_readable.csv`

Start with `company_profile_readable.csv`. It is the easiest file for seeing the available company information together in one place.

It contains one row per ultimate-parent UEI and includes:

- original company name from `CompanyNames.xlsx`;
- resolved parent company name;
- parent DUNS and UEI;
- SEC company name, CIK, and ticker when an approved match exists;
- SIC and basic SEC company information;
- total award amount and award counts;
- latest available SEC financial information;
- SEC match method, confidence, and review status; and
- `DataCoverageFlag`, which identifies missing award or SEC information.

Companies without an approved SEC match are still included. Their CIK, ticker, and other SEC fields will be blank, and `DataCoverageFlag` will include `missing_sec_profile`.

Award totals are grouped by ultimate parent and can include awards for child recipients beneath that parent.

This file is created by:

```text
company_management/build_and_load_company_profiles.py
```

Run it from the `Scripts` directory with:

```bash
python company_management/build_and_load_company_profiles.py
```

The USAspending and SEC workflows must be run first. The script writes `company_profile_readable.csv` before attempting to load the same records into the Microsoft Access `CompanyProfilePOC` table.

## Supporting files

Use the following files when more detail is needed or when a value in `company_profile_readable.csv` needs to be traced to its source.

### `config/CompanyNames.xlsx`

The `Company` column is the authoritative list of company names submitted to the sandbox.

### `output/usaspending/parent_companies_ueis_duns.csv`

Shows the direct USAspending result for each Excel name.

Important columns:

- `Original Company Name`: name from the Excel file.
- `Recipient Name`: parent company found in USAspending.
- `DUNS` and `UEI`: identifiers for the matched parent.
- `Recipient Level`: `P` means a parent match. `No Match`, `No Parent`, or `Ambiguous` requires further review.
- `Match Score`, `Top Candidates`, and `Review Note`: information about how the match was selected.

### `output/usaspending/entity_master.csv`

Contains normalized parent and child entities with valid UEIs. It does not include Excel names for which no valid USAspending match was found.

For matched parent records, use rows where:

```text
uei == ultimate_parent_uei
```

Use `original_company_name` to trace the record to the Excel input. Use `ultimate_parent_name` and `ultimate_parent_uei` to identify the resolved parent.

### `output/sec/company_sec_crosswalk_candidates.csv`

Maps each USAspending ultimate parent to an SEC company when a unique exact match was found.

Important columns include:

- `original_company_name`
- `ultimate_parent_name` and `ultimate_parent_uei`
- `sec_company_name`
- `cik` and `ticker`
- `match_method`, `match_confidence`, and `review_status`

`review_status=approved` means the SEC match was accepted. `review_status=no_match` means no unique exact SEC match was accepted; it does not prove that the company is private.

### `output/sec/sec_company_profile_readable.csv`

Provides the detailed SEC identity and company profile for approved matches. It can be used to confirm the SEC company name, CIK, ticker, SIC, location, website, and match information.

### `output/sec/sec_company_financials_annual_readable.csv`

Provides available annual SEC financial measures and related data-quality notes for approved SEC matches.

### `output/sec/sec_10k_sections_readable.csv`

Provides selected 10-K section previews and source URLs for approved SEC matches.

### `output/sec/sec_extraction_batch_summary.csv`

Shows whether SEC extraction succeeded and lists any warnings or errors that may affect the available company information.

## Identifier notes

- Use `ultimate_parent_uei` as the main key between the USAspending and SEC outputs.
- Preserve DUNS and CIK as text so leading zeroes are not lost.
- A blank CIK or ticker may indicate a private/non-reporting company, a naming difference, or an unresolved SEC match.
- A ticker belongs to the matched ultimate parent or SEC registrant; it does not mean an individual subsidiary is separately traded.
- Child-company output files provide supporting hierarchy information but should not be treated as additional companies from `CompanyNames.xlsx`.
