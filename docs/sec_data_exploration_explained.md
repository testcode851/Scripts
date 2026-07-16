# SEC Data Exploration Starter: Plain-English Walkthrough

Source reviewed: `sec_data_exploration_starter.ipynb`

This document explains what the SEC data exploration notebook is doing, block by block. It is written for a reader with minimal coding experience. The notebook itself is not changed by this explanation.

## Big Picture

The notebook is an exploration workflow for pulling public-company financial context from the U.S. Securities and Exchange Commission (SEC).

It does four main things:

1. Sets up Python libraries, request settings, and an output folder.
2. Uses SEC ticker mapping data to convert stock tickers into SEC Central Index Keys (CIKs).
3. Pulls SEC company metadata and selected XBRL financial facts for a small seed list of companies.
4. Converts the raw facts into CSV tables that can be reviewed, joined, or used later in analysis.

The notebook is intentionally not scoring companies. It only extracts and reshapes source data.

## Markdown Block: Title And Notebook Purpose

The first markdown block introduces the notebook as the "SEC API Data Exploration Starter."

It says the notebook is focused only on SEC data extraction. That means it is not yet calculating risk, financial health, or any rating. It is getting data ready for later work.

It lists the main output tables:

- `sec_company_crosswalk`: a starter bridge between SEC company identifiers and USAspending identifiers.
- `sec_company_submissions`: company metadata from SEC submissions.
- `sec_company_facts_long`: selected raw XBRL fact rows.
- `sec_company_financials_wide`: a company-year financial summary.

## Markdown Block: Acronym Glossary

This block defines common terms used in the notebook.

- SEC means Securities and Exchange Commission.
- API means Application Programming Interface. In simple terms, it is a structured way for code to ask a website or service for data.
- CIK means Central Index Key. This is the SEC's company identifier.
- UEI and DUNS are USAspending or government-facing organization identifiers.
- XBRL is the structured data format used for many SEC filing facts.
- SIC is an industry classification code.
- 10-K, 20-F, and 40-F are annual filing forms.
- CSV is a spreadsheet-friendly text file format.
- BI means Business Intelligence.
- QA means Quality Assurance.

## Code Block 1: Step 1 Environment Setup

### What This Block Does

This block prepares the notebook to run by loading the Python libraries it will need, defining the basic settings used by later blocks, and creating a place to save output files. Think of it as the setup desk for the rest of the notebook: pandas is loaded so the notebook can work with spreadsheet-like tables, requests is loaded so it can call SEC web endpoints, and pathlib is loaded so folder paths can be handled cleanly. The block also defines the SEC user-agent, which is the identity string sent with each SEC request, and it creates the `output/sec_exploration` folder before any export step tries to write files there. The final check makes sure the SEC user-agent is not blank, because SEC automated access should identify the requester.

### Code

```python
from __future__ import annotations

import os
import time
from pathlib import Path

import pandas as pd
import requests

SEC_USER_AGENT = os.getenv("SEC_USER_AGENT", "KCNSC (aarango@kcnsc.doe.com)")
REQUEST_DELAY_SECONDS = 0.2
OUTPUT_DIR = Path("output") / "sec_exploration"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

if not SEC_USER_AGENT.strip():
    raise ValueError("SEC_USER_AGENT must not be empty.")
```

### Line-By-Line Explanation

`from __future__ import annotations`

This enables newer behavior for type hints. Type hints are labels that describe what kind of value a function expects or returns. This line helps Python handle those labels more flexibly.

`import os`

This loads Python's operating-system helper library. The notebook uses it to read an environment variable named `SEC_USER_AGENT`.

`import time`

This loads time-related functions. The notebook uses it to pause between SEC requests.

`from pathlib import Path`

This imports `Path`, a cleaner way to work with file and folder paths.

`import pandas as pd`

This loads the pandas data-analysis library and gives it the nickname `pd`. Pandas is used to create and transform tables.

`import requests`

This loads the requests library, which makes HTTP calls to SEC URLs.

`SEC_USER_AGENT = os.getenv("SEC_USER_AGENT", "KCNSC (aarango@kcnsc.doe.com)")`

This looks for an environment variable called `SEC_USER_AGENT`. If it exists, the notebook uses that value. If it does not exist, the notebook uses the default text shown here.

The SEC expects automated requests to identify who is making them. The user-agent is that identity string.

`REQUEST_DELAY_SECONDS = 0.2`

This sets a minimum pause of 0.2 seconds between SEC requests. That helps avoid sending requests too quickly.

`OUTPUT_DIR = Path("output") / "sec_exploration"`

This defines the folder where exported CSV files will be written. The final path is `output/sec_exploration`.

`OUTPUT_DIR.mkdir(parents=True, exist_ok=True)`

This creates the output folder if it does not already exist.

`parents=True` means Python should also create any missing parent folders, such as `output`.

`exist_ok=True` means Python should not fail if the folder already exists.

`if not SEC_USER_AGENT.strip():`

This checks whether the user-agent is blank after removing spaces from both ends.

`raise ValueError("SEC_USER_AGENT must not be empty.")`

If the user-agent is blank, the notebook stops and shows an error. This prevents anonymous or malformed SEC requests.

## Code Block 2: Step 2 SEC Request Helper

### What This Block Does

This block creates the notebook's reusable SEC request system. Instead of writing the same web-request code every time the notebook needs SEC data, this block defines helper functions that handle the common work once: setting request headers, waiting between calls, building full SEC URLs from shorter endpoint paths, sending the request, checking for HTTP errors, and converting the SEC response from JSON into Python data. This matters because the notebook calls more than one SEC endpoint, and centralized request logic keeps those calls consistent. If retries, stronger logging, or different throttling rules are needed later, this is the one place where that behavior would naturally be improved.

### Code

