"""Build reviewed mappings between USAspending entities and SEC registrants."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .schemas import CROSSWALK_FIELDNAMES
from .sec_client import (
    SecClient,
    clean_text,
    ensure_output_dir,
    load_sec_registrant_map,
    normalize_name,
    read_table,
    write_csv,
)


def resolve_usaspending_parents(
    company_input: Path, entity_master_path: Path
) -> list[dict[str, str]]:
    """Resolve input companies to parent names and UEIs from the entity master."""
    company_df = read_table(company_input)
    if "Company" not in company_df.columns:
        raise ValueError(f"{company_input} must include a Company column.")

    input_names = [
        clean_text(value) for value in company_df["Company"].tolist() if clean_text(value)
    ]
    if not entity_master_path.exists():
        return [
            {
                "original_company_name": name,
                "ultimate_parent_name": "",
                "ultimate_parent_uei": "",
            }
            for name in input_names
        ]

    entity_df = read_table(entity_master_path)
    required = {"original_company_name", "ultimate_parent_name", "ultimate_parent_uei"}
    missing = required.difference(entity_df.columns)
    if missing:
        raise ValueError(f"{entity_master_path} is missing columns: {sorted(missing)}")

    parents: list[dict[str, str]] = []
    seen: set[tuple[str, str, str]] = set()
    for name in input_names:
        matches = entity_df[
            entity_df["original_company_name"].astype(str).str.strip().str.casefold()
            == name.casefold()
        ]
        if matches.empty:
            row = {
                "original_company_name": name,
                "ultimate_parent_name": "",
                "ultimate_parent_uei": "",
            }
            key = (
                row["original_company_name"],
                row["ultimate_parent_name"],
                row["ultimate_parent_uei"],
            )
            if key not in seen:
                parents.append(row)
                seen.add(key)
            continue

        for _, match in (
            matches[["original_company_name", "ultimate_parent_name", "ultimate_parent_uei"]]
            .drop_duplicates()
            .iterrows()
        ):
            row = {
                "original_company_name": clean_text(match.get("original_company_name")),
                "ultimate_parent_name": clean_text(match.get("ultimate_parent_name")),
                "ultimate_parent_uei": clean_text(match.get("ultimate_parent_uei")),
            }
            key = (
                row["original_company_name"],
                row["ultimate_parent_name"],
                row["ultimate_parent_uei"],
            )
            if key not in seen:
                parents.append(row)
                seen.add(key)

    return parents


def exact_sec_match(target_name: str, sec_rows: list[dict[str, str]]) -> dict[str, Any]:
    """Return a unique normalized-name SEC match without fuzzy fallback."""
    target_name = clean_text(target_name)
    no_match: dict[str, Any] = {
        "sec_company_name": "",
        "ticker": "",
        "cik": "",
        "sec_record_found": "no",
        "sec_record_status": "not_found",
        "sec_match_source": "",
        "match_method": "no_exact_sec_match",
        "match_confidence": 0.0,
    }
    if not target_name:
        no_match["match_method"] = "missing_ultimate_parent_name"
        return no_match

    normalized_target = normalize_name(target_name)
    candidates = [
        row for row in sec_rows if normalize_name(row.get("sec_company_name")) == normalized_target
    ]
    candidates_by_cik = {clean_text(row.get("cik")): row for row in candidates}
    if not candidates_by_cik:
        return no_match
    if len(candidates_by_cik) > 1:
        no_match["match_method"] = "ambiguous_exact_sec_match"
        return no_match

    match = next(iter(candidates_by_cik.values()))
    record_status = clean_text(match.get("sec_record_status"))
    match_methods = {
        "current": "exact_current_sec_name",
        "historical": "exact_historical_sec_name",
        "former_name": "exact_sec_former_name",
    }
    return {
        "sec_company_name": clean_text(match.get("sec_company_name")),
        "ticker": clean_text(match.get("ticker")),
        "cik": clean_text(match.get("cik")),
        "sec_record_found": "yes",
        "sec_record_status": record_status,
        "sec_match_source": clean_text(match.get("sec_match_source")),
        "match_method": match_methods.get(record_status, "exact_sec_name"),
        "match_confidence": 100.0,
    }


def build_crosswalk_candidates(
    client: SecClient, company_input: Path, entity_master_path: Path, output_path: Path
) -> list[dict[str, Any]]:
    """Build and write SEC crosswalk candidates for input companies."""
    parents = resolve_usaspending_parents(company_input, entity_master_path)
    cache_path = output_path.parent / ".sec_cache" / "cik-lookup-data.txt"
    sec_rows = load_sec_registrant_map(client, cache_path)
    output_rows: list[dict[str, Any]] = []

    for parent in parents:
        ultimate_parent_uei = clean_text(parent.get("ultimate_parent_uei"))
        sec_match_name = clean_text(parent.get("ultimate_parent_name"))
        if not ultimate_parent_uei:
            match = exact_sec_match("", sec_rows)
            match["match_method"] = "missing_ultimate_parent_uei"
        else:
            match = exact_sec_match(sec_match_name, sec_rows)

        if match["sec_record_found"] == "yes":
            review_status = "approved"
            notes = "Unique exact SEC record for the USAspending ultimate parent."
        else:
            review_status = "no_match"
            notes = "No unique exact SEC match for the USAspending ultimate parent."

        output_rows.append(
            {
                "original_company_name": parent.get("original_company_name", ""),
                "ultimate_parent_name": parent.get("ultimate_parent_name", ""),
                "ultimate_parent_uei": ultimate_parent_uei,
                "sec_match_name": sec_match_name,
                "sec_match_scope": "usaspending_ultimate_parent",
                "sec_company_name": match["sec_company_name"],
                "ticker": match["ticker"],
                "cik": match["cik"],
                "sec_record_found": match["sec_record_found"],
                "sec_record_status": match["sec_record_status"],
                "sec_match_source": match["sec_match_source"],
                "match_method": match["match_method"],
                "match_confidence": match["match_confidence"],
                "review_status": review_status,
                "review_notes": notes,
            }
        )

    ensure_output_dir(output_path.parent)
    write_csv(output_path, output_rows, CROSSWALK_FIELDNAMES)
    return output_rows
