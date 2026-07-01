"""Transform SEC submissions and XBRL facts into readable output rows."""

from __future__ import annotations

from typing import Any

from .schemas import (
    ANNUAL_FINANCIAL_FIELDNAMES,
    DEFAULT_FINANCIAL_YEARS,
    HIGH_VALUE_10K_ITEMS,
    SEC_FINANCIAL_TAG_MAP,
)
from .sec_client import CompanyIdentifier, clean_text


def extract_company_profile(
    submissions: dict[str, Any], company: CompanyIdentifier
) -> dict[str, Any]:
    """Build a normalized company profile from SEC submissions data."""
    addresses = submissions.get("addresses") or {}
    business_address = addresses.get("business") or {}
    mailing_address = addresses.get("mailing") or {}

    return {
        "ticker": company.ticker,
        "cik": company.cik,
        "company_name": submissions.get("name") or company.company_name,
        "entity_type": submissions.get("entityType", ""),
        "sic": submissions.get("sic", ""),
        "sic_description": submissions.get("sicDescription", ""),
        "owner_org": submissions.get("ownerOrg", ""),
        "insider_transaction_for_owner_exists": submissions.get(
            "insiderTransactionForOwnerExists", ""
        ),
        "insider_transaction_for_issuer_exists": submissions.get(
            "insiderTransactionForIssuerExists", ""
        ),
        "ein": submissions.get("ein", ""),
        "description": submissions.get("description", ""),
        "website": submissions.get("website", ""),
        "investor_website": submissions.get("investorWebsite", ""),
        "category": submissions.get("category", ""),
        "fiscal_year_end": submissions.get("fiscalYearEnd", ""),
        "state_of_incorporation": submissions.get("stateOfIncorporation", ""),
        "state_of_incorporation_description": submissions.get(
            "stateOfIncorporationDescription", ""
        ),
        "phone": submissions.get("phone", ""),
        "flags": submissions.get("flags", ""),
        "tickers": "|".join(submissions.get("tickers") or []),
        "exchanges": "|".join(submissions.get("exchanges") or []),
        "business_street1": business_address.get("street1", ""),
        "business_street2": business_address.get("street2", ""),
        "business_city": business_address.get("city", ""),
        "business_state_or_country": business_address.get("stateOrCountry", ""),
        "business_zip_code": business_address.get("zipCode", ""),
        "mailing_street1": mailing_address.get("street1", ""),
        "mailing_street2": mailing_address.get("street2", ""),
        "mailing_city": mailing_address.get("city", ""),
        "mailing_state_or_country": mailing_address.get("stateOrCountry", ""),
        "mailing_zip_code": mailing_address.get("zipCode", ""),
    }


def flatten_recent_filings(
    submissions: dict[str, Any], company: CompanyIdentifier
) -> list[dict[str, Any]]:
    """Flatten parallel recent-filing arrays into row dictionaries."""
    recent = submissions.get("filings", {}).get("recent", {})
    if not recent:
        return []

    columns = list(recent.keys())
    row_count = max((len(value) for value in recent.values() if isinstance(value, list)), default=0)
    rows: list[dict[str, Any]] = []

    for index in range(row_count):
        row = {"ticker": company.ticker, "cik": company.cik}
        for column in columns:
            values = recent.get(column)
            row[column] = values[index] if isinstance(values, list) and index < len(values) else ""
        rows.append(row)

    return rows


def flatten_xbrl_facts(
    companyfacts: dict[str, Any], company: CompanyIdentifier
) -> list[dict[str, Any]]:
    """Flatten SEC company facts into individual XBRL observations."""
    rows: list[dict[str, Any]] = []
    facts = companyfacts.get("facts", {})

    for taxonomy, concepts in facts.items():
        if not isinstance(concepts, dict):
            continue

        for tag, concept in concepts.items():
            if not isinstance(concept, dict):
                continue

            label = concept.get("label", "")
            description = concept.get("description", "")
            units = concept.get("units", {})
            if not isinstance(units, dict):
                continue

            for unit, facts_for_unit in units.items():
                if not isinstance(facts_for_unit, list):
                    continue

                for fact in facts_for_unit:
                    if not isinstance(fact, dict):
                        continue

                    rows.append(
                        {
                            "ticker": company.ticker,
                            "cik": company.cik,
                            "entity_name": companyfacts.get("entityName", company.company_name),
                            "taxonomy": taxonomy,
                            "tag": tag,
                            "label": label,
                            "description": description,
                            "unit": unit,
                            "value": fact.get("val", ""),
                            "start": fact.get("start", ""),
                            "end": fact.get("end", ""),
                            "fy": fact.get("fy", ""),
                            "fp": fact.get("fp", ""),
                            "form": fact.get("form", ""),
                            "filed": fact.get("filed", ""),
                            "accn": fact.get("accn", ""),
                            "frame": fact.get("frame", ""),
                        }
                    )

    return rows