```python
BASE_SEC_URL = "https://data.sec.gov"
_LAST_SEC_CALL_TS = 0.0

def build_sec_session(user_agent: str) -> requests.Session:
    session = requests.Session()
    session.headers.update(
        {
            "User-Agent": user_agent,
            "Accept-Encoding": "gzip, deflate",
        }
    )
    return session

sec_session = build_sec_session(SEC_USER_AGENT)

def sec_get_json(path_or_url: str, pause_seconds: float = REQUEST_DELAY_SECONDS) -> dict:
    global _LAST_SEC_CALL_TS
    now = time.time()
    elapsed = now - _LAST_SEC_CALL_TS
    if elapsed < pause_seconds:
        time.sleep(pause_seconds - elapsed)

    url = path_or_url if path_or_url.startswith("http") else f"{BASE_SEC_URL}{path_or_url}"
    response = sec_session.get(url, timeout=45)
    _LAST_SEC_CALL_TS = time.time()
    response.raise_for_status()
    return response.json()
```

### Line-By-Line Explanation

`BASE_SEC_URL = "https://data.sec.gov"`

This stores the base SEC data website URL. Later code can provide only the endpoint path, and this base URL will be added automatically.

`_LAST_SEC_CALL_TS = 0.0`

This stores the timestamp of the most recent SEC request. It starts at zero because no request has happened yet.

`def build_sec_session(user_agent: str) -> requests.Session:`

This defines a function named `build_sec_session`.

A function is a reusable block of code. This one receives a `user_agent` text value and returns a `requests.Session`.

`session = requests.Session()`

This creates a session object. A session remembers settings, such as headers, across multiple web requests.

`session.headers.update(`

This begins updating the headers that will be sent with every request from this session. The next indented lines are a dictionary, which is Python's way of storing key-value pairs.

`"User-Agent": user_agent,`

This sets the SEC-required user-agent header to the value passed into the function.

`"Accept-Encoding": "gzip, deflate",`

This tells the SEC server that the client can accept compressed responses. Compressed responses can be smaller and faster to transfer.

`}` and `)`

The `}` closes the dictionary of headers. The `)` closes the `session.headers.update(...)` function call.

`return session`

This gives the configured session back to the rest of the notebook.

`sec_session = build_sec_session(SEC_USER_AGENT)`

This calls the function above and creates one shared SEC session using the configured user-agent.

`def sec_get_json(path_or_url: str, pause_seconds: float = REQUEST_DELAY_SECONDS) -> dict:`

This defines a second function named `sec_get_json`.

It accepts either a full URL or a partial SEC path. It also accepts a pause length, defaulting to `REQUEST_DELAY_SECONDS`.

`global _LAST_SEC_CALL_TS`

This tells Python that the function will update the shared `_LAST_SEC_CALL_TS` variable defined outside the function.

`now = time.time()`

This gets the current time as a timestamp.

`elapsed = now - _LAST_SEC_CALL_TS`

This calculates how much time has passed since the last SEC call.

`if elapsed < pause_seconds:`

This checks whether the notebook is about to call the SEC too soon.

`time.sleep(pause_seconds - elapsed)`

If not enough time has passed, this pauses just long enough to respect the configured delay.

`url = path_or_url if path_or_url.startswith("http") else f"{BASE_SEC_URL}{path_or_url}"`

This builds the request URL.

If `path_or_url` already starts with `http`, it is treated as a complete URL.

If it does not start with `http`, it is treated as a path, and the notebook adds `https://data.sec.gov` in front of it.

`response = sec_session.get(url, timeout=45)`

This sends a GET request to the URL. A GET request asks the server for data.

`timeout=45` means the request can wait up to 45 seconds before failing.

`_LAST_SEC_CALL_TS = time.time()`

This records the time of the request so the next call can be paced properly.

`response.raise_for_status()`

This checks whether the SEC returned an HTTP error, such as 404 or 500. If there was an error, Python raises an exception.

`return response.json()`

This parses the SEC response as JSON and returns it as Python data.

## Code Block 3: Step 3 Ticker-To-CIK Mapping

### What This Block Does

This block downloads the SEC's public ticker-to-CIK mapping and reshapes it into a clean lookup table. Analysts usually think in stock tickers like `LMT`, `RTX`, and `BA`, but many SEC company data endpoints require a CIK instead of a ticker. This block solves that translation problem by pulling the SEC mapping file, trying a backup URL if the first URL fails, and then converting the result into a pandas table with only the fields this notebook needs: ticker, CIK, and company name. It also standardizes the data by uppercasing tickers and padding CIK values to 10 digits, which prevents later SEC API calls and joins from failing because of inconsistent identifier formatting.

### Code

```python
# Pull SEC ticker-to-CIK mapping
# Use JSON endpoints only.
ticker_sources = [
    "https://www.sec.gov/files/company_tickers.json",
    "https://sec.gov/files/company_tickers.json",
]

ticker_payload = None
last_exc = None
for source in ticker_sources:
    try:
        ticker_payload = sec_get_json(source)
        break
    except Exception as exc:
        last_exc = exc

if ticker_payload is None:
    raise RuntimeError(f"Unable to load SEC ticker mapping from JSON endpoints: {last_exc}")

ticker_map = pd.DataFrame.from_dict(ticker_payload, orient="index")
ticker_map = ticker_map.rename(columns={"cik_str": "cik", "title": "company_name"})
ticker_map["cik"] = ticker_map["cik"].astype(int).astype(str).str.zfill(10)
ticker_map["ticker"] = ticker_map["ticker"].str.upper()
ticker_map = ticker_map[["ticker", "cik", "company_name"]].sort_values("ticker").reset_index(drop=True)
ticker_map.head()
```

### Line-By-Line Explanation

`# Pull SEC ticker-to-CIK mapping`

This is a comment. It explains that the block is getting a mapping between stock tickers and SEC CIK identifiers.

`# Use JSON endpoints only.`

This comment says the notebook is using SEC JSON data, not scraping web pages.

`ticker_sources = [`

