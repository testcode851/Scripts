"""Command-line entry point for SEC extraction and USAspending crosswalk workflows."""

from __future__ import annotations

import argparse
import os
from pathlib import Path

from sec_extraction.crosswalk import build_crosswalk_candidates
from sec_extraction.pipeline import (
    build_annual_financial_rows,
    build_10k_section_readable_rows,
    build_profile_readable_row,
    extract_company,
    run_crosswalk_batch,
)
from sec_extraction.schemas import (
    ANNUAL_FINANCIAL_FIELDNAMES,
    APPROVED_REVIEW_STATUS,
    DEFAULT_FINANCIAL_YEARS,
    DEFAULT_OUTPUT_DIR,
    DEFAULT_USER_AGENT,
    PROFILE_FIELDNAMES,
    SEC_10K_SECTION_FIELDNAMES,
)
from sec_extraction.sec_client import SecClient, resolve_company, write_csv


def build_cli_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="SEC extraction and USAspending crosswalk helper",
        epilog=(
            "Common examples:\n"
            "  python sec_company_extraction.py --step all\n"
            "  python sec_company_extraction.py --step crosswalk\n"
            "  python sec_company_extraction.py --step extract\n"
            "  python sec_company_extraction.py --step single --ticker MMM\n"
            "  python sec_company_extraction.py --help"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--step",
        choices=["crosswalk", "extract", "single", "all"],
        help=(
            "Workflow step to run. Use 'all' for the normal one-command workflow: "
            "build crosswalk candidates, then extract approved SEC rows."
        ),
    )
    parser.add_argument(
        "--input",
        default="CompanyNames.xlsx",
        help="Path to company names Excel/CSV file for SEC crosswalk generation. Default: CompanyNames.xlsx.",
    )
    parser.add_argument("--ticker", help="Ticker symbol for --step single, such as MMM or AAPL.")
    parser.add_argument("--cik", help="SEC CIK for --step single, with or without leading zeros.")
    parser.add_argument(
        "--crosswalk",
        metavar="CROSSWALK_CSV",
        help="Reviewed crosswalk CSV for --step extract. Defaults to OUTPUT_DIR/company_sec_crosswalk_candidates.csv.",
    )
    parser.add_argument(
        "--entity-master",
        default="entity_master.csv",
        help="USAspending entity_master.csv used when building crosswalk candidates.",
    )
    parser.add_argument(
        "--crosswalk-output",
        default="company_sec_crosswalk_candidates.csv",
        help="Output path for generated crosswalk candidates.",
    )
    parser.add_argument(
        "--output-dir",
        default=str(DEFAULT_OUTPUT_DIR),
        help=f"Base output directory. Default: {DEFAULT_OUTPUT_DIR}",
    )
    parser.add_argument(
        "--user-agent",
        default=os.getenv("SEC_USER_AGENT", DEFAULT_USER_AGENT),
        help="SEC request User-Agent. Prefer setting SEC_USER_AGENT in the environment.",
    )
    parser.add_argument(
        "--include-all-10k",
        action="store_true",
        help="Download section previews and filing document indexes for every recent 10-K, not just the latest.",
    )
    parser.add_argument(
        "--save-raw-json",
        action="store_true",
        help="Save raw submissions and companyfacts JSON for deeper review.",
    )
    parser.add_argument(
        "--save-full-sec-extract",
        action="store_true",
        help="Also write the broad sec_company_extract.csv audit file. Default outputs are curated readable tables only.",
    )
    parser.add_argument(
        "--financial-years",
        type=int,
        default=DEFAULT_FINANCIAL_YEARS,
        help=f"Number of recent fiscal years to keep in readable financial tables. Default: {DEFAULT_FINANCIAL_YEARS}.",
    )
    parser.add_argument(
        "--review-status",
        default=APPROVED_REVIEW_STATUS,
        help="Crosswalk review_status value allowed for batch extraction. Default: approved.",
    )
    parser.add_argument(
        "--award-fact-readable",
        default=str(Path("output") / "powerbi_prototype" / "award_fact_readable.csv"),
        help="Readable USAspending award file used to create company_award_sec_summary_readable.csv.",
    )
    return parser


def run(args: argparse.Namespace) -> None:
    client = SecClient(args.user_agent)
    output_dir = Path(args.output_dir)
    default_crosswalk = output_dir / "company_sec_crosswalk_candidates.csv"

    step = args.step
    if step is None:
        step = "single" if args.ticker or args.cik else "all"

    if step == "crosswalk":
        rows = build_crosswalk_candidates(
            client,
            Path(args.input),
            Path(args.entity_master),
            default_crosswalk,
        )
        print(f"Crosswalk candidates written: {default_crosswalk}")
        print(f"Candidate rows: {len(rows):,}")
        print("Review the file, then run --step extract if you do not want to run --step all.")
        return

    if step == "extract":
        args.crosswalk = args.crosswalk or str(default_crosswalk)
        run_crosswalk_batch(client, args)
        return

    if step == "all":
        rows = build_crosswalk_candidates(
            client,
            Path(args.input),
            Path(args.entity_master),
            default_crosswalk,
        )
        print(f"Crosswalk candidates written: {default_crosswalk}")
        print(f"Candidate rows: {len(rows):,}")
        args.crosswalk = str(default_crosswalk)
        run_crosswalk_batch(client, args)
        return

    if step != "single":
        raise ValueError(f"Unsupported step: {step}")
    if not args.ticker and not args.cik:
        raise ValueError("Use --ticker or --cik with --step single.")

    company = resolve_company(client, ticker=args.ticker, cik=args.cik)
    output_dir = output_dir / (company.ticker or company.cik)
    result = extract_company(
        client,
        company,
        output_dir,
        include_all_10k=args.include_all_10k,
        save_raw_json=args.save_raw_json,
        save_full_extract=args.save_full_sec_extract,
    )
    annual_rows = build_annual_financial_rows(result["xbrl_rows"], result["profile"], max_years=args.financial_years)
    section_rows = build_10k_section_readable_rows(result["section_extract_rows"])
    write_csv(output_dir / "sec_company_profile_readable.csv", [build_profile_readable_row(result["profile"])], PROFILE_FIELDNAMES)
    write_csv(output_dir / "sec_company_financials_annual_readable.csv", annual_rows, ANNUAL_FINANCIAL_FIELDNAMES)
    write_csv(output_dir / "sec_10k_sections_readable.csv", section_rows, SEC_10K_SECTION_FIELDNAMES)

    print(f"Company: {company.company_name} ({company.ticker or 'no ticker'}, CIK {company.cik})")
    print(f"Output directory: {output_dir}")
    print(f"Recent filings: {result['recent_filing_count']:,}")
    print(f"10-K filings indexed: {result['ten_k_count']:,}")
    print(f"XBRL facts exported: {result['xbrl_fact_count']:,}")
    print(f"10-K section previews exported: {result['ten_k_section_count']:,}")
    if args.save_full_sec_extract:
        print(f"Full SEC extract rows exported: {len(result['extract_rows']):,}")
    print(f"Annual financial rows exported: {len(annual_rows):,}")
    print(f"10-K readable section rows exported: {len(section_rows):,}")


def main() -> None:
    parser = build_cli_parser()
    run(parser.parse_args())


if __name__ == "__main__":
    main()
