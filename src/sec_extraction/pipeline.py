"""Coordinate SEC downloads, transformations, and batch output generation."""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import Any

import pandas as pd
import requests

from .schemas import (
    ANNUAL_FINANCIAL_FIELDNAMES,
    AWARD_SEC_SUMMARY_FIELDNAMES,
    BASE_DATA_URL,
    BATCH_SUMMARY_FIELDNAMES,
    CROSSWALK_FIELDNAMES,
    EXTRACT_FIELDNAMES,
    PROFILE_FIELDNAMES,
    SEC_10K_SECTION_FIELDNAMES,
)
from .sec_client import (
    CompanyIdentifier,
    SecClient,
    clean_text,
    ensure_output_dir,
    normalize_cik,
    read_table,
    resolve_company,
    write_csv,
    write_json,
)
from .ten_k import add_10k_urls, extract_10k_sections, html_to_text, ten_k_filings
from .xbrl import (
    add_crosswalk_context,
    build_annual_financial_rows,
    build_10k_section_readable_rows,
    build_profile_readable_row,
    extract_company_profile,
    flatten_filing_columns,
    flatten_recent_filings,
    flatten_xbrl_facts,
    profile_to_extract_rows,
    section_to_extract_rows,
    to_float,
    xbrl_to_extract_rows,
)


