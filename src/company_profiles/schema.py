"""Fixed paths and field mappings for the company-profile proof of concept."""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
CONFIG_PATH = ROOT / "config" / "config.ini"
ENTITY_MASTER_PATH = ROOT / "output" / "usaspending" / "entity_master.csv"
AWARD_FACT_PATH = ROOT / "output" / "usaspending" / "award_fact.csv"
SEC_PROFILE_PATH = ROOT / "output" / "sec" / "sec_company_profile_readable.csv"
SEC_FINANCIALS_PATH = ROOT / "output" / "sec" / "sec_company_financials_annual_readable.csv"
PROFILE_OUTPUT_PATH = ROOT / "output" / "powerbi" / "company_profile_readable.csv"
ACCESS_TABLE = "CompanyProfilePOC"

IDENTITY_FIELDS = (
    "UltimateParentUEI",
    "UltimateParentName",
    "OriginalCompanyName",
    "DUNS",
)

SEC_IDENTITY_MAP = {
    "ticker": "Ticker",
    "cik": "CIK",
    "sec_company_name": "SECCompanyName",
    "sic": "SIC",
    "sic_description": "SICDescription",
    "entity_type": "EntityType",
    "business_city": "BusinessCity",
    "business_state_or_country": "BusinessStateOrCountry",
    "website": "Website",
}

FINANCIAL_MAP = {
    "reported_revenue": "ReportedRevenue",
    "net_income_loss": "NetIncomeLoss",
    "assets": "Assets",
    "liabilities": "Liabilities",
    "stockholders_equity": "StockholdersEquity",
    "total_debt": "TotalDebt",
}

AWARD_FIELDS = (
    "TotalAwardAmount",
    "AwardCount",
    "RecipientCount",
    "AwardingAgencyCount",
    "AwardPeriodStart",
    "AwardPeriodEnd",
)

SEC_MATCH_MAP = {
    "match_method": "SECMatchMethod",
    "match_confidence": "SECMatchConfidence",
    "review_status": "ReviewStatus",
}

PROFILE_COLUMNS = (
    *IDENTITY_FIELDS,
    *SEC_IDENTITY_MAP.values(),
    "LatestFiscalYear",
    *FINANCIAL_MAP.values(),
    *AWARD_FIELDS,
    *SEC_MATCH_MAP.values(),
    "DataCoverageFlag",
    "LastRefreshedAt",
)