This starts a list of possible URLs to try. The closing `]` later in the code ends this list.

`"https://www.sec.gov/files/company_tickers.json",`

This is the first SEC URL to try.

`"https://sec.gov/files/company_tickers.json",`

This is the second SEC URL to try if the first one fails.

`ticker_payload = None`

This creates a variable to hold the downloaded ticker data. It starts as `None`, meaning "nothing yet."

`last_exc = None`

This creates a variable to remember the most recent error if a download fails.

`for source in ticker_sources:`

This starts a loop through each URL in the `ticker_sources` list.

`try:`

This begins a section where Python will try something that might fail.

`ticker_payload = sec_get_json(source)`

This calls the SEC helper function to download and parse the ticker mapping JSON from the current URL.

`break`

If the download works, this exits the loop because there is no need to try the second URL.

`except Exception as exc:`

If any error happens in the `try` section, this catches the error and stores it as `exc`.

`last_exc = exc`

This remembers the error so it can be shown later if all URLs fail.

`if ticker_payload is None:`

After trying the URLs, this checks whether the notebook still has no data.

`raise RuntimeError(f"Unable to load SEC ticker mapping from JSON endpoints: {last_exc}")`

If no ticker data was downloaded, the notebook stops and explains the failure.

`ticker_map = pd.DataFrame.from_dict(ticker_payload, orient="index")`

This converts the downloaded JSON dictionary into a pandas table called `ticker_map`.

`orient="index"` tells pandas that the outer dictionary keys should be treated as row identifiers.

`ticker_map = ticker_map.rename(columns={"cik_str": "cik", "title": "company_name"})`

This renames two columns to clearer names.

`cik_str` becomes `cik`.

`title` becomes `company_name`.

`ticker_map["cik"] = ticker_map["cik"].astype(int).astype(str).str.zfill(10)`

This cleans the CIK column.

First it converts CIK values to integers. Then it converts them back to text. Then it pads them with leading zeroes until they are 10 characters long.

This matters because SEC company endpoints expect 10-digit CIK strings.

`ticker_map["ticker"] = ticker_map["ticker"].str.upper()`

This converts ticker symbols to uppercase.

`ticker_map = ticker_map[["ticker", "cik", "company_name"]].sort_values("ticker").reset_index(drop=True)`

This keeps only three columns: ticker, CIK, and company name.

It sorts the table alphabetically by ticker.

It resets the row numbering so the table has clean row numbers after sorting.

`ticker_map.head()`

This displays the first few rows of the ticker mapping table.

## Code Block 4: Step 4 Crosswalk Seed Table

### What This Block Does

This block chooses the initial companies for the SEC exploration and turns them into a starter crosswalk table. A crosswalk is a bridge table that connects identifiers from different systems. In this case, the SEC uses CIKs and tickers, while USAspending uses identifiers such as UEI and sometimes DUNS. Because there is no automatic universal key between those systems, the notebook creates an explicit table where those relationships can eventually be reviewed and maintained. For now, the block starts with three seed tickers, finds their SEC identifiers from the ticker map, copies the SEC company name into a recipient-name field, and leaves UEI and DUNS blank as placeholders for future matching work.

### Code

```python
# Seed set can be replaced with your current target companies
SEED_TICKERS = ["LMT", "RTX", "BA"]

sec_company_crosswalk = (
    ticker_map[ticker_map["ticker"].isin(SEED_TICKERS)]
    .drop_duplicates(subset=["ticker"])
    .assign(
        uei=pd.NA,
        duns=pd.NA,
        recipient_name=lambda df: df["company_name"],
        match_method="manual_seed",
        match_confidence=1.0,
        last_verified_date=pd.Timestamp.today().normalize(),
    )
    [[
        "uei",
        "duns",
        "recipient_name",
        "cik",
        "ticker",
        "match_method",
        "match_confidence",
        "last_verified_date",
    ]]
    .sort_values("ticker")
    .reset_index(drop=True)
)

sec_company_crosswalk
```

### Line-By-Line Explanation

`# Seed set can be replaced with your current target companies`

This comment says the list below is only a starter list and can later be replaced.

`SEED_TICKERS = ["LMT", "RTX", "BA"]`

This defines the starter companies by ticker.

`LMT` is Lockheed Martin.

`RTX` is RTX Corporation.

`BA` is Boeing.

`sec_company_crosswalk = (`

This starts building a table named `sec_company_crosswalk`.

The parentheses let the code chain several table operations across multiple lines.

`ticker_map[ticker_map["ticker"].isin(SEED_TICKERS)]`

This filters `ticker_map` down to only rows where the ticker is in the seed list.

`.drop_duplicates(subset=["ticker"])`

This removes duplicate rows with the same ticker, keeping one row per ticker.

`.assign(`

This starts adding new columns to the table. The later `)` closes this `.assign(...)` section.

`uei=pd.NA,`

This adds a `uei` column with missing values. The notebook does not yet know the USAspending UEI for each SEC company.

`duns=pd.NA,`

This adds a `duns` column with missing values. The notebook does not yet know the DUNS value either.

`recipient_name=lambda df: df["company_name"],`

This adds a `recipient_name` column by copying the SEC company name.

`lambda df: ...` is a small inline function. Here it means "for this dataframe, use its `company_name` column."

`match_method="manual_seed",`

This records that these rows came from a manually chosen seed list.

`match_confidence=1.0,`

This sets match confidence to `1.0`, meaning full confidence for this starter seed mapping.

`last_verified_date=pd.Timestamp.today().normalize(),`

This records today's date as the verification date. `normalize()` removes the time of day and keeps only the date portion.

`[[ ... ]]`

This begins selecting and ordering the final columns. The double brackets are pandas syntax for choosing multiple columns from a table.

`"uei",`

This includes the UEI placeholder column.

`"duns",`

This includes the DUNS placeholder column.

`"recipient_name",`

This includes the company or recipient name.

`"cik",`

This includes the SEC CIK.

