from __future__ import annotations

from pathlib import Path
from typing import Any

import pandas as pd

from .schemas import (
    ANNUAL_FINANCIAL_FIELDNAMES,
    AWARD_SEC_SUMMARY_FIELDNAMES,
    BASE_DATA_URL,
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
    crosswalk_context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    ensure_output_dir(output_dir)

    submissions = client.get_json(f"{BASE_DATA_URL}/submissions/CIK{company.cik}.json")
    companyfacts = client.get_json(f"{BASE_DATA_URL}/api/xbrl/companyfacts/CIK{company.cik}.json")

    if save_raw_json:
        write_json(output_dir / "raw_submissions.json", submissions)
        write_json(output_dir / "raw_companyfacts.json", companyfacts)

    extract_rows: list[dict[str, Any]] = []

    profile = extract_company_profile(submissions, company)
    extract_rows.extend(profile_to_extract_rows(profile))

    filing_rows = flatten_recent_filings(submissions, company)

    xbrl_rows = flatten_xbrl_facts(companyfacts, company)
    extract_rows.extend(xbrl_to_extract_rows(xbrl_rows))

    ten_k_rows = add_10k_urls(ten_k_filings(filing_rows))

    filings_to_download = ten_k_rows if include_all_10k else ten_k_rows[:1]
    section_rows: list[dict[str, str]] = []
    section_extract_rows: list[dict[str, Any]] = []

    for filing in filings_to_download:
        accession = filing.get("accessionNumber", "")
        primary_document = filing.get("primaryDocument", "")
        if not accession or not primary_document:
            continue

        filing_dir = output_dir / "ten_k_documents" / accession
        ensure_output_dir(filing_dir)

        index_url = filing.get("filing_index_json_url", "")
        if index_url:
            index_json = client.get_json(index_url)
            write_json(filing_dir / "filing_index.json", index_json)

        primary_url = filing.get("primary_document_url", "")
        if primary_url:
            markup = client.get_text(primary_url)
            (filing_dir / primary_document).write_text(markup, encoding="utf-8", errors="replace")
            text = html_to_text(markup)
            (filing_dir / "primary_document_text.txt").write_text(text, encoding="utf-8", errors="replace")

            sections = extract_10k_sections(text)
            section_rows.extend(sections)
            current_section_rows = section_to_extract_rows(sections, company, filing)
            section_extract_rows.extend(current_section_rows)
            extract_rows.extend(current_section_rows)

    add_crosswalk_context(extract_rows, crosswalk_context)
    add_crosswalk_context(section_extract_rows, crosswalk_context)
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
        "output_dir": str(output_dir),
    }

def build_award_sec_summary_rows(annual_rows: list[dict[str, Any]], award_fact_path: Path) -> list[dict[str, Any]]:
    if not award_fact_path.exists() or not annual_rows:
        return []

    awards_df = read_table(award_fact_path)
    required = {"ultimate_parent_uei", "award_id", "recipient_uei", "award_amount", "awarding_agency"}
    missing = required.difference(awards_df.columns)
    if missing:
        raise ValueError(f"{award_fact_path} is missing columns: {sorted(missing)}")

    awards_df["award_amount_numeric"] = pd.to_numeric(awards_df["award_amount"], errors="coerce").fillna(0)
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
                crosswalk_context=context,
            )
            combined_extract_rows.extend(result["extract_rows"])
            profile_rows.append(build_profile_readable_row(result["profile"], context))
            annual_rows.extend(
                build_annual_financial_rows(
                    result["xbrl_rows"], result["profile"], context, max_years=args.financial_years
                )
            )
            ten_k_section_rows.extend(build_10k_section_readable_rows(result["section_extract_rows"]))
            summary_rows.append(
                {
                    **context,
                    "ticker": company.ticker,
                    "cik": company.cik,
                    "sec_company_name": company.company_name,
                    "status": "success",
                    "output_dir": result["output_dir"],
                    "xbrl_fact_count": result["xbrl_fact_count"],
                    "ten_k_section_count": result["ten_k_section_count"],
                    "error": "",
                }
            )
            print(f"Extracted {company.ticker or company.cik}: {result['xbrl_fact_count']:,} XBRL facts")
        except Exception as exc:
            summary_rows.append(
                {
                    **context,
                    "ticker": ticker,
                    "cik": normalize_cik(cik) if cik else "",
                    "sec_company_name": clean_text(row.get("sec_company_name")),
                    "status": "failed",
                    "output_dir": "",
                    "xbrl_fact_count": "",
                    "ten_k_section_count": "",
                    "error": str(exc),
                }
            )
            print(f"Failed {label}: {exc}")

    if args.save_full_sec_extract:
        write_csv(base_output_dir / "sec_company_extract.csv", combined_extract_rows, EXTRACT_FIELDNAMES)
    write_csv(base_output_dir / "sec_company_profile_readable.csv", profile_rows, PROFILE_FIELDNAMES)
    write_csv(base_output_dir / "sec_company_financials_annual_readable.csv", annual_rows, ANNUAL_FINANCIAL_FIELDNAMES)
    write_csv(base_output_dir / "sec_10k_sections_readable.csv", ten_k_section_rows, SEC_10K_SECTION_FIELDNAMES)
    award_sec_summary_rows = build_award_sec_summary_rows(annual_rows, Path(args.award_fact_readable))
    write_csv(
        base_output_dir / "company_award_sec_summary_readable.csv",
        award_sec_summary_rows,
        AWARD_SEC_SUMMARY_FIELDNAMES,
    )
    write_csv(
        base_output_dir / "sec_extraction_batch_summary.csv",
        summary_rows,
        [
            "original_company_name",
            "ultimate_parent_name",
            "ultimate_parent_uei",
            "ticker",
            "cik",
            "sec_company_name",
            "status",
            "output_dir",
            "xbrl_fact_count",
            "ten_k_section_count",
            "error",
        ],
    )

    print(f"Approved crosswalk rows processed: {len(rows):,}")
    print(f"Combined SEC extract rows: {len(combined_extract_rows):,}")
    print(f"Annual financial rows: {len(annual_rows):,}")
    print(f"10-K readable section rows: {len(ten_k_section_rows):,}")
    print(f"Award/SEC summary rows: {len(award_sec_summary_rows):,}")
    print(f"Batch output directory: {base_output_dir}")
