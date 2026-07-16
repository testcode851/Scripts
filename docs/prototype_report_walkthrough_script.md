# USAspending Prototype Report Walkthrough Script

Use this as a read-aloud script while walking through `usaspending_prototype_report.ipynb`.

## Opening

Today I am walking through the USAspending prototype report. The purpose of this prototype is to show how we can start with a list of company names, identify the matching USAspending entities, map parent and child company relationships, and then pull federal award records tied to those entities.

This is still a prototype, so the goal is not to present a final production dashboard. The goal is to show the data pipeline, the reporting files it creates, and how those files can support a Power BI dashboard.

For this run, the notebook is using `config/CompanyNames.xlsx` as the input file. The current test companies in the folder are 3M Company and Dow Inc.

## Setup And Test Companies

The first part of the notebook is setup. It keeps file paths explicit so the notebook can be rerun from the repository root. This helps make the workflow repeatable instead of relying on hidden notebook state.

The next section confirms the company input file. This is important because everything downstream depends on the company names we start with. If the Excel file changes, the parent matches, child entities, and award records can also change.

## Refined Pipeline

The notebook then shows how the refined USAspending pipeline can be run step by step.

The pipeline has several main stages:

1. Find parent company matches from the input company names.
2. Find child or subsidiary entities connected to those parent companies.
3. Combine the parent and child entities into a company hierarchy.
4. Pull award records for the UEIs in that hierarchy.
5. Export readable files for Power BI.

Running the script step by step is useful for a prototype because each output file can be explained and checked before moving to the next stage.

The notebook also has a setting that lets us decide whether to actually run the pipeline from the notebook, or only review the files that already exist. That keeps the report useful even when we do not want to make new API calls.

## Output Files

The pipeline creates a few staging files and three main reporting files.

The staging files are:

- `parent_companies_ueis_duns.csv`, which stores the parent company matches.
- `child_companies_duns_ueis.csv`, which stores child or subsidiary entities found under the parents.
- `company_hierarchy.csv`, which combines parent and child entities into one hierarchy file.

The main reporting files are:

- `entity_master.csv`, which is the company and entity lookup table.
- `relationships.csv`, which stores child-to-parent relationships.
- `award_fact.csv`, which stores the federal award records.

In plain language, `award_fact.csv` tells us what federal awards were found. `entity_master.csv` tells us who the companies and entities are. `relationships.csv` tells us how child entities connect back to parent companies.

## Current Prototype Metrics

Using the current files in this folder, the prototype has:

- 2 parent company match rows.
- 44 child company rows.
- 46 combined hierarchy rows.
- 45 normalized entity rows in `entity_master.csv`.
- 43 child-to-parent relationship rows in `relationships.csv`.
- 5,411 award rows in `award_fact.csv`.

The current award file totals about $853 million in award value. The award records cover 10 recipient UEIs and, in the current output, are tied to one ultimate parent in the award fact table: 3M Company.

The current awards run completed 270 award windows, with 270 successful windows and 0 failed windows. The request log shows 393 successful API requests.

These numbers are useful for the prototype walkthrough because they show that the pipeline is producing real reporting outputs, not only test scaffolding.

## Workflow Graphic

The workflow graphic is included to explain the pipeline visually.

The flow starts with the Excel company list. From there, the script finds parent company matches, then child companies, then combines them into a hierarchy. After that, it pulls award records and writes the normalized reporting files.

This is the core story of the prototype: company names become entity identifiers, entity identifiers become a hierarchy, and the hierarchy becomes award reporting data.

## Normalized Tables

The notebook then explains why the data is normalized into separate tables.

Instead of putting everything into one large CSV, the prototype separates the data into three main tables:

- `entity_master.csv` is the entity dimension table.
- `relationships.csv` is the hierarchy or edge table.
- `award_fact.csv` is the award transaction table.

This structure is better for auditing and for Power BI. It lets us join awards to recipients, recipients to parent companies, and parent companies back to readable company names.

The recommended model is:

- Join `award_fact.recipient_uei` to `entity_master.uei`.
- Join `award_fact.ultimate_parent_uei` to `entity_master.uei`.
- Join `relationships.child_uei` to `entity_master.uei`.
- Join `relationships.parent_uei` to `entity_master.uei`.

That gives us both award-level detail and parent-company rollups.

## Company Structure Graphic

Step 8 creates a small company structure graphic from `relationships.csv`.

This graphic is not meant to be a full hierarchy browser yet. It is a quick preview that shows parent-child relationship data in a visual format.

The current version selects relationship rows from `relationships.csv`, looks up readable names from `entity_master.csv`, and displays a parent with related child entities. This helps demonstrate that the hierarchy file can support visuals beyond raw tables.

## Power BI Prototype Exports

The notebook also reviews the Power BI prototype exports.

The official Power BI export process is handled by the refined script. The files are written to `output/powerbi_prototype`.

The current export folder contains:

- `entity_master.csv`
- `award_fact_readable.csv`
- `relationships_readable.csv`

The readable files add company names onto the normalized IDs. That makes them easier to use in Power BI visuals because the dashboard can show company names instead of only UEIs.

## Recommended Power BI Dashboard

The first Power BI prototype should be exploratory.

The recommended pages are:

1. An overview page with total award amount, award count, company count, and failed request count.
2. A company explorer page showing parent companies, child entities, UEIs, and award totals.
3. An agency view showing award totals and counts by agency and sub-agency.
4. A timeline view showing award activity by start and end date.
5. A data quality view showing match quality, failed requests, and run-log status.

The goal is to let users answer basic questions like: Which companies have awards? Which agencies are awarding them? Which child entities are involved? And how much award activity rolls up to the parent company?

## Bulk Download Direction

The notebook also explains why we are considering a bulk download approach.

The current refined script pulls awards by UEI and date window. That is traceable and easy to audit, but it can create many API calls. More API calls means longer runtimes and more chances for connection resets, server errors, or throttling.

The bulk download idea is different. Instead of asking USAspending for many small slices, we would download larger award files by date range and filter them locally to the UEIs we care about.

The reason this matters is reliability. For a dashboard refresh process, fewer external API calls may be more stable than many repeated award searches.

The refined script is still important because it creates the company and hierarchy files that the bulk process would need for filtering.

## SEC Notebook Overview

The report also mentions the SEC notebook as a separate exploration track.

The USAspending pipeline focuses on federal award exposure. The SEC notebook focuses on public-company financial context using tickers, CIKs, SEC submissions, and XBRL company facts.

The key issue is that SEC and USAspending do not share a single universal identifier. SEC uses ticker and CIK. USAspending uses UEI and DUNS.

To combine those two sources, we would need a maintained crosswalk table. Once that exists, we could compare federal award exposure with public-company financial context.

## Closing Summary

In summary, this prototype shows that we can start with company names, identify USAspending entities, build a parent-child company structure, pull award records, and organize the results into reporting-ready files.

The most important outputs are `entity_master.csv`, `relationships.csv`, and `award_fact.csv`. Those files support both auditability and Power BI modeling.

The current prototype has produced 45 normalized entities, 43 relationships, and 5,411 award records totaling about $853 million in award value.

The next steps are to review match quality, continue building the Power BI prototype, and decide whether the bulk download approach should replace or supplement the current award-pull method for larger refreshes.