`"ticker",`

This includes the stock ticker.

`"match_method",`

This includes how the match was created.

`"match_confidence",`

This includes the confidence score for the match.

`"last_verified_date",`

This includes the date the match was verified.

`.sort_values("ticker")`

This sorts the crosswalk alphabetically by ticker.

`.reset_index(drop=True)`

This resets row numbers after sorting.

Final closing `)`

This finishes the full table-building expression that started at `sec_company_crosswalk = (`. It is not creating a new value by itself; it is closing the earlier multi-line expression.

`sec_company_crosswalk`

This displays the completed crosswalk table in the notebook.

## Code Block 5: Step 5 Optional USAspending Context

### What This Block Does

This block optionally brings in context from the USAspending side of the project. The SEC notebook can run by itself, but the larger project may eventually need to compare SEC public-company data with USAspending entity records. To support that future join, this block checks whether an `entity_master.csv` file is available in the current folder. If it exists, the notebook loads it as text so organization identifiers are not accidentally changed by pandas. If it does not exist, the notebook creates an empty table and prints a message explaining that SEC-only exploration will continue. This makes the notebook easier to use during development because it does not require the full USAspending pipeline output every time.

### Code

```python
# Optional: load entity_master if you already created it from USAspending
entity_master_path = Path("entity_master.csv")
if entity_master_path.exists():
    entity_master = pd.read_csv(entity_master_path, dtype=str)
    print(f"entity_master rows: {len(entity_master):,}")
else:
    entity_master = pd.DataFrame()
    print("entity_master.csv not found yet. Continue with SEC-only exploration.")
```

### Line-By-Line Explanation

`# Optional: load entity_master if you already created it from USAspending`

This comment explains that the file is optional.

`entity_master_path = Path("entity_master.csv")`

This creates a path object pointing to `entity_master.csv` in the current working folder.

`if entity_master_path.exists():`

This checks whether that file exists.

`entity_master = pd.read_csv(entity_master_path, dtype=str)`

If the file exists, pandas reads it into a table named `entity_master`.

`dtype=str` tells pandas to read all columns as text. This helps avoid accidental changes to identifiers, such as dropping leading zeroes.

`print(f"entity_master rows: {len(entity_master):,}")`

This prints the number of rows loaded.

`else:`

This starts the fallback branch for when the file does not exist.

`entity_master = pd.DataFrame()`

This creates an empty pandas table so later code can still refer to `entity_master` without crashing.

`print("entity_master.csv not found yet. Continue with SEC-only exploration.")`

This tells the notebook user that the USAspending file is missing, but that the SEC exploration can continue.

## Code Block 6: Step 6 Pull SEC Submissions And Facts

### What This Block Does

This is the main SEC data extraction block. For every company in the starter crosswalk, it calls two SEC JSON endpoints: the submissions endpoint, which provides company-level metadata such as legal name, SIC industry code, fiscal year end, state of incorporation, phone, and entity type; and the company facts endpoint, which provides structured XBRL financial facts reported in SEC filings. The block does not attempt to download or parse full filing documents. Instead, it pulls a narrow set of U.S. GAAP facts in USD that are useful for basic financial context: revenue variants, net income or loss, assets, and liabilities. It stores company profile rows separately from fact rows so the notebook has both a metadata table and a raw long-form financial facts table for review.

### Code

```python
FACT_TAGS = [
    "Revenues",
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "SalesRevenueNet",
    "NetIncomeLoss",
    "Assets",
    "Liabilities",
]

def extract_usd_facts(facts_json: dict, cik: str, ticker: str) -> list[dict]:
    rows: list[dict] = []
    us_gaap = facts_json.get("facts", {}).get("us-gaap", {})

    for tag in FACT_TAGS:
        units = us_gaap.get(tag, {}).get("units", {})
        usd_points = units.get("USD", [])

        for point in usd_points:
            rows.append(
                {
                    "cik": cik,
                    "ticker": ticker,
                    "tag": tag,
                    "end": point.get("end"),
                    "start": point.get("start"),
                    "val": point.get("val"),
                    "fy": point.get("fy"),
                    "fp": point.get("fp"),
                    "form": point.get("form"),
                    "filed": point.get("filed"),
                    "accn": point.get("accn"),
                }
            )

    return rows

submission_rows = []
facts_rows = []

for row in sec_company_crosswalk.itertuples(index=False):
    cik = str(row.cik).zfill(10)
    ticker = row.ticker

    try:
        submission = sec_get_json(f"/submissions/CIK{cik}.json")
        facts = sec_get_json(f"/api/xbrl/companyfacts/CIK{cik}.json")
    except requests.HTTPError as exc:
        print(f"Skipping {ticker} ({cik}) due to HTTP error: {exc}")
        continue

    submission_rows.append(
        {
            "cik": cik,
            "ticker": ticker,
            "entity_name": submission.get("name"),
            "sic": submission.get("sic"),
            "sic_description": submission.get("sicDescription"),
            "fiscal_year_end": submission.get("fiscalYearEnd"),
            "state_of_incorporation": submission.get("stateOfIncorporation"),
            "phone": submission.get("phone"),
            "entity_type": submission.get("entityType"),
        }
    )

    facts_rows.extend(extract_usd_facts(facts, cik=cik, ticker=ticker))

sec_company_submissions = pd.DataFrame(submission_rows)
sec_company_facts_long = pd.DataFrame(facts_rows).rename(columns={"val": "value"})

print(f"submissions rows: {len(sec_company_submissions):,}")
print(f"facts rows: {len(sec_company_facts_long):,}")
```

### Line-By-Line Explanation

`FACT_TAGS = [`

This starts a list of SEC XBRL fact names to extract. The closing `]` later in the code ends this list.

`"Revenues",`

This asks for the SEC fact called `Revenues`.

`"RevenueFromContractWithCustomerExcludingAssessedTax",`