def profile_to_extract_rows(profile: dict[str, Any]) -> list[dict[str, Any]]:
    """Convert profile fields into broad audit-extract rows."""
    rows: list[dict[str, Any]] = []
    for field_name, field_value in profile.items():
        if field_name in {"ticker", "cik", "company_name"}:
            continue
        rows.append(
            {
                "record_type": "company_profile",
                "ticker": profile.get("ticker", ""),
                "cik": profile.get("cik", ""),
                "company_name": profile.get("company_name", ""),
                "source_form": "",
                "source_url": "",
                "field_name": field_name,
                "field_value": field_value,
                "taxonomy": "",
                "tag": "",
                "label": "",
                "description": "",
                "unit": "",
                "value": "",
                "period_start": "",
                "period_end": "",
                "fiscal_year": "",
                "fiscal_period": "",
                "xbrl_frame": "",
                "accession_number": "",
                "text_preview": "",
            }
        )
    return rows


def xbrl_to_extract_rows(xbrl_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Convert flattened XBRL facts into broad audit-extract rows."""
    rows: list[dict[str, Any]] = []
    for row in xbrl_rows:
        rows.append(
            {
                "record_type": "xbrl_fact",
                "ticker": row.get("ticker", ""),
                "cik": row.get("cik", ""),
                "company_name": row.get("entity_name", ""),
                "source_form": row.get("form", ""),
                "source_url": "",
                "field_name": "",
                "field_value": "",
                "taxonomy": row.get("taxonomy", ""),
                "tag": row.get("tag", ""),
                "label": row.get("label", ""),
                "description": row.get("description", ""),
                "unit": row.get("unit", ""),
                "value": row.get("value", ""),
                "period_start": row.get("start", ""),
                "period_end": row.get("end", ""),
                "fiscal_year": row.get("fy", ""),
                "fiscal_period": row.get("fp", ""),
                "xbrl_frame": row.get("frame", ""),
                "accession_number": row.get("accn", ""),
                "text_preview": "",
            }
        )
    return rows


def section_to_extract_rows(
    sections: list[dict[str, str]], company: CompanyIdentifier, filing: dict[str, Any]
) -> list[dict[str, Any]]:
    """Convert 10-K sections into broad audit-extract rows."""
    rows: list[dict[str, Any]] = []
    for section in sections:
        rows.append(
            {
                "record_type": "ten_k_section",
                "ticker": company.ticker,
                "cik": company.cik,
                "company_name": company.company_name,
                "source_form": filing.get("form", "10-K"),
                "source_url": filing.get("primary_document_url", ""),
                "field_name": section.get("item", ""),
                "field_value": section.get("heading", ""),
                "taxonomy": "",
                "tag": "",
                "label": section.get("heading", ""),
                "description": "",
                "unit": "",
                "value": section.get("text_length", ""),
                "period_start": "",
                "period_end": "",
                "fiscal_year": "",
                "fiscal_period": "",
                "xbrl_frame": "",
                "accession_number": filing.get("accessionNumber", ""),
                "text_preview": section.get("text_preview", ""),
            }
        )
    return rows


def add_crosswalk_context(
    rows: list[dict[str, Any]], context: dict[str, Any] | None
) -> list[dict[str, Any]]:
    """Add reviewed crosswalk fields to rows in place."""
    context = context or {}
    for row in rows:
        row["original_company_name"] = context.get(
            "original_company_name", row.get("original_company_name", "")
        )
        row["ultimate_parent_name"] = context.get(
            "ultimate_parent_name", row.get("ultimate_parent_name", "")
        )
        row["ultimate_parent_uei"] = context.get(
            "ultimate_parent_uei", row.get("ultimate_parent_uei", "")
        )
    return rows


def build_profile_readable_row(
    profile: dict[str, Any], context: dict[str, Any] | None = None
) -> dict[str, Any]:
    """Build one curated company-profile output row."""
    context = context or {}
    return {
        "original_company_name": context.get("original_company_name", ""),
        "ultimate_parent_name": context.get("ultimate_parent_name", ""),
        "ultimate_parent_uei": context.get("ultimate_parent_uei", ""),
        "sec_company_name": profile.get("company_name", ""),
        "ticker": profile.get("ticker", ""),
        "cik": profile.get("cik", ""),
        "entity_type": profile.get("entity_type", ""),
        "sic": profile.get("sic", ""),
        "sic_description": profile.get("sic_description", ""),
        "fiscal_year_end": profile.get("fiscal_year_end", ""),
        "state_of_incorporation": profile.get("state_of_incorporation", ""),
        "state_of_incorporation_description": profile.get("state_of_incorporation_description", ""),
        "business_city": profile.get("business_city", ""),
        "business_state_or_country": profile.get("business_state_or_country", ""),
        "business_zip_code": profile.get("business_zip_code", ""),
        "mailing_city": profile.get("mailing_city", ""),
        "mailing_state_or_country": profile.get("mailing_state_or_country", ""),
        "phone": profile.get("phone", ""),
        "website": profile.get("website", ""),
        "investor_website": profile.get("investor_website", ""),
        "match_method": context.get("match_method", ""),
        "match_confidence": context.get("match_confidence", ""),
        "review_status": context.get("review_status", ""),
        "review_notes": context.get("review_notes", ""),
    }


def to_float(value: Any) -> float | None:
    """Convert a value to float, returning None on failure."""
    try:
        if value == "":
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def build_annual_financial_rows(
    xbrl_rows: list[dict[str, Any]],
    profile: dict[str, Any],
    context: dict[str, Any] | None = None,
    max_years: int = DEFAULT_FINANCIAL_YEARS,
) -> list[dict[str, Any]]:
    """Select and pivot recent annual XBRL facts into readable rows."""
    # Branches and locals represent distinct SEC fact-selection rules and output metrics.
    # pylint: disable=too-many-branches,too-many-locals
    context = context or {}
    annual_forms = {"10-K", "20-F", "40-F"}
    grouped: dict[tuple[str, str], list[dict[str, Any]]] = {}

    for row in xbrl_rows:
        tag = clean_text(row.get("tag"))
        output_field = SEC_FINANCIAL_TAG_MAP.get(tag)
        if not output_field:
            continue
        if clean_text(row.get("form")) not in annual_forms:
            continue
        fiscal_year = clean_text(row.get("fy"))
        if not fiscal_year:
            continue
        grouped.setdefault((fiscal_year, output_field), []).append(row)

    by_year: dict[str, dict[str, Any]] = {}
    source_tags: dict[str, set[str]] = {}
    notes: dict[str, set[str]] = {}

    for (fiscal_year, output_field), rows in grouped.items():
        sorted_rows = sorted(rows, key=lambda item: clean_text(item.get("filed")))
        year_row = by_year.setdefault(
            fiscal_year,
            {
                "original_company_name": context.get("original_company_name", ""),
                "ultimate_parent_name": context.get("ultimate_parent_name", ""),
                "ultimate_parent_uei": context.get("ultimate_parent_uei", ""),
                "sec_company_name": profile.get("company_name", ""),
                "ticker": profile.get("ticker", ""),
                "cik": profile.get("cik", ""),
                "fiscal_year": fiscal_year,
            },
        )
        source_tags.setdefault(fiscal_year, set())
        notes.setdefault(fiscal_year, set())

        if output_field == "total_debt":
            total = 0.0
            found_numeric = False
            for item in sorted_rows[-4:]:
                numeric = to_float(item.get("value"))
                if numeric is not None:
                    total += numeric
                    found_numeric = True
                    source_tags[fiscal_year].add(clean_text(item.get("tag")))
            if found_numeric:
                year_row[output_field] = total
                notes[fiscal_year].add("total_debt may combine current and noncurrent debt tags")
            continue

        latest = sorted_rows[-1]
        year_row[output_field] = latest.get("value", "")
        source_tags[fiscal_year].add(clean_text(latest.get("tag")))
        if len(rows) > 1:
            notes[fiscal_year].add(f"latest filed value selected for {output_field}")

    for fiscal_year, year_row in by_year.items():
        revenue_values = [
            year_row.get("revenues", ""),
            year_row.get("revenue_from_contract", ""),
            year_row.get("sales_revenue_net", ""),
        ]
        year_row["reported_revenue"] = next(
            (value for value in revenue_values if clean_text(value)), ""
        )
        year_row["reported_source_tags"] = "|".join(
            sorted(tag for tag in source_tags.get(fiscal_year, set()) if tag)
        )
        year_row["data_quality_notes"] = "; ".join(sorted(notes.get(fiscal_year, set())))
        for fieldname in ANNUAL_FINANCIAL_FIELDNAMES:
            year_row.setdefault(fieldname, "")

    years = sorted(by_year.keys())
    if max_years > 0:
        years = years[-max_years:]
    return [by_year[key] for key in years]


def build_10k_section_readable_rows(section_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Select curated fields for readable 10-K section output."""
    readable_rows: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str]] = set()
    for row in section_rows:
        item = row.get("field_name", "")
        if item not in HIGH_VALUE_10K_ITEMS:
            continue
        key = (row.get("cik", ""), row.get("accession_number", ""), item)
        if key in seen:
            continue
        seen.add(key)
        readable_rows.append(
            {
                "original_company_name": row.get("original_company_name", ""),
                "ultimate_parent_name": row.get("ultimate_parent_name", ""),
                "ultimate_parent_uei": row.get("ultimate_parent_uei", ""),
                "sec_company_name": row.get("company_name", ""),
                "ticker": row.get("ticker", ""),
                "cik": row.get("cik", ""),
                "source_form": row.get("source_form", ""),
                "accession_number": row.get("accession_number", ""),
                "item": item,
                "heading": row.get("field_value", ""),
                "text_length": row.get("value", ""),
                "text_preview": row.get("text_preview", ""),
                "source_url": row.get("source_url", ""),
            }
        )
    return readable_rows