def extract_company(
    client: SecClient,
    company: CompanyIdentifier,
    output_dir: Path,
    include_all_10k: bool = False,
    save_raw_json: bool = False,
    save_full_extract: bool = False,
    company_context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Download and transform SEC records for one company."""
    # This coordinator intentionally retains its explicit options and local result sets.
    # pylint: disable=too-many-arguments,too-many-positional-arguments,too-many-locals
    ensure_output_dir(output_dir)

    submissions = client.get_json(f"{BASE_DATA_URL}/submissions/CIK{company.cik}.json")
    source_warnings: list[str] = []
    companyfacts_url = f"{BASE_DATA_URL}/api/xbrl/companyfacts/CIK{company.cik}.json"
    try:
        companyfacts = client.get_json_if_available(companyfacts_url)
    except requests.RequestException as exc:
        companyfacts = None
        source_warnings.append(f"Company Facts request failed: {exc}")
    if companyfacts is None:
        companyfacts = {}
        source_warnings.append("SEC Company Facts are unavailable for this CIK.")

    if save_raw_json:
        write_json(output_dir / "raw_submissions.json", submissions)
        write_json(output_dir / "raw_companyfacts.json", companyfacts)

    extract_rows: list[dict[str, Any]] = []

    profile = extract_company_profile(submissions, company)
    extract_rows.extend(profile_to_extract_rows(profile))

    filing_rows = load_all_filing_rows(client, submissions, company, source_warnings)

    xbrl_rows = flatten_xbrl_facts(companyfacts, company)
    extract_rows.extend(xbrl_to_extract_rows(xbrl_rows))

    ten_k_rows = add_10k_urls(ten_k_filings(filing_rows))

    filings_to_download = ten_k_rows if include_all_10k else ten_k_rows[:1]
    section_rows: list[dict[str, str]] = []
    section_extract_rows: list[dict[str, Any]] = []

    for filing in filings_to_download:
        accession = filing.get("accessionNumber", "")
        if not accession:
            continue
        sections = download_filing_sections(client, filing, output_dir, source_warnings)
        section_rows.extend(sections)
        current_section_rows = section_to_extract_rows(sections, company, filing)
        section_extract_rows.extend(current_section_rows)
        extract_rows.extend(current_section_rows)

    add_crosswalk_context(extract_rows, company_context)
    add_crosswalk_context(section_extract_rows, company_context)
    if save_full_extract:
        write_csv(output_dir / "sec_company_extract.csv", extract_rows, EXTRACT_FIELDNAMES)

    return {
        "company": company,
        "profile": profile,
        "xbrl_rows": xbrl_rows,
        "extract_rows": extract_rows,
        "section_extract_rows": section_extract_rows,
        "recent_filing_count": len(filing_rows),
        "ten_k_count": len(ten_k_rows),
        "xbrl_fact_count": len(xbrl_rows),
        "ten_k_section_count": len(section_rows),
        "status": extraction_status(bool(companyfacts), len(ten_k_rows), source_warnings),
        "source_warnings": source_warnings,
        "output_dir": str(output_dir),
    }


def load_all_filing_rows(
    client: SecClient,
    submissions: dict[str, Any],
    company: CompanyIdentifier,
    source_warnings: list[str],
) -> list[dict[str, Any]]:
    """Load recent and supplemental SEC filing-history rows for one company."""
    rows = flatten_recent_filings(submissions, company)
    supplemental_files = submissions.get("filings", {}).get("files", [])
    for metadata in supplemental_files:
        filename = clean_text(metadata.get("name")) if isinstance(metadata, dict) else ""
        if not filename:
            continue
        url = f"{BASE_DATA_URL}/submissions/{filename}"
        try:
            payload = client.get_json_if_available(url)
        except requests.RequestException as exc:
            source_warnings.append(f"Supplemental filing history failed ({filename}): {exc}")
            continue
        if payload is None:
            source_warnings.append(f"Supplemental filing history unavailable: {filename}")
            continue
        rows.extend(flatten_filing_columns(payload, company))

    unique_rows: dict[str, dict[str, Any]] = {}
    for row in rows:
        accession = clean_text(row.get("accessionNumber"))
        key = accession or f"{row.get('form', '')}:{row.get('filingDate', '')}:{len(unique_rows)}"
        unique_rows.setdefault(key, row)
    return list(unique_rows.values())


def download_filing_sections(
    client: SecClient,
    filing: dict[str, Any],
    output_dir: Path,
    source_warnings: list[str],
) -> list[dict[str, str]]:
    """Download one filing where possible and return its extracted sections."""
    accession = clean_text(filing.get("accessionNumber"))
    filing_dir = output_dir / "ten_k_documents" / accession
    ensure_output_dir(filing_dir)

    index_url = clean_text(filing.get("filing_index_json_url"))
    if index_url:
        try:
            index_json = client.get_json_if_available(index_url)
            if index_json is not None:
                write_json(filing_dir / "filing_index.json", index_json)
        except (OSError, ValueError, requests.RequestException) as exc:
            source_warnings.append(f"Filing index failed ({accession}): {exc}")

    text = download_filing_text(client, filing, filing_dir, source_warnings)
    if not text:
        source_warnings.append(f"No readable filing document was available ({accession}).")
        return []
    return extract_10k_sections(text)


def download_filing_text(
    client: SecClient,
    filing: dict[str, Any],
    filing_dir: Path,
    source_warnings: list[str],
) -> str:
    """Download primary filing HTML, falling back to complete submission text."""
    accession = clean_text(filing.get("accessionNumber"))
    primary_document = clean_text(filing.get("primaryDocument"))
    primary_url = clean_text(filing.get("primary_document_url"))
    if primary_url and primary_document:
        try:
            markup = client.get_text(primary_url)
            (filing_dir / primary_document).write_text(markup, encoding="utf-8", errors="replace")
            text = html_to_text(markup)
            (filing_dir / "primary_document_text.txt").write_text(
                text, encoding="utf-8", errors="replace"
            )
            return text
        except (OSError, requests.RequestException) as exc:
            source_warnings.append(f"Primary filing document failed ({accession}): {exc}")

    submission_url = clean_text(filing.get("complete_submission_text_url"))
    if submission_url:
        try:
            submission_text = client.get_text(submission_url)
            (filing_dir / "complete_submission_text.txt").write_text(
                submission_text, encoding="utf-8", errors="replace"
            )
            return html_to_text(submission_text)
        except (OSError, requests.RequestException) as exc:
            source_warnings.append(f"Complete submission text failed ({accession}): {exc}")
    return ""


def extraction_status(
    companyfacts_available: bool, ten_k_count: int, source_warnings: list[str]
) -> str:
    """Classify a completed extraction according to the data sources available."""
    if not companyfacts_available and not ten_k_count:
        return "success_profile_only"
    if not companyfacts_available:
        return "success_no_xbrl"
    if source_warnings:
        return "partial_success"
    return "success"


def build_award_sec_summary_rows(
    annual_rows: list[dict[str, Any]], award_fact_path: Path
) -> list[dict[str, Any]]:
    """Join annual SEC financial rows to aggregated USAspending awards."""
    # The local names mirror output columns and aggregation stages.
    # pylint: disable=too-many-locals
    if not award_fact_path.exists() or not annual_rows:
        return []

    awards_df = read_table(award_fact_path)
    required = {
        "ultimate_parent_uei",
        "award_id",
        "recipient_uei",
        "award_amount",
        "awarding_agency",
    }
    missing = required.difference(awards_df.columns)
    if missing:
        raise ValueError(f"{award_fact_path} is missing columns: {sorted(missing)}")

    awards_df["award_amount_numeric"] = pd.to_numeric(
        awards_df["award_amount"], errors="coerce"
    ).fillna(0)
    grouped = (
        awards_df.groupby("ultimate_parent_uei", dropna=False)
        .agg(
            total_award_amount=("award_amount_numeric", "sum"),
            award_count=("award_id", "nunique"),
            recipient_count=("recipient_uei", "nunique"),
            awarding_agency_count=("awarding_agency", "nunique"),
        )
        .reset_index()
    )
    award_lookup = {
        clean_text(row["ultimate_parent_uei"]): row.to_dict()
        for _, row in grouped.iterrows()
        if clean_text(row["ultimate_parent_uei"])
    }

    summary_rows: list[dict[str, Any]] = []
    for annual in annual_rows:
        ultimate_parent_uei = clean_text(annual.get("ultimate_parent_uei"))
        award_summary = award_lookup.get(ultimate_parent_uei, {})
        total_award_amount = award_summary.get("total_award_amount", "")
        reported_revenue = to_float(annual.get("reported_revenue"))
        award_total_numeric = to_float(total_award_amount)
        award_to_revenue_ratio = ""
        if reported_revenue and award_total_numeric is not None:
            award_to_revenue_ratio = award_total_numeric / reported_revenue

        if not award_summary:
            coverage_flag = "no_usaspending_awards_for_parent"
        elif not clean_text(annual.get("reported_revenue")):
            coverage_flag = "missing_reported_revenue"
        else:
            coverage_flag = "complete"

        summary_rows.append(
            {
                "original_company_name": annual.get("original_company_name", ""),
                "ultimate_parent_name": annual.get("ultimate_parent_name", ""),
                "ultimate_parent_uei": ultimate_parent_uei,
                "sec_company_name": annual.get("sec_company_name", ""),
                "ticker": annual.get("ticker", ""),
                "cik": annual.get("cik", ""),
                "fiscal_year": annual.get("fiscal_year", ""),
                "total_award_amount": total_award_amount,
                "award_count": award_summary.get("award_count", ""),
                "recipient_count": award_summary.get("recipient_count", ""),
                "awarding_agency_count": award_summary.get("awarding_agency_count", ""),
                "reported_revenue": annual.get("reported_revenue", ""),
                "net_income_loss": annual.get("net_income_loss", ""),
                "assets": annual.get("assets", ""),
                "liabilities": annual.get("liabilities", ""),
                "award_to_revenue_ratio": award_to_revenue_ratio,
                "data_coverage_flag": coverage_flag,
            }
        )

    return summary_rows


def crosswalk_context(row: dict[str, Any]) -> dict[str, Any]:
    """Select reviewed crosswalk metadata propagated to output rows."""
    return {
        "original_company_name": clean_text(row.get("original_company_name")),
        "ultimate_parent_name": clean_text(row.get("ultimate_parent_name")),
        "ultimate_parent_uei": clean_text(row.get("ultimate_parent_uei")),
        "match_method": clean_text(row.get("match_method")),
        "match_confidence": clean_text(row.get("match_confidence")),
        "review_status": clean_text(row.get("review_status")),
        "review_notes": clean_text(row.get("review_notes")),
    }


def run_crosswalk_batch(client: SecClient, args: argparse.Namespace) -> None:
    """Extract SEC data for every approved row in a reviewed crosswalk."""
    # Batch accumulators are kept separate to make each output table explicit.
    # pylint: disable=too-many-locals
    crosswalk_path = Path(args.crosswalk)
    crosswalk_df = read_table(crosswalk_path)
    missing = set(CROSSWALK_FIELDNAMES).difference(crosswalk_df.columns)
    if missing:
        raise ValueError(f"{crosswalk_path} is missing columns: {sorted(missing)}")

    approved_status = clean_text(args.review_status).casefold()
    rows = [
        row.to_dict()
        for _, row in crosswalk_df.iterrows()
        if clean_text(row.get("review_status")).casefold() == approved_status
    ]

    base_output_dir = Path(args.output_dir)
    ensure_output_dir(base_output_dir)

    combined_extract_rows: list[dict[str, Any]] = []
    profile_rows: list[dict[str, Any]] = []
    annual_rows: list[dict[str, Any]] = []
    ten_k_section_rows: list[dict[str, Any]] = []
    summary_rows: list[dict[str, Any]] = []

    for row in rows:
        context = crosswalk_context(row)
        ticker = clean_text(row.get("ticker")).upper()
        cik = clean_text(row.get("cik"))
        label = ticker or normalize_cik(cik)

        try:
            company = resolve_company(client, ticker=ticker or None, cik=cik or None)
            company_output_dir = base_output_dir / (company.ticker or company.cik)
            result = extract_company(
                client,
                company,
                company_output_dir,
                include_all_10k=args.include_all_10k,
                save_raw_json=args.save_raw_json,
                save_full_extract=args.save_full_sec_extract,
                company_context=context,
            )
            combined_extract_rows.extend(result["extract_rows"])
            profile_rows.append(build_profile_readable_row(result["profile"], context))
            annual_rows.extend(
                build_annual_financial_rows(
                    result["xbrl_rows"], result["profile"], context, max_years=args.financial_years
                )
            )
            ten_k_section_rows.extend(
                build_10k_section_readable_rows(result["section_extract_rows"])
            )
            summary_rows.append(
                {
                    **context,
                    "ticker": company.ticker,
                    "cik": company.cik,
                    "sec_company_name": company.company_name,
                    "status": result["status"],
                    "output_dir": result["output_dir"],
                    "filing_count": result["recent_filing_count"],
                    "ten_k_count": result["ten_k_count"],
                    "xbrl_fact_count": result["xbrl_fact_count"],
                    "ten_k_section_count": result["ten_k_section_count"],
                    "source_warnings": " | ".join(result["source_warnings"]),
                    "error": "",
                }
            )
            company_label = company.ticker or company.cik
            fact_count = result["xbrl_fact_count"]
            print(f"Extracted {company_label}: {fact_count:,} XBRL facts")
        except (KeyError, OSError, ValueError, requests.RequestException) as exc:
            summary_rows.append(
                {
                    **context,
                    "ticker": ticker,
                    "cik": normalize_cik(cik) if cik else "",
                    "sec_company_name": clean_text(row.get("sec_company_name")),
                    "status": "failed",
                    "output_dir": "",
                    "filing_count": "",
                    "ten_k_count": "",
                    "xbrl_fact_count": "",
                    "ten_k_section_count": "",
                    "source_warnings": "",
                    "error": str(exc),
                }
            )
            print(f"Failed {label}: {exc}")

    if args.save_full_sec_extract:
        write_csv(
            base_output_dir / "sec_company_extract.csv", combined_extract_rows, EXTRACT_FIELDNAMES
        )
    write_csv(
        base_output_dir / "sec_company_profile_readable.csv", profile_rows, PROFILE_FIELDNAMES
    )
    write_csv(
        base_output_dir / "sec_company_financials_annual_readable.csv",
        annual_rows,
        ANNUAL_FINANCIAL_FIELDNAMES,
    )
    write_csv(
        base_output_dir / "sec_10k_sections_readable.csv",
        ten_k_section_rows,
        SEC_10K_SECTION_FIELDNAMES,
    )
    award_sec_summary_rows = build_award_sec_summary_rows(
        annual_rows, Path(args.award_fact_readable)
    )
    powerbi_output_dir = Path(args.powerbi_output_dir)
    ensure_output_dir(powerbi_output_dir)
    write_csv(
        powerbi_output_dir / "company_award_sec_summary_readable.csv",
        award_sec_summary_rows,
        AWARD_SEC_SUMMARY_FIELDNAMES,
    )
    write_csv(
        base_output_dir / "sec_extraction_batch_summary.csv",
        summary_rows,
        BATCH_SUMMARY_FIELDNAMES,
    )

    print(f"Approved crosswalk rows processed: {len(rows):,}")
    print(f"Combined SEC extract rows: {len(combined_extract_rows):,}")
    print(f"Annual financial rows: {len(annual_rows):,}")
    print(f"10-K readable section rows: {len(ten_k_section_rows):,}")
    print(f"Award/SEC summary rows: {len(award_sec_summary_rows):,}")
    print(f"Batch output directory: {base_output_dir}")
