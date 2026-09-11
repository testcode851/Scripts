# Scripts

This folder contains the company-matching and data-extraction pipeline. The goal is to understand the flow from source data to normalized company records and final profile outputs, rather than to focus on how to run the scripts.

## How to read this repository

Start with the workflow overview in [docs/COMPANY_DATA_WORKFLOW.md](docs/COMPANY_DATA_WORKFLOW.md). It explains the end-to-end process, the files involved, and how the USAspending and SEC stages connect.

Then read the scripts in this order:

1. [company_management/usaspending_data_pull_refined.py](company_management/usaspending_data_pull_refined.py)
   - This is the main USAspending pipeline entry point.
   - Read it to understand the available stages, the configuration inputs, and how parent/child award records are assembled.

2. [company_management/sec_company_extraction.py](company_management/sec_company_extraction.py)
   - This is the SEC matching and extraction workflow.
   - Read it to see how company names are matched against SEC registrants and how filing data is collected.

3. [company_management/build_and_load_company_profiles.py](company_management/build_and_load_company_profiles.py)
   - This is the final aggregation step.
   - Read it to understand how the combined company profile is built and exported.

## What the supporting code does

After the entry points, review the reusable logic in the [src](src) folder:

- [src/config_loader.py](src/config_loader.py)
  - Loads defaults and merges configuration values used across the pipelines.

- [src/sec_extraction](src/sec_extraction)
  - Contains the SEC client, crosswalk logic, XBRL handling, 10-K extraction, and orchestration code.

- [src/company_profiles](src/company_profiles)
  - Contains the profile schema, join logic, CSV generation, and Access load logic.

## How to read a script effectively

- Start with the module docstring and the main entry function.
- Follow the function calls from `main()` into the helper functions.
- Look at the input files and output paths first to understand what each script is producing.
- Then read the transformation logic in sequence, rather than trying to understand every utility function at once.
- Treat [notebooks](notebooks) as exploratory work, not the authoritative production flow.

## In short

The best reading order is:

1. Workflow document
2. Company management entry scripts
3. Supporting modules under [src](src)
4. Output files and generated data to verify the flow

This keeps the logic readable without focusing on execution commands or operational setup.
