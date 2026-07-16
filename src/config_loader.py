from __future__ import annotations

import json
import os
from copy import deepcopy
from typing import Any, Dict


USASPENDING_OUTPUT_DIR = os.path.join("output", "usaspending")
POWERBI_OUTPUT_DIR = os.path.join("output", "powerbi")


DEFAULT_CONFIG: Dict[str, Any] = {
    "api": {
        "base_url": "https://api.usaspending.gov/api/v2",
        "timeout_seconds": 30,
        "connect_timeout_seconds": 10,
        "read_timeout_seconds": 180,
        "max_retries": 5,
        "retry_delay_seconds": 2.0,
        "retry_backoff_multiplier": 2.0,
        "retry_max_delay_seconds": 30.0,
        "retry_jitter_seconds": 1.0,
        "page_pause_seconds": 5.0,
        "page_limit": 50,
    },
    "workflow": {
        "company_names_excel": "",
        "parent_companies_csv": os.path.join(USASPENDING_OUTPUT_DIR, "parent_companies_ueis_duns.csv"),
        "child_companies_csv": os.path.join(USASPENDING_OUTPUT_DIR, "child_companies_duns_ueis.csv"),
        "hierarchy_csv": os.path.join(USASPENDING_OUTPUT_DIR, "company_hierarchy.csv"),
        "awards_csv": os.path.join(USASPENDING_OUTPUT_DIR, "usaspending_awards_by_uei.csv"),
        "entity_master_csv": os.path.join(USASPENDING_OUTPUT_DIR, "entity_master.csv"),
        "relationships_csv": os.path.join(USASPENDING_OUTPUT_DIR, "relationships.csv"),
        "award_fact_csv": os.path.join(USASPENDING_OUTPUT_DIR, "award_fact.csv"),
        "failed_award_requests_csv": os.path.join(USASPENDING_OUTPUT_DIR, "failed_award_requests.csv"),
        "award_request_log_csv": os.path.join(USASPENDING_OUTPUT_DIR, "award_request_log.csv"),
        "award_progress_csv": os.path.join(USASPENDING_OUTPUT_DIR, "award_progress.csv"),
        "run_log_csv": os.path.join("logs", "run_log.csv"),
        "powerbi_output_dir": POWERBI_OUTPUT_DIR,
        "powerbi_entity_master_csv": "entity_master.csv",
        "award_fact_readable_csv": "award_fact_readable.csv",
        "relationships_readable_csv": "relationships_readable.csv",
        "parent_search_max_pages": 1,
        "fuzzy_mode": "strict",
        "fuzzy_threshold": 96.0,
        "fuzzy_min_gap": 12.0,
        "fuzzy_top_k": 3,
        "throttle_after_n_ueis": 3,
        "throttle_pause_seconds": 15,
        "start_date": "2025-01-01",
        "end_date": "now",
        "award_date_chunk": "quarter",
    },
    "fields": {
        "awards": [
            "Award ID",
            "Recipient Name",
            "recipient_id",
            "Recipient UEI",
            "Start Date",
            "End Date",
            "Award Amount",
            "Awarding Agency",
            "Awarding Sub Agency",
        ]
    },
    "analysis": {"default_company_name": ""},
}


def _merge_dict(base: Dict[str, Any], override: Dict[str, Any]) -> Dict[str, Any]:
    merged = deepcopy(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _merge_dict(merged[key], value)
        else:
            merged[key] = value
    return merged


def load_config(path: str | None) -> Dict[str, Any]:
    if not path or not os.path.exists(path):
        return deepcopy(DEFAULT_CONFIG)
    # utf-8-sig accepts standard UTF-8 and configuration files saved with a BOM.
    with open(path, "r", encoding="utf-8-sig") as handle:
        raw = json.load(handle)
    if not isinstance(raw, dict):
        raise ValueError("Config file must be a JSON object.")
    return _merge_dict(DEFAULT_CONFIG, raw)
