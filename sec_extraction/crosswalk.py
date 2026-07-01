"""Build reviewed mappings between USAspending entities and SEC registrants."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .schemas import CROSSWALK_FIELDNAMES
from .sec_client import (
    SecClient,
    clean_text,
    ensure_output_dir,
    load_sec_ticker_map,
    name_similarity,
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


def best_sec_match(target_name: str, sec_rows: list[dict[str, str]]) -> dict[str, Any]:
    """Return the highest-scoring SEC name candidate for an input name."""
    target_name = clean_text(target_name)
    best: dict[str, Any] = {
        "sec_company_name": "",
        "ticker": "",
        "cik": "",
        "match_method": "no_candidate",
        "match_confidence": 0.0,
    }
    if not target_name:
        return best

    for sec_row in sec_rows:
        score = name_similarity(target_name, sec_row["sec_company_name"])
        if score > float(best["match_confidence"]):
            method = "fuzzy_name"
            if normalize_name(target_name) == normalize_name(sec_row["sec_company_name"]):
                method = "exact_normalized_name"
            elif normalize_name(target_name) in normalize_name(
                sec_row["sec_company_name"]
            ) or normalize_name(sec_row["sec_company_name"]) in normalize_name(target_name):
                method = "contains_normalized_name"

            best = {
                "sec_company_name": sec_row["sec_company_name"],
                "ticker": sec_row["ticker"],
                "cik": sec_row["cik"],
                "match_method": method,
                "match_confidence": score,
            }

    return best


def build_crosswalk_candidates(
    client: SecClient, company_input: Path, entity_master_path: Path, output_path: Path
) -> list[dict[str, Any]]:
    """Build and write SEC crosswalk candidates for input companies."""
    parents = resolve_usaspending_parents(company_input, entity_master_path)
    sec_rows = load_sec_ticker_map(client)
    output_rows: list[dict[str, Any]] = []

    for parent in parents:
        sec_match_name = parent.get("original_company_name", "")
        match = best_sec_match(sec_match_name, sec_rows)
        confidence = float(match["match_confidence"])
        if confidence >= 98:
            review_status = "approved"
            notes = "High-confidence normalized name match; review before production use."
        elif confidence >= 85:
            review_status = "needs_review"
            notes = "Likely match, but confirm public parent and ticker/CIK."
        else:
            review_status = "needs_review"
            notes = "Low-confidence or missing SEC match; manually verify."

        output_rows.append(
            {
                "original_company_name": parent.get("original_company_name", ""),
                "ultimate_parent_name": parent.get("ultimate_parent_name", ""),
                "ultimate_parent_uei": parent.get("ultimate_parent_uei", ""),
                "sec_match_name": sec_match_name,
                "sec_match_scope": "company_names_input",
                "sec_company_name": match["sec_company_name"],
                "ticker": match["ticker"],
                "cik": match["cik"],
                "match_method": match["match_method"],
                "match_confidence": match["match_confidence"],
                "review_status": review_status,
                "review_notes": notes,
            }
        )

    ensure_output_dir(output_path.parent)
    write_csv(output_path, output_rows, CROSSWALK_FIELDNAMES)
    return output_rows