This asks for another revenue-related fact. Companies do not all use the same revenue tag, so the notebook checks more than one.

`"SalesRevenueNet",`

This asks for a third revenue-related fact.

`"NetIncomeLoss",`

This asks for net income or loss.

`"Assets",`

This asks for total assets.

`"Liabilities",`

This asks for total liabilities.

`def extract_usd_facts(facts_json: dict, cik: str, ticker: str) -> list[dict]:`

This defines a function that extracts selected USD facts from SEC company facts JSON.

It receives the JSON payload plus the company's CIK and ticker.

`rows: list[dict] = []`

This creates an empty list that will hold extracted fact rows.

`us_gaap = facts_json.get("facts", {}).get("us-gaap", {})`

This navigates into the SEC JSON structure to find U.S. GAAP facts.

The `.get(..., {})` pattern means "try to get this key; if it is missing, use an empty dictionary instead."

`for tag in FACT_TAGS:`

This loops through each fact tag listed above.

`units = us_gaap.get(tag, {}).get("units", {})`

This looks up the units section for the current fact tag.

For example, revenue facts may have units such as USD.

`usd_points = units.get("USD", [])`

This keeps only fact values reported in U.S. dollars.

If no USD facts exist for the tag, it uses an empty list.

`for point in usd_points:`

This loops through every USD data point for the current tag.

Each point is usually one reported fact from a filing period.

`rows.append(`

This starts adding a new row to the output list. The next indented block is a dictionary representing one fact row.

`"cik": cik,`

This stores the SEC company identifier.

`"ticker": ticker,`

This stores the stock ticker.

`"tag": tag,`

This stores which XBRL fact this row represents, such as `Assets` or `NetIncomeLoss`.

`"end": point.get("end"),`

This stores the end date for the reporting period or balance date.

`"start": point.get("start"),`

This stores the start date for the reporting period, when available.

`"val": point.get("val"),`

This stores the numeric value reported by the company.

`"fy": point.get("fy"),`

This stores the fiscal year associated with the fact.

`"fp": point.get("fp"),`

This stores the fiscal period. For annual facts, this is often `FY`.

`"form": point.get("form"),`

This stores the SEC filing form where the fact appeared, such as `10-K`, `10-Q`, `20-F`, or `40-F`.

`"filed": point.get("filed"),`

This stores the date the filing was submitted to the SEC.

`"accn": point.get("accn"),`

This stores the accession number, which is the SEC filing identifier.

`}` and `)`

The `}` closes the dictionary for one fact row. The `)` closes the `rows.append(...)` call, which finishes adding that row to the list.

`return rows`

This sends the list of extracted rows back to the calling code.

`submission_rows = []`

This creates an empty list for company metadata rows.

`facts_rows = []`

This creates an empty list for financial fact rows.

`for row in sec_company_crosswalk.itertuples(index=False):`

This loops through each company in the crosswalk table.

`itertuples(index=False)` gives each row as a simple object and excludes the pandas row number.

`cik = str(row.cik).zfill(10)`

This gets the CIK from the row, converts it to text, and pads it to 10 digits.

`ticker = row.ticker`

This gets the ticker from the row.

`try:`

This starts a section where HTTP requests may fail.

`submission = sec_get_json(f"/submissions/CIK{cik}.json")`

This calls the SEC submissions endpoint for the company.

The result includes company profile metadata and filing metadata.

`facts = sec_get_json(f"/api/xbrl/companyfacts/CIK{cik}.json")`

This calls the SEC company facts endpoint for the company.

The result includes structured XBRL facts.

`except requests.HTTPError as exc:`

This catches HTTP errors from the SEC requests.

`print(f"Skipping {ticker} ({cik}) due to HTTP error: {exc}")`

This prints a message saying the company is being skipped because of the HTTP error.

`continue`

This moves to the next company instead of stopping the entire notebook.

`submission_rows.append(`

This starts adding one company metadata row to the metadata list. The next indented block is a dictionary containing company metadata fields.

`"cik": cik,`

This stores the SEC CIK.

`"ticker": ticker,`

This stores the stock ticker.

`"entity_name": submission.get("name"),`

This stores the company name from the submissions endpoint.

`"sic": submission.get("sic"),`

This stores the company's SIC industry code.

`"sic_description": submission.get("sicDescription"),`

This stores the plain-language description of the SIC industry code.

`"fiscal_year_end": submission.get("fiscalYearEnd"),`

This stores the company's fiscal year end as month and day, such as `1231` for December 31.

`"state_of_incorporation": submission.get("stateOfIncorporation"),`

This stores the state where the company is incorporated, if available.

`"phone": submission.get("phone"),`

This stores the phone number reported in SEC metadata, if available.

`"entity_type": submission.get("entityType"),`

This stores the SEC entity type, such as operating company.

`}` and `)`

The `}` closes the metadata dictionary. The `)` closes the `submission_rows.append(...)` call, which finishes adding the metadata row.

`facts_rows.extend(extract_usd_facts(facts, cik=cik, ticker=ticker))`

This extracts selected USD facts from the company facts JSON and adds all resulting rows to the main `facts_rows` list.

`extend` adds multiple rows at once.

`sec_company_submissions = pd.DataFrame(submission_rows)`

This converts the metadata list into a pandas table.

`sec_company_facts_long = pd.DataFrame(facts_rows).rename(columns={"val": "value"})`

This converts the financial facts list into a pandas table.

It also renames the raw value column from `val` to the clearer name `value`.

`print(f"submissions rows: {len(sec_company_submissions):,}")`

This prints how many company metadata rows were created.

`print(f"facts rows: {len(sec_company_facts_long):,}")`

This prints how many fact rows were created.

## Markdown Block: Step 6B Company Profile Metadata Dictionary

This markdown block explains the fields in `sec_company_submissions`.

It is documentation only. It does not run code.

The important point is that company profile information such as `entity_name`, `sic_description`, and `fiscal_year_end` comes from the SEC submissions endpoint, not from each raw fact row.

