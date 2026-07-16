"""Create one combined company profile per ultimate-parent UEI."""

from datetime import datetime
from pathlib import Path

import pandas as pd

from .schema import (
    AWARD_FACT_PATH,
    AWARD_FIELDS,
    ENTITY_MASTER_PATH,
    FINANCIAL_MAP,
    PROFILE_COLUMNS,
    PROFILE_OUTPUT_PATH,
    SEC_FINANCIALS_PATH,
    SEC_IDENTITY_MAP,
    SEC_MATCH_MAP,
    SEC_PROFILE_PATH,
)


def _read(path: Path, required: list[str]) -> pd.DataFrame:
    if not path.is_file():
        raise FileNotFoundError(f"Missing {path}. Run its extraction script first.")
    try:
        data = pd.read_csv(path, dtype=str, keep_default_na=False)
    except pd.errors.EmptyDataError as exc:
        raise ValueError(f"Input file is empty: {path}") from exc
    missing = sorted(set(required) - set(data.columns))
    if missing:
        raise ValueError(f"{path} is missing columns: {missing}")
    return data


def _identifier(series: pd.Series) -> pd.Series:
    return series.astype(str).str.strip().str.upper()


def _parents() -> pd.DataFrame:
    required = [
        "uei",
        "entity_name",
        "duns",
        "original_company_name",
        "ultimate_parent_uei",
        "ultimate_parent_name",
    ]
    data = _read(ENTITY_MASTER_PATH, required)
    data["uei"] = _identifier(data["uei"])
    data["ultimate_parent_uei"] = _identifier(data["ultimate_parent_uei"])
    data = data[data["ultimate_parent_uei"] != ""].copy()
    data["_is_parent"] = data["uei"] == data["ultimate_parent_uei"]
    data = data.sort_values(
        ["ultimate_parent_uei", "_is_parent"], ascending=[True, False]
    ).drop_duplicates("ultimate_parent_uei")
    data["ultimate_parent_name"] = data["ultimate_parent_name"].where(
        data["ultimate_parent_name"].str.strip() != "", data["entity_name"]
    )
    return data[
        ["ultimate_parent_uei", "ultimate_parent_name", "original_company_name", "duns"]
    ].rename(
        columns={
            "ultimate_parent_uei": "UltimateParentUEI",
            "ultimate_parent_name": "UltimateParentName",
            "original_company_name": "OriginalCompanyName",
            "duns": "DUNS",
        }
    )


def _awards() -> pd.DataFrame:
    required = [
        "award_id",
        "recipient_uei",
        "ultimate_parent_uei",
        "award_amount",
        "awarding_agency",
        "start_date",
        "end_date",
    ]
    data = _read(AWARD_FACT_PATH, required)
    data["ultimate_parent_uei"] = _identifier(data["ultimate_parent_uei"])
    for column in ("award_id", "recipient_uei", "awarding_agency"):
        data[column] = data[column].str.strip().replace("", pd.NA)
    data["award_amount"] = pd.to_numeric(data["award_amount"], errors="coerce")
    data["start_date"] = pd.to_datetime(data["start_date"], errors="coerce")
    data["end_date"] = pd.to_datetime(data["end_date"], errors="coerce")
    with_ids = data[data["award_id"].notna()].drop_duplicates("award_id", keep="last")
    data = pd.concat([with_ids, data[data["award_id"].isna()]])
    return (
        data[data["ultimate_parent_uei"] != ""]
        .groupby("ultimate_parent_uei", as_index=False)
        .agg(
            TotalAwardAmount=("award_amount", "sum"),
            AwardCount=("award_id", "nunique"),
            RecipientCount=("recipient_uei", "nunique"),
            AwardingAgencyCount=("awarding_agency", "nunique"),
            AwardPeriodStart=("start_date", "min"),
            AwardPeriodEnd=("end_date", "max"),
        )
        .rename(columns={"ultimate_parent_uei": "UltimateParentUEI"})
    )


def _sec_profiles() -> pd.DataFrame:
    rename = {
        "ultimate_parent_uei": "UltimateParentUEI",
        **SEC_IDENTITY_MAP,
        **SEC_MATCH_MAP,
    }
    data = _read(SEC_PROFILE_PATH, list(rename))
    data["ultimate_parent_uei"] = _identifier(data["ultimate_parent_uei"])
    data["match_confidence"] = pd.to_numeric(data["match_confidence"], errors="coerce")
    data = data[data["review_status"].str.strip().str.casefold() == "approved"]
    data = data.sort_values("match_confidence", ascending=False).drop_duplicates(
        "ultimate_parent_uei"
    )
    data = data.rename(columns=rename)
    return data[list(rename.values())]


def _latest_financials() -> pd.DataFrame:
    rename = {
        "ultimate_parent_uei": "UltimateParentUEI",
        "fiscal_year": "LatestFiscalYear",
        **FINANCIAL_MAP,
    }
    data = _read(SEC_FINANCIALS_PATH, list(rename))
    data["ultimate_parent_uei"] = _identifier(data["ultimate_parent_uei"])
    data["fiscal_year"] = pd.to_numeric(data["fiscal_year"], errors="coerce")
    for column in FINANCIAL_MAP:
        data[column] = pd.to_numeric(data[column], errors="coerce")
    data = data.sort_values("fiscal_year", ascending=False).drop_duplicates(
        "ultimate_parent_uei"
    )
    data = data.rename(columns=rename)
    return data[list(rename.values())]


def build_profiles() -> pd.DataFrame:
    """Build, validate, and return the final profile dataset."""
    profiles = _parents().merge(_awards(), on="UltimateParentUEI", how="left")
    profiles = profiles.merge(_sec_profiles(), on="UltimateParentUEI", how="left")
    profiles = profiles.merge(_latest_financials(), on="UltimateParentUEI", how="left")

    def coverage(row: pd.Series) -> str:
        missing = []
        if pd.isna(row["AwardCount"]) or row["AwardCount"] == 0:
            missing.append("no_usaspending_awards")
        if pd.isna(row["CIK"]) or not str(row["CIK"]).strip():
            missing.append("missing_sec_profile")
        elif pd.isna(row["LatestFiscalYear"]):
            missing.append("missing_sec_financials")
        return "complete" if not missing else ";".join(missing)

    profiles["DataCoverageFlag"] = profiles.apply(coverage, axis=1)
    profiles["LastRefreshedAt"] = datetime.now().replace(microsecond=0)
    profiles = profiles.reindex(columns=PROFILE_COLUMNS).sort_values("UltimateParentUEI")
    if profiles.empty or profiles["UltimateParentUEI"].eq("").any():
        raise ValueError("No valid company profiles were built.")
    if profiles["UltimateParentUEI"].duplicated().any():
        raise ValueError("Duplicate UltimateParentUEI values were built.")
    return profiles


def write_profiles(profiles: pd.DataFrame) -> None:
    """Write the reviewable Power BI profile CSV."""
    PROFILE_OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    profiles.to_csv(PROFILE_OUTPUT_PATH, index=False)