## Code Block 7: Step 7 Raw Facts Sanity Check

### What This Block Does

This block performs a quick visual check on the raw SEC facts table created in the previous extraction block. It does not transform or export anything; it simply displays the first few rows so the person running the notebook can confirm that data came back and that the expected columns are present. This is useful because SEC data can vary by company and filing history. Before building summaries, the notebook gives the user a chance to inspect whether fields such as CIK, ticker, tag, value, fiscal year, filing form, filing date, and accession number are populated in the shape the later steps expect.

### Code

```python
sec_company_facts_long.head()
```

### Line-By-Line Explanation

`sec_company_facts_long.head()`

This displays the first few rows of the `sec_company_facts_long` table.

It is a quick check that the SEC facts were pulled and shaped correctly.

The expected columns include identifiers, fact tag, period dates, value, fiscal year, fiscal period, filing form, filing date, and accession number.

## Code Block 8: Step 7B Entity Name Verification Join

### What This Block Does

This block demonstrates how company names can be attached to the raw fact rows for easier review. The raw SEC facts table is intentionally fact-focused, so it contains identifiers such as CIK and ticker, but the company display name comes from the submissions metadata table. This block first shows the name lookup fields from `sec_company_submissions`, then performs a left join that adds `entity_name` to each matching raw fact row using CIK. The result is a preview table, not a final export table, and its purpose is to make quality checks easier for users who want to see fact rows alongside readable company names.

### Code

```python
# Verify where entity_name lives and optionally join it to facts preview
sec_company_submissions[["cik", "ticker", "entity_name"]]

facts_with_names = sec_company_facts_long.merge(
    sec_company_submissions[["cik", "entity_name"]],
    on="cik",
    how="left"
)
facts_with_names.head()
```

### Line-By-Line Explanation

`# Verify where entity_name lives and optionally join it to facts preview`

This comment explains that the block is checking where company names are stored.

`sec_company_submissions[["cik", "ticker", "entity_name"]]`

This displays only three columns from the submissions table: CIK, ticker, and company name.

`facts_with_names = sec_company_facts_long.merge(`

This starts creating a new table named `facts_with_names`.

It uses `merge`, which is pandas' word for joining two tables together.

`sec_company_submissions[["cik", "entity_name"]],`

This selects the company name lookup columns from the submissions table.

`on="cik",`

This tells pandas to join the two tables using the `cik` column.

`how="left"`

This means keep all rows from the left table, which is `sec_company_facts_long`, and add matching company names where available.

Final closing `)`

This closes the `merge(...)` call above.

`facts_with_names.head()`

This displays the first few rows of the enriched fact preview.

## Code Block 9: Step 8 Build Non-Scoring Financial Summary

### What This Block Does

This block turns the raw long-form SEC facts into an analyst-readable financial summary with one row per company and fiscal year. The raw facts table may contain many rows for the same company, fiscal year, and financial concept because facts can appear across different filings or amendments. To make the data easier to use, this block first filters to annual filing forms only: `10-K`, `20-F`, and `40-F`. It then converts fiscal year and filing date fields into proper numeric and date types, removes rows where fiscal year is missing, and keeps the latest filed value for each company, fact tag, and fiscal year. After that, it pivots the data so financial concepts become columns instead of rows, creates a preferred `reported_revenue` field from the available revenue tags, renames technical SEC tag names into easier column names, and joins company profile fields such as entity name, industry description, and fiscal year end.

### Code

```python
ANNUAL_FORMS = {"10-K", "20-F", "40-F"}

financial_facts = sec_company_facts_long[sec_company_facts_long["form"].isin(ANNUAL_FORMS)].copy()
financial_facts["fiscal_year"] = pd.to_numeric(financial_facts["fy"], errors="coerce")
financial_facts["filed_date"] = pd.to_datetime(financial_facts["filed"], errors="coerce")
financial_facts = financial_facts.dropna(subset=["fiscal_year"])
financial_facts["fiscal_year"] = financial_facts["fiscal_year"].astype(int)

# Keep the latest reported value for each company, tag, and fiscal year.
financial_facts = (
    financial_facts
    .sort_values(["cik", "tag", "fiscal_year", "filed_date"])
    .drop_duplicates(subset=["cik", "ticker", "tag", "fiscal_year"], keep="last")
)

sec_company_financials_wide = (
    financial_facts
    .pivot_table(index=["cik", "ticker", "fiscal_year"], columns="tag", values="value", aggfunc="last")
    .reset_index()
)
sec_company_financials_wide.columns.name = None

for column in FACT_TAGS:
    if column not in sec_company_financials_wide.columns:
        sec_company_financials_wide[column] = pd.NA

revenue_source_columns = [
    "Revenues",
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "SalesRevenueNet",
]
available_revenue_columns = [column for column in revenue_source_columns if column in sec_company_financials_wide.columns]
if available_revenue_columns:
    sec_company_financials_wide["reported_revenue"] = sec_company_financials_wide[available_revenue_columns].bfill(axis=1).iloc[:, 0]
else:
    sec_company_financials_wide["reported_revenue"] = pd.NA

sec_company_financials_wide = sec_company_financials_wide.rename(
    columns={
        "Revenues": "revenues",
        "RevenueFromContractWithCustomerExcludingAssessedTax": "revenue_from_contract",
        "SalesRevenueNet": "sales_revenue_net",
        "NetIncomeLoss": "net_income_loss",
        "Assets": "assets",
        "Liabilities": "liabilities",
    }
)

company_profile_columns = ["cik", "entity_name", "sic_description", "fiscal_year_end"]
sec_company_financials_wide = sec_company_financials_wide.merge(
    sec_company_submissions[company_profile_columns].drop_duplicates(subset=["cik"]),
    on="cik",
    how="left",
)

preferred_columns = [
    "cik",
    "ticker",
    "entity_name",
    "sic_description",
    "fiscal_year_end",
    "fiscal_year",
    "reported_revenue",
    "revenues",
    "revenue_from_contract",
    "sales_revenue_net",
    "net_income_loss",
    "assets",
    "liabilities",
]
sec_company_financials_wide = sec_company_financials_wide[preferred_columns].sort_values(["ticker", "fiscal_year"]).reset_index(drop=True)
sec_company_financials_wide.head()
```

### Line-By-Line Explanation

`ANNUAL_FORMS = {"10-K", "20-F", "40-F"}`

This defines the set of filing forms treated as annual filings. The braces are Python set syntax, which is useful for checking whether a value is in a group.

`financial_facts = sec_company_facts_long[sec_company_facts_long["form"].isin(ANNUAL_FORMS)].copy()`

This filters the raw facts table to only facts whose `form` value is one of the annual forms.

`.copy()` creates a separate table so later edits do not accidentally modify the original raw facts table.

`financial_facts["fiscal_year"] = pd.to_numeric(financial_facts["fy"], errors="coerce")`

This converts the `fy` column into a numeric fiscal year column.

`errors="coerce"` means invalid values become missing values instead of causing the notebook to stop.

`financial_facts["filed_date"] = pd.to_datetime(financial_facts["filed"], errors="coerce")`

This converts the filing date text into a date value.

`financial_facts = financial_facts.dropna(subset=["fiscal_year"])`

This removes rows where fiscal year could not be determined.

`financial_facts["fiscal_year"] = financial_facts["fiscal_year"].astype(int)`

This converts fiscal year values to whole numbers, such as `2024`.

`# Keep the latest reported value for each company, tag, and fiscal year.`

This comment explains the deduplication rule.

`financial_facts = (`

This starts rebuilding the `financial_facts` table.

`financial_facts`

This begins with the existing filtered annual facts table.

`.sort_values(["cik", "tag", "fiscal_year", "filed_date"])`

This sorts facts by company, fact tag, fiscal year, and filing date.

This sorting prepares the table so the latest filed value appears last within each group.

`.drop_duplicates(subset=["cik", "ticker", "tag", "fiscal_year"], keep="last")`

This removes duplicate rows for the same company, ticker, tag, and fiscal year.

`keep="last"` keeps the latest row after sorting, which usually means the most recently filed value.

Final closing `)`

This closes the chained table operation that started at `financial_facts = (`.

`sec_company_financials_wide = (`

This starts creating the wide financial summary table.

`financial_facts`

This uses the cleaned annual facts table as the source.

`.pivot_table(index=["cik", "ticker", "fiscal_year"], columns="tag", values="value", aggfunc="last")`

This converts rows into columns.

The output will have one row per CIK, ticker, and fiscal year.

Each distinct `tag` becomes its own column.

The values in those columns come from the `value` column.

`aggfunc="last"` tells pandas what to do if more than one value still exists for a cell. It keeps the last one.

`.reset_index()`

This turns CIK, ticker, and fiscal year back into regular columns instead of table index fields.

Final closing `)`

This closes the pivot operation that started at `sec_company_financials_wide = (`.

`sec_company_financials_wide.columns.name = None`

This removes the display name that pandas may attach to the column headers after pivoting.

`for column in FACT_TAGS:`

This loops through every expected fact tag.

`if column not in sec_company_financials_wide.columns:`

This checks whether the wide table is missing one of the expected columns.

`sec_company_financials_wide[column] = pd.NA`

If a column is missing, this adds it with missing values.

This keeps the output schema consistent even if a company did not report a particular tag.

`revenue_source_columns = [`

This starts a list of possible revenue columns. The closing `]` later in the code ends this list.

`"Revenues",`

This is the first revenue tag to use.

`"RevenueFromContractWithCustomerExcludingAssessedTax",`

This is the second revenue tag to use if the first is missing.

`"SalesRevenueNet",`

This is the third revenue tag to use if the others are missing.

`available_revenue_columns = [column for column in revenue_source_columns if column in sec_company_financials_wide.columns]`

This creates a list of revenue columns that actually exist in the table.

`if available_revenue_columns:`

This checks whether at least one revenue source column is available.

`sec_company_financials_wide["reported_revenue"] = sec_company_financials_wide[available_revenue_columns].bfill(axis=1).iloc[:, 0]`

This creates a single `reported_revenue` column.

It looks across the available revenue columns from left to right.

`bfill(axis=1)` fills missing values across columns using the next available value to the right.

`.iloc[:, 0]` takes the first column after that fill. In practice, this picks the first available revenue value in the preferred order.

`else:`

This starts the fallback branch for when no revenue columns are available.

`sec_company_financials_wide["reported_revenue"] = pd.NA`

This creates `reported_revenue` as missing if no revenue tag is available.

`sec_company_financials_wide = sec_company_financials_wide.rename(`

This starts renaming columns to cleaner names. The `columns={...}` argument is a dictionary where each original column name points to its new name.

`"Revenues": "revenues",`

This renames `Revenues` to lowercase `revenues`.

`"RevenueFromContractWithCustomerExcludingAssessedTax": "revenue_from_contract",`

This renames the long revenue tag to a shorter readable column name.

`"SalesRevenueNet": "sales_revenue_net",`

This renames `SalesRevenueNet` to `sales_revenue_net`.

`"NetIncomeLoss": "net_income_loss",`

This renames `NetIncomeLoss` to `net_income_loss`.

`"Assets": "assets",`

This renames `Assets` to `assets`.

`"Liabilities": "liabilities",`

This renames `Liabilities` to `liabilities`.

`}` and `)`

The `}` closes the rename dictionary. The `)` closes the `rename(...)` call.

`company_profile_columns = ["cik", "entity_name", "sic_description", "fiscal_year_end"]`

This lists the company profile fields to attach to the financial summary.

`sec_company_financials_wide = sec_company_financials_wide.merge(`

This starts joining company profile data onto the financial summary table.

`sec_company_submissions[company_profile_columns].drop_duplicates(subset=["cik"]),`

This selects profile columns from the submissions table and keeps one profile row per CIK.

`on="cik",`

This tells pandas to join using the CIK column.

`how="left",`

This keeps every row from the financial summary and adds matching profile fields where possible.

Final closing `)`

This closes the `merge(...)` call above.

`preferred_columns = [`

This starts a list of the final output columns in the desired order. The closing `]` later in the code ends this list.

`"cik",`

This keeps the SEC CIK.

`"ticker",`

This keeps the stock ticker.

`"entity_name",`

This keeps the company name.

`"sic_description",`

This keeps the industry description.

`"fiscal_year_end",`

This keeps the company's fiscal year-end date code.

`"fiscal_year",`

This keeps the fiscal year for the financial values.

`"reported_revenue",`

This keeps the consolidated preferred revenue column.

`"revenues",`

This keeps the raw `Revenues` tag value.

`"revenue_from_contract",`

This keeps the raw contract revenue tag value.

`"sales_revenue_net",`

This keeps the raw net sales revenue tag value.

`"net_income_loss",`

This keeps net income or loss.

`"assets",`

This keeps assets.

`"liabilities",`

This keeps liabilities.

`sec_company_financials_wide = sec_company_financials_wide[preferred_columns].sort_values(["ticker", "fiscal_year"]).reset_index(drop=True)`

This keeps only the preferred columns, sorts the table by ticker and fiscal year, and resets row numbers.

`sec_company_financials_wide.head()`

This displays the first few rows of the final financial summary.

## Code Block 10: Step 9 Export Extracted Tables

### What This Block Does

This block saves the notebook's main working tables as CSV files so they can be opened, reviewed, shared, or used by later analysis steps outside the notebook. It collects the four important tables into one export dictionary: the SEC-to-USAspending starter crosswalk, the company submissions metadata, the raw long-form SEC facts, and the wide company-year financial summary. Then it loops through that dictionary and writes each table into the `output/sec_exploration` folder created during setup. The block finishes by printing the output location and listing the exported filenames, which gives the user a quick confirmation that the extraction produced files successfully.

### Code

```python
table_exports = {
    "sec_company_crosswalk.csv": sec_company_crosswalk,
    "sec_company_submissions.csv": sec_company_submissions,
    "sec_company_facts_long.csv": sec_company_facts_long,
    "sec_company_financials_wide.csv": sec_company_financials_wide,
}

for filename, frame in table_exports.items():
    frame.to_csv(OUTPUT_DIR / filename, index=False)

print(f"Wrote {len(table_exports)} extraction tables to: {OUTPUT_DIR.resolve()}")
list(table_exports.keys())
```

### Line-By-Line Explanation

`table_exports = {`

This starts a dictionary that maps output filenames to pandas tables. The closing `}` later in the code ends this dictionary.

`"sec_company_crosswalk.csv": sec_company_crosswalk,`

This says to export the crosswalk table to `sec_company_crosswalk.csv`.

`"sec_company_submissions.csv": sec_company_submissions,`

This says to export the submissions metadata table to `sec_company_submissions.csv`.

`"sec_company_facts_long.csv": sec_company_facts_long,`

This says to export the long raw facts table to `sec_company_facts_long.csv`.

`"sec_company_financials_wide.csv": sec_company_financials_wide,`

This says to export the wide financial summary table to `sec_company_financials_wide.csv`.

`for filename, frame in table_exports.items():`

This loops through each filename and table pair in the dictionary.

`frame.to_csv(OUTPUT_DIR / filename, index=False)`

This writes the current table to a CSV file inside the output folder.

`index=False` means pandas should not write the internal row numbers into the CSV.

`print(f"Wrote {len(table_exports)} extraction tables to: {OUTPUT_DIR.resolve()}")`

This prints how many tables were written and shows the full output folder path.

`list(table_exports.keys())`

This displays the list of exported filenames.

## What Data The Notebook Pulls From SEC

The notebook pulls two categories of SEC data.

### Company Metadata

From the SEC submissions endpoint, it pulls:

- CIK
- ticker
- entity name
- SIC code
- SIC description
- fiscal year end
- state of incorporation
- phone
- entity type

### Financial Facts

From the SEC company facts endpoint, it pulls selected U.S. GAAP facts in USD:

- revenues
- revenue from contracts with customers, excluding assessed tax
- sales revenue net
- net income or loss
- assets
- liabilities

For each fact, it preserves:

- CIK
- ticker
- tag name
- period start date
- period end date
- value
- fiscal year
- fiscal period
- SEC form
- filing date
- accession number

## What It Does With 10-K Data

The notebook does not parse full 10-K documents or read narrative sections like risk factors, management discussion, or business descriptions.

Instead, it uses the SEC company facts API. That API exposes structured XBRL facts that came from filings including 10-Ks.

In Step 8, the notebook filters facts to annual forms:

- `10-K`
- `20-F`
- `40-F`

Then it summarizes those annual facts into one row per company and fiscal year.

## Final Outputs

When run successfully, the notebook writes four CSV files to `output/sec_exploration`:

- `sec_company_crosswalk.csv`
- `sec_company_submissions.csv`
- `sec_company_facts_long.csv`
- `sec_company_financials_wide.csv`

These are extraction and staging outputs. They are meant to support review and later pipeline development, not final scoring.

## Practical Interpretation

The notebook is a prototype for connecting public-company financial information to the broader USAspending work.

The key limitation is that SEC and USAspending do not share one universal identifier. The notebook creates a starter crosswalk, but the UEI and DUNS fields are placeholders until a governed matching process fills them in.

The current seed companies are:

- `LMT`
- `RTX`
- `BA`

The current financial scope is narrow and focused:

- revenue variants
- net income or loss
- assets
- liabilities

That makes the notebook useful for early financial context, but not yet a full SEC risk or financial-health workflow.

