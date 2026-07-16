"""
USA Spending Data Workflow (Refined)

This script pulls federal contract and award data from the USAspending.gov API.
It's designed to help you find out which companies have government contracts,
who their parent/child companies are, and what awards they've received.

HOW IT WORKS (the big picture):
    You give it an Excel file with company names. The script then:
    1. Searches USAspending for each company and finds the "parent" organization
    2. Looks up all the subsidiaries (children) under each parent
    3. Combines parents + children into one big list (the "hierarchy")
    4. Pulls all federal awards/contracts for every company in that hierarchy

Each step saves its output to a CSV file, so if something breaks halfway through,
you can pick up where you left off without starting over.

You run it from the command line like this:
    python company_management/usaspending_data_pull_refined.py --step parents --input config/CompanyNames.xlsx
    python company_management/usaspending_data_pull_refined.py --step all     (runs everything in order)
"""

from __future__ import annotations

import argparse
import csv
import json
import logging
import os
import random
import re
import sys
import threading
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, fields as dataclass_fields
from datetime import date, datetime, timedelta
from difflib import SequenceMatcher
from typing import Any, Callable, Dict, Iterable, List, Optional, Sequence, Tuple

# This creates a "logger" that we use instead of print() throughout the script.
# It adds timestamps and severity levels (INFO, WARNING, ERROR) to every message,
# which makes it way easier to debug issues later.
logger = logging.getLogger("usaspending")

import pandas as pd
import requests

# Allow this documented entry point to run directly from the repository root.
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from src.config_loader import load_config


USASPENDING_OUTPUT_DIR = os.path.join("output", "usaspending")
POWERBI_OUTPUT_DIR = os.path.join("output", "powerbi")


# =============================================================================
# CONFIGURATION CLASSES
# These are like blueprints that define what settings the script needs.
# Think of them as a checklist of options with sensible default values.
# =============================================================================

@dataclass(frozen=True)
class ApiConfig:
    """Settings that control how we talk to the USAspending API.
    'frozen=True' means once these are set, they can't be changed accidentally."""

    # The base URL for all API calls. You probably won't ever change this.
    base_url: str = "https://api.usaspending.gov/api/v2"

    # Backward-compatible timeout setting. If the split timeout settings below
    # are not configured, this value is used for both connecting and reading.
    timeout_seconds: int = 30

    # How long to wait while opening the connection to the API.
    connect_timeout_seconds: int = 10

    # How long to wait for USAspending to send the response body.
    read_timeout_seconds: int = 180

    # If an API call fails, how many times should we retry before giving up?
    max_retries: int = 5

    # Base delay for retry backoff. Each failed retry multiplies this value.
    retry_delay_seconds: float = 2.0

    # Retry delay multiplier. Example: 2, 4, 8 seconds before jitter/capping.
    retry_backoff_multiplier: float = 2.0

    # Maximum retry sleep, even after exponential backoff.
    retry_max_delay_seconds: float = 30.0

    # Random extra seconds added to retry sleep so repeat runs do not retry in lockstep.
    retry_jitter_seconds: float = 1.0

    # Pause between successful paginated award-search requests.
    page_pause_seconds: float = 5.0

    # How many results to ask for per page. The API returns data in "pages"
    # (like pages of a book), and this controls how many items per page.
    page_limit: int = 50


@dataclass(frozen=True)
class WorkflowConfig:
    """Settings that control the overall workflow -- file paths, date ranges,
    fuzzy matching behavior, and throttling."""

    # Path to the Excel file containing company names to search.
    # Left blank by default -- you provide it via --input or config.json.
    company_names_excel: str = "config/CompanyNames.xlsx"

    # Output CSV file names for each step. These are the files the script creates.
    parent_companies_csv: str = os.path.join(USASPENDING_OUTPUT_DIR, "parent_companies_ueis_duns.csv")
    child_companies_csv: str = os.path.join(USASPENDING_OUTPUT_DIR, "child_companies_duns_ueis.csv")
    hierarchy_csv: str = os.path.join(USASPENDING_OUTPUT_DIR, "company_hierarchy.csv")
    awards_csv: str = os.path.join(USASPENDING_OUTPUT_DIR, "usaspending_awards_by_uei.csv")
    entity_master_csv: str = os.path.join(USASPENDING_OUTPUT_DIR, "entity_master.csv")
    relationships_csv: str = os.path.join(USASPENDING_OUTPUT_DIR, "relationships.csv")
    award_fact_csv: str = os.path.join(USASPENDING_OUTPUT_DIR, "award_fact.csv")
    failed_award_requests_csv: str = os.path.join(USASPENDING_OUTPUT_DIR, "failed_award_requests.csv")
    award_request_log_csv: str = os.path.join(USASPENDING_OUTPUT_DIR, "award_request_log.csv")
    award_progress_csv: str = os.path.join(USASPENDING_OUTPUT_DIR, "award_progress.csv")
    run_log_csv: str = os.path.join("logs", "run_log.csv")
    powerbi_output_dir: str = POWERBI_OUTPUT_DIR
    powerbi_entity_master_csv: str = "entity_master.csv"
    award_fact_readable_csv: str = "award_fact_readable.csv"
    relationships_readable_csv: str = "relationships_readable.csv"

    # When searching for parent companies, how many pages of results to look through.
    # More pages = more thorough search, but slower.
    parent_search_max_pages: int = 1

    # Fuzzy matching mode. This controls how the script handles company name matching:
    #   "assist" = shows all candidates with scores so you can review them
    #   "strict" = only picks exact or high-confidence matches automatically
    #   "off"    = no fuzzy matching, just dumps all parent-level results
    fuzzy_mode: str = "strict"

    # Minimum score (0-100) for a fuzzy match to be considered "confident enough".
    # Higher = stricter matching. 96 is intentionally conservative for broad names.
    fuzzy_threshold: float = 96.0

    # The score gap between the #1 and #2 candidate needs to be at least this big
    # for us to feel confident the #1 is the right match. Prevents picking between
    # two candidates that are almost tied.
    fuzzy_min_gap: float = 12.0

    # How many top candidates to show in the summary column of the output.
    fuzzy_top_k: int = 3

    # Throttling: after processing this many UEIs, pause to avoid hitting rate limits.
    throttle_after_n_ueis: int = 3

    # How many seconds to pause during throttling.
    throttle_pause_seconds: int = 15

    # Date range for pulling awards. Only awards within this window are fetched.
    start_date: str = "2025-01-01"
    end_date: str = datetime.now().strftime("%Y-%m-%d")

    # Chunk award pulls into smaller date windows: "month", "quarter", or "all".
    award_date_chunk: str = "quarter"


# =============================================================================
# HELPER FUNCTIONS
# Small utility functions used by the bigger functions below.
# =============================================================================

def dataclass_from_mapping(cls: Any, values: Dict[str, Any]) -> Any:
    """Takes a dictionary (like what you'd get from config.json) and creates a
    dataclass from it. Ignores any extra keys in the dict that aren't part of
    the dataclass -- so your config file can have extra stuff without breaking."""
    allowed = {field.name for field in dataclass_fields(cls)}
    filtered = {key: value for key, value in values.items() if key in allowed}
    return cls(**filtered)


def normalize_date_value(raw_value: Optional[str], fallback: str) -> str:
    """Cleans up a date string. If someone types "now", it converts that to today's
    date. Otherwise it checks that the date is in YYYY-MM-DD format. If the value
    is empty or None, it falls back to the provided default."""
    value = str(raw_value).strip() if raw_value is not None else fallback
    if not value:
        value = fallback
    if value.lower() == "now":
        return datetime.now().strftime("%Y-%m-%d")
    # This will throw an error if the date format is wrong, which is what we want.
    datetime.strptime(value, "%Y-%m-%d")
    return value


def coerce_int(value: Any, field_name: str) -> int:
    """Safely converts a value to an integer. Config values might come in as strings
    (like "30" from JSON or environment variables), so this handles that conversion.
    Gives a clear error message if the value can't be converted."""
    try:
        return int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"Invalid integer for '{field_name}': {value}") from exc


def coerce_float(value: Any, field_name: str) -> float:
    """Same idea as coerce_int, but for decimal numbers (floats)."""
    try:
        return float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"Invalid number for '{field_name}': {value}") from exc


def timestamp_now() -> str:
    """Returns a compact local timestamp for CSV logs."""
    return datetime.now().isoformat(timespec="seconds")


def append_csv_row(path: str, fieldnames: Sequence[str], row: Dict[str, Any]) -> None:
    """Appends one row to a CSV file, creating the header on first write."""
    directory = os.path.dirname(path)
    if directory:
        os.makedirs(directory, exist_ok=True)
    file_exists = os.path.exists(path) and os.path.getsize(path) > 0
    with open(path, "a", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, extrasaction="ignore")
        if not file_exists:
            writer.writeheader()
        writer.writerow(row)


def try_append_csv_row(path: str, fieldnames: Sequence[str], row: Dict[str, Any], context: str) -> bool:
    """Best-effort log append used for operational CSVs that may be open in Excel."""
    try:
        append_csv_row(path, fieldnames, row)
        return True
    except OSError as exc:
        logger.warning("Unable to write %s log %s: %s", context, path, exc)
        return False


AWARD_REQUEST_LOG_FIELDS = [
    "timestamp",
    "method",
    "endpoint",
    "uei",
    "start_date",
    "end_date",
    "page",
    "attempt",
    "elapsed_seconds",
    "status_code",
    "outcome",
    "error_type",
    "error_message",
]

FAILED_AWARD_REQUEST_FIELDS = [
    "timestamp",
    "run_id",
    "uei",
    "start_date",
    "end_date",
    "page",
    "endpoint",
    "error_type",
    "error_message",
    "retry_status",
]

AWARD_PROGRESS_FIELDS = [
    "timestamp",
    "run_id",
    "uei",
    "start_date",
    "end_date",
    "status",
    "rows_written",
    "output_csv",
]

RUN_LOG_FIELDS = [
    "run_id",
    "step",
    "started_at",
    "finished_at",
    "status",
    "total_ueis",
    "total_windows",
    "completed_windows_at_start",
    "attempted_windows",
    "successful_windows",
    "failed_windows",
    "rows_written",
    "output_csv",
    "failed_requests_csv",
    "progress_csv",
]


# =============================================================================
# STATE FILE MANAGEMENT
# The state file remembers things between runs, like which Excel file you used
# last time. It's a small JSON file that gets updated after each run.
# =============================================================================

def load_state_file(path: str) -> Dict[str, Any]:
    """Loads the state file if it exists. If it doesn't exist or is corrupted,
    just returns an empty dictionary (no big deal, we'll create a new one)."""
    if not os.path.exists(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        logger.warning("Ignoring unreadable state file: %s", path)
        return {}


def save_state_file(path: str, state: Dict[str, Any]) -> None:
    """Saves the current state to a JSON file. Creates the directory if needed.
    If it fails to write (e.g., permissions issue), it logs the error but doesn't
    crash -- losing state is annoying but not fatal."""
    try:
        directory = os.path.dirname(path)
        if directory:
            os.makedirs(directory, exist_ok=True)
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(state, handle, indent=2)
    except OSError as exc:
        logger.error("Failed to write state file '%s': %s", path, exc)


# =============================================================================
# INPUT FILE RESOLUTION
# Figures out where the company names Excel file is. It checks multiple places
# in order of priority: command line > environment variable > config > state file.
# =============================================================================

def _existing_path(path_value: str) -> Optional[str]:
    """Takes a file path, expands any environment variables or ~ in it,
    and checks if the file actually exists. Returns the expanded path if it
    exists, or None if it doesn't."""
    expanded = os.path.expandvars(os.path.expanduser(str(path_value).strip()))
    return expanded if expanded and os.path.exists(expanded) else None


def resolve_company_names_excel(
    cli_input: Optional[str],
    workflow_default: str,
    state: Dict[str, Any],
    non_interactive: bool,
) -> str:
    """Figures out which Excel file to use for company names. It looks in several
    places in this order (first one that exists wins):
      1. The --input flag from the command line
      2. The USASPENDING_COMPANY_NAMES_EXCEL environment variable
      3. The company_names_excel setting in config.json
      4. The last file used (saved in the state file)
      5. Ask the user to type a path (unless --non-interactive is set)
    """
    candidates: List[Tuple[str, Optional[str]]] = [
        ("--input", cli_input),
        ("USASPENDING_COMPANY_NAMES_EXCEL", os.getenv("USASPENDING_COMPANY_NAMES_EXCEL")),
        ("config.workflow.company_names_excel", workflow_default),
        ("state.last_company_names_excel", state.get("last_company_names_excel")),
    ]
    tried: List[str] = []
    for source, raw_path in candidates:
        if not raw_path:
            continue
        resolved = _existing_path(str(raw_path))
        if resolved:
            return resolved
        tried.append(f"{source}={raw_path}")

    # If we're in non-interactive mode (like running in CI), don't ask -- just fail.
    if non_interactive:
        attempted = "; ".join(tried) if tried else "no candidates provided"
        raise FileNotFoundError(
            f"No valid company input Excel file found. Tried: {attempted}. "
            "Provide --input or set USASPENDING_COMPANY_NAMES_EXCEL."
        )

    # Last resort: ask the user to type a path.
    prompt = (
        "Enter path to company names Excel file (must include 'Company' column), "
        "or press Enter to cancel: "
    )
    user_path = input(prompt).strip()
    resolved = _existing_path(user_path)
    if resolved:
        return resolved
    raise FileNotFoundError("No valid company input Excel path was provided.")


# =============================================================================
# API CLIENT
# This is the main class that handles all communication with the USAspending API.
# It wraps the 'requests' library and adds automatic retry logic so that if
# the API is having a bad day, we don't just crash immediately.
# =============================================================================

class ApiClient:
    RETRYABLE_STATUS_CODES = {429, 500, 502, 503, 504}

    def __init__(self, config: ApiConfig, request_log_csv: str = "") -> None:
        self.config = config
        self.request_log_csv = request_log_csv
        self._request_log_lock = threading.Lock()
        # A "session" reuses the same connection, which is faster than opening
        # a new connection for every single API call.
        self.session = requests.Session()

    def _timeout(self) -> Tuple[int, int]:
        """Returns the requests timeout tuple: (connect timeout, read timeout)."""
        connect_timeout = self.config.connect_timeout_seconds or self.config.timeout_seconds
        read_timeout = self.config.read_timeout_seconds or self.config.timeout_seconds
        return (connect_timeout, read_timeout)

    def _retry_delay(self, attempt: int) -> float:
        """Calculates exponential retry delay with a small random jitter."""
        base_delay = self.config.retry_delay_seconds * (self.config.retry_backoff_multiplier ** attempt)
        capped_delay = min(base_delay, self.config.retry_max_delay_seconds)
        jitter = random.uniform(0, self.config.retry_jitter_seconds) if self.config.retry_jitter_seconds else 0
        return min(capped_delay + jitter, self.config.retry_max_delay_seconds)

    def _is_retryable(self, exc: requests.exceptions.RequestException) -> bool:
        """Only retry transient API/server/network failures."""
        response = getattr(exc, "response", None)
        if response is None:
            return isinstance(
                exc,
                (
                    requests.exceptions.Timeout,
                    requests.exceptions.ConnectionError,
                ),
            )
        return response.status_code in self.RETRYABLE_STATUS_CODES

    def _log_request(
        self,
        method: str,
        endpoint: str,
        context: Optional[Dict[str, Any]],
        attempt: int,
        elapsed_seconds: float,
        status_code: Optional[int],
        outcome: str,
        error: Optional[BaseException] = None,
    ) -> None:
        """Writes detailed award request attempts to a CSV log when configured."""
        if not self.request_log_csv or not context:
            return
        row = {
            "timestamp": timestamp_now(),
            "method": method,
            "endpoint": endpoint,
            "uei": context.get("uei", ""),
            "start_date": context.get("start_date", ""),
            "end_date": context.get("end_date", ""),
            "page": context.get("page", ""),
            "attempt": attempt,
            "elapsed_seconds": f"{elapsed_seconds:.3f}",
            "status_code": status_code or "",
            "outcome": outcome,
            "error_type": type(error).__name__ if error else "",
            "error_message": str(error) if error else "",
        }
        try:
            with self._request_log_lock:
                append_csv_row(self.request_log_csv, AWARD_REQUEST_LOG_FIELDS, row)
        except OSError as exc:
            logger.warning("Unable to write request log %s: %s", self.request_log_csv, exc)

    def post(self, endpoint: str, payload: dict, context: Optional[Dict[str, Any]] = None) -> dict:
        """Sends a POST request to the API. POST is used when we need to send
        search filters (like company names, date ranges, etc.) to the API.

        If the request fails, it automatically retries up to max_retries times
        with a short delay between each attempt."""
        url = f"{self.config.base_url}{endpoint}"
        for attempt in range(self.config.max_retries):
            started = time.monotonic()
            status_code: Optional[int] = None
            try:
                response = self.session.post(
                    url,
                    json=payload,
                    timeout=self._timeout(),
                )
                status_code = response.status_code
                # This will raise an error if the API returned an error status code
                # (like 500 Internal Server Error or 429 Too Many Requests).
                response.raise_for_status()
                self._log_request(
                    "POST",
                    endpoint,
                    context,
                    attempt + 1,
                    time.monotonic() - started,
                    status_code,
                    "success",
                )
                return response.json()
            except requests.exceptions.RequestException as exc:
                response = getattr(exc, "response", None)
                if response is not None:
                    status_code = response.status_code
                elapsed = time.monotonic() - started
                self._log_request("POST", endpoint, context, attempt + 1, elapsed, status_code, "failure", exc)
                logger.warning(
                    "POST attempt %d failed endpoint=%s context=%s elapsed=%.2fs status=%s error=%s",
                    attempt + 1,
                    endpoint,
                    context or {},
                    elapsed,
                    status_code or "",
                    exc,
                )
                # If the API sent back an error response, log it for debugging.
                if (err_response := getattr(exc, "response", None)) is not None:
                    logger.debug("Response content: %s", err_response.text)
                if self._is_retryable(exc) and attempt < self.config.max_retries - 1:
                    # Wait a bit before trying again.
                    retry_delay = self._retry_delay(attempt)
                    logger.info("Retrying POST %s in %.1fs.", endpoint, retry_delay)
                    time.sleep(retry_delay)
                else:
                    # We've used up all our retries. Give up and raise the error.
                    raise
        raise RuntimeError("Max retries reached for POST request.")

    def get(self, endpoint: str, params: dict, context: Optional[Dict[str, Any]] = None) -> Any:
        """Sends a GET request to the API. GET is used for simpler lookups
        where we just pass parameters in the URL (like looking up a specific
        company by their ID).

        Same retry logic as post()."""
        url = f"{self.config.base_url}{endpoint}"
        for attempt in range(self.config.max_retries):
            started = time.monotonic()
            status_code: Optional[int] = None
            try:
                response = self.session.get(url, params=params, timeout=self._timeout())
                status_code = response.status_code
                response.raise_for_status()
                self._log_request(
                    "GET",
                    endpoint,
                    context,
                    attempt + 1,
                    time.monotonic() - started,
                    status_code,
                    "success",
                )
                return response.json()
            except requests.exceptions.RequestException as exc:
                response = getattr(exc, "response", None)
                if response is not None:
                    status_code = response.status_code
                elapsed = time.monotonic() - started
                self._log_request("GET", endpoint, context, attempt + 1, elapsed, status_code, "failure", exc)
                logger.warning(
                    "GET attempt %d failed endpoint=%s context=%s elapsed=%.2fs status=%s error=%s",
                    attempt + 1,
                    endpoint,
                    context or {},
                    elapsed,
                    status_code or "",
                    exc,
                )
                if (err_response := getattr(exc, "response", None)) is not None:
                    logger.debug("Response content: %s", err_response.text)
                if self._is_retryable(exc) and attempt < self.config.max_retries - 1:
                    retry_delay = self._retry_delay(attempt)
                    logger.info("Retrying GET %s in %.1fs.", endpoint, retry_delay)
                    time.sleep(retry_delay)
                else:
                    raise
        raise RuntimeError("Max retries reached for GET request.")


# =============================================================================
# DATA VALIDATION HELPERS
# =============================================================================

def validate_required_columns(df: pd.DataFrame, required: Iterable[str], context: str) -> bool:
    """Checks that a DataFrame (basically a table of data) has all the columns
    we need. For example, the parent CSV needs columns like 'UEI', 'DUNS', etc.
    Returns True if everything looks good, False if columns are missing."""
    missing = [col for col in required if col not in df.columns]
    if missing:
        logger.error("[%s] Missing required columns: %s", context, missing)
        return False
    return True


def read_company_names(excel_path: str, column: str = "Company") -> List[str]:
    """Opens the Excel file and pulls out the list of company names from the
    'Company' column. These names are what we'll search for in USAspending.
    Drops any blank/empty rows so we don't search for nothing."""
    df = pd.read_excel(excel_path)
    if column not in df.columns:
        raise ValueError(f"Excel file must contain '{column}' column.")
    return df[column].dropna().tolist()


# =============================================================================
# FUZZY MATCHING ENGINE
# This whole section handles "fuzzy" name matching. The problem: when you search
# for "Raytheon" in USAspending, you might get back results like:
#   - "RAYTHEON COMPANY"
#   - "RAYTHEON TECHNOLOGIES CORPORATION"
#   - "RAYTHEON MISSILE SYSTEMS"
#
# We need to figure out which one is the best match for what you searched.
# This code does that by comparing strings in multiple ways and scoring them.
#
# We built this ourselves instead of using the 'rapidfuzz' library because
# that library isn't available in our work environment.
# =============================================================================

# These are common legal suffixes that get stripped out before comparing names.
# "Raytheon Corporation" and "Raytheon Corp" should be treated as the same thing.
COMPANY_SUFFIX_TOKENS = {
    "and",
    "co",
    "company",
    "corp",
    "corporation",
    "holdings",
    "inc",
    "incorporated",
    "limited",
    "llc",
    "lp",
    "ltd",
    "plc",
    "sa",
    "the",
}


def default_process(value: str) -> str:
    """Basic text cleanup: converts to lowercase, removes punctuation, and
    collapses extra spaces. So "Johnson & Johnson, Inc." becomes "johnson johnson inc"."""
    cleaned = re.sub(r"[^a-z0-9]+", " ", str(value).lower()).strip()
    return " ".join(cleaned.split())


def process_company_name(value: str) -> str:
    """Like default_process, but also strips out common legal suffixes.
    So "Raytheon Corporation" becomes just "raytheon". This way we don't
    penalize matches just because one version says "Inc" and the other says "Corp"."""
    cleaned = default_process(value)
    if not cleaned:
        return ""
    tokens = [token for token in cleaned.split() if token and token not in COMPANY_SUFFIX_TOKENS]
    return " ".join(tokens) if tokens else cleaned


def _tokenize_processed(value: str) -> List[str]:
    """Splits a cleaned-up string into individual words (tokens).
    "raytheon technologies" -> ["raytheon", "technologies"]"""
    return [token for token in value.split() if token]


def _acronym(tokens: Sequence[str]) -> str:
    """Takes a list of words and makes an acronym from their first letters.
    ["raytheon", "technologies", "corporation"] -> "rtc" """
    return "".join(token[0] for token in tokens if token)


def _clamp_score(value: float) -> float:
    """Makes sure a score stays between 0 and 100. Just a safety guard."""
    return max(0.0, min(100.0, value))


def ratio(
    left: str,
    right: str,
    processor: Optional[Callable[[str], str]] = default_process,
) -> float:
    """Compares two strings and returns a similarity score from 0 to 100.
    100 = identical, 0 = completely different.

    Uses Python's built-in SequenceMatcher, which looks at the longest
    common subsequences between the two strings. Think of it like finding
    how much of one string appears in the other."""
    if processor is not None:
        left = processor(left)
        right = processor(right)
    if not left or not right:
        return 0.0
    return _clamp_score(SequenceMatcher(None, left, right).ratio() * 100.0)


def partial_ratio(
    left: str,
    right: str,
    processor: Optional[Callable[[str], str]] = default_process,
) -> float:
    """Like ratio(), but handles the case where one string is much shorter than
    the other. For example, "3M" should match well against "3M Company" even though
    the full strings are quite different.

    It slides the shorter string along the longer one and finds the best-matching
    window. Think of it like a magnifying glass moving across the longer string."""
    if processor is not None:
        left = processor(left)
        right = processor(right)
    if not left or not right:
        return 0.0
    # Always make 'left' the shorter string for consistency.
    if len(left) > len(right):
        left, right = right, left
    # Quick check: if the short string is completely inside the long one, it's 100%.
    if left in right:
        return 100.0

    best = 0.0
    matcher = SequenceMatcher(None, left, right)
    for block in matcher.get_matching_blocks():
        # Try different windows of the longer string that are the same length
        # as the shorter string, and see which window gives the best score.
        start = max(block[1] - block[0], 0)
        end = start + len(left)
        window = right[start:end]
        if not window:
            continue
        best = max(best, SequenceMatcher(None, left, window).ratio() * 100.0)
        if best >= 99.99:
            break
    if best == 0.0:
        # Fallback: just compare them directly if no good window was found.
        best = SequenceMatcher(None, left, right).ratio() * 100.0
    return _clamp_score(best)


def token_sort_ratio(
    left: str,
    right: str,
    processor: Optional[Callable[[str], str]] = default_process,
) -> float:
    """Sorts both strings alphabetically by word before comparing.
    This way "Johnson and Johnson" matches "Johnson Johnson and" perfectly,
    because word order doesn't matter."""
    if processor is not None:
        left = processor(left)
        right = processor(right)
    left_sorted = " ".join(sorted(_tokenize_processed(left)))
    right_sorted = " ".join(sorted(_tokenize_processed(right)))
    return ratio(left_sorted, right_sorted, processor=None)


def token_set_ratio(
    left: str,
    right: str,
    processor: Optional[Callable[[str], str]] = default_process,
) -> float:
    """Compares two strings based on the SETS of words they contain.
    Words that appear in both strings are weighted heavily. Extra words
    in either string are penalized less.

    Good for cases like:
      "Lockheed Martin Corporation" vs "Lockheed Martin Space"
    They share "Lockheed Martin" which should count for a lot."""
    if processor is not None:
        left = processor(left)
        right = processor(right)

    left_set = set(_tokenize_processed(left))
    right_set = set(_tokenize_processed(right))
    if not left_set or not right_set:
        return 0.0

    # Find words they share and words unique to each side.
    common = sorted(left_set & right_set)
    left_only = sorted(left_set - right_set)
    right_only = sorted(right_set - left_set)
    if not common:
        return ratio(" ".join(sorted(left_set)), " ".join(sorted(right_set)), processor=None)

    # Compare: just-the-shared-words vs shared+extra-left vs shared+extra-right.
    # Take the best score.
    common_text = " ".join(common)
    left_text = " ".join(common + left_only)
    right_text = " ".join(common + right_only)
    return max(
        ratio(common_text, left_text, processor=None),
        ratio(common_text, right_text, processor=None),
        ratio(left_text, right_text, processor=None),
    )


def wratio(
    left: str,
    right: str,
    processor: Optional[Callable[[str], str]] = default_process,
) -> float:
    """The "weighted ratio" -- our best overall scoring function. It runs all
    four comparison methods (ratio, partial_ratio, token_sort, token_set) and
    picks the best score, with slight adjustments based on how different the
    string lengths are.

    If one string is much longer than the other (ratio > 1.5x), it puts more
    weight on partial_ratio and token_set since those handle length differences
    better."""
    if processor is not None:
        left_processed = processor(left)
        right_processed = processor(right)
    else:
        left_processed = left
        right_processed = right

    if not left_processed or not right_processed:
        return 0.0

    # Run all four scoring methods.
    base = ratio(left_processed, right_processed, processor=None)
    tsort = token_sort_ratio(left_processed, right_processed, processor=None)
    tset = token_set_ratio(left_processed, right_processed, processor=None)
    part = partial_ratio(left_processed, right_processed, processor=None)

    # Check if the strings are very different lengths.
    min_len = min(len(left_processed), len(right_processed))
    max_len = max(len(left_processed), len(right_processed))
    length_ratio = (max_len / min_len) if min_len else float("inf")

    # When lengths are very different, trust partial_ratio and token_set more.
    if length_ratio > 1.5:
        return _clamp_score(max(base, (part * 0.9), (tsort * 0.85), (tset * 0.95)))
    return _clamp_score(max(base, (part * 0.9), (tsort * 0.95), (tset * 0.95)))


def extract(
    query: str,
    choices: Sequence[str],
    scorer: Callable[[str, str, Optional[Callable[[str], str]]], float] = wratio,
    processor: Optional[Callable[[str], str]] = default_process,
    limit: int = 5,
    score_cutoff: float = 0.0,
) -> List[Tuple[str, float, int]]:
    """Given a search query and a list of choices, scores every choice against
    the query and returns the top matches.

    Returns a list of tuples: (choice_text, score, original_index)
    Sorted from best match to worst.

    Example:
        extract("Raytheon", ["RAYTHEON COMPANY", "BOEING CO", "RAYTHEON MISSILES"])
        -> [("RAYTHEON COMPANY", 95.2, 0), ("RAYTHEON MISSILES", 88.1, 2), ...]
    """
    limit = max(1, int(limit))
    score_cutoff = float(score_cutoff)
    results: List[Tuple[str, float, int]] = []
    for index, choice in enumerate(choices):
        score = float(scorer(query, str(choice), processor))
        if score >= score_cutoff:
            results.append((str(choice), round(_clamp_score(score), 2), index))
    results.sort(key=lambda item: item[1], reverse=True)
    return results[:limit]


def extract_one(
    query: str,
    choices: Sequence[str],
    scorer: Callable[[str, str, Optional[Callable[[str], str]]], float] = wratio,
    processor: Optional[Callable[[str], str]] = default_process,
    score_cutoff: float = 0.0,
) -> Optional[Tuple[str, float, int]]:
    """Like extract(), but just returns the single best match (or None)."""
    matches = extract(query, choices, scorer=scorer, processor=processor, limit=1, score_cutoff=score_cutoff)
    return matches[0] if matches else None


# =============================================================================
# PARENT CANDIDATE SCORING
# When we search for a company name, the API might return dozens of results.
# These functions help us figure out which result is the "real" match.
# =============================================================================

def score_parent_candidate(search_name: str, candidate_name: str) -> Dict[str, Any]:
    """Gives a detailed score for how well a candidate name matches what we searched for.
    It checks multiple things:
      - Overall fuzzy similarity (wratio score)
      - Do they share the same words? (token overlap)
      - Is one a prefix of the other? ("3M" vs "3M Company")
      - Do they have the same acronym? ("RTX" matching "Raytheon Technologies Corp")
      - Are they exactly the same after cleanup?

    Returns a dict with the score, whether it's an exact match, and the reasoning."""
    search_normalized = process_company_name(search_name)
    candidate_normalized = process_company_name(candidate_name)
    search_tokens = _tokenize_processed(search_normalized)
    candidate_tokens = _tokenize_processed(candidate_normalized)

    # Start with the weighted ratio as the base score.
    rapid_score = wratio(search_name, candidate_name, processor=process_company_name)
    token_set_component = token_set_ratio(search_name, candidate_name, processor=process_company_name)
    score = max(rapid_score, 0.7 * rapid_score + 0.3 * token_set_component)

    # Bonus points for sharing words. If you searched for "Lockheed Martin" and
    # the candidate is "Lockheed Martin Space", they share 2 out of 2 search words.
    search_set = set(search_tokens)
    candidate_set = set(candidate_tokens)
    shared_tokens = search_set & candidate_set
    if search_set:
        score += 4.0 * (len(shared_tokens) / len(search_set))

    # Check for special matching conditions.
    exact_name = bool(search_normalized and search_normalized == candidate_normalized)
    exact_token_set = bool(search_set and search_set == candidate_set)
    prefix_match = bool(
        search_normalized
        and candidate_normalized
        and (search_normalized.startswith(candidate_normalized) or candidate_normalized.startswith(search_normalized))
    )
    acronym_match = bool(
        len(search_tokens) >= 2
        and len(candidate_tokens) >= 2
        and _acronym(search_tokens)
        and _acronym(search_tokens) == _acronym(candidate_tokens)
    )

    # Apply bonuses for special conditions.
    if prefix_match:
        score += 3.0
    if acronym_match:
        score += 4.0
    # If it's an exact match (after removing legal suffixes), just give it 100.
    if exact_name or exact_token_set:
        score = 100.0

    # Build a human-readable explanation of why this score was given.
    reason_parts: List[str] = []
    if exact_name:
        reason_parts.append("exact_normalized")
    if exact_token_set and not exact_name:
        reason_parts.append("token_set_exact")
    if prefix_match:
        reason_parts.append("prefix")
    if acronym_match:
        reason_parts.append("acronym")
    if not reason_parts:
        reason_parts.append("wratio")

    return {
        "score": _clamp_score(score),
        "exact_match": bool(exact_name or exact_token_set),
        "reason": ",".join(reason_parts),
        "wratio": round(rapid_score, 2),
    }


def summarize_top_candidates(scored_candidates: List[Dict[str, Any]], top_k: int) -> str:
    """Creates a short text summary of the top candidates for the CSV output.
    Example: "1) RAYTHEON COMPANY [98.5]; 2) RAYTHEON MISSILES [85.2]" """
    if not scored_candidates:
        return ""
    parts = []
    for index, candidate in enumerate(scored_candidates[: max(1, top_k)], start=1):
        name = str(candidate["recipient"].get("name") or "N/A")
        parts.append(f"{index}) {name} [{candidate['score']:.1f}]")
    return "; ".join(parts)


# =============================================================================
# API DATA FETCHING FUNCTIONS
# These functions handle the actual API calls to pull data from USAspending.
# =============================================================================

def fetch_awards_by_company(
    api: ApiClient,
    company_name: str,
    fields: List[str],
    start_date: str,
    end_date: str,
) -> Optional[pd.DataFrame]:
    """Searches USAspending for all awards matching a company name.
    It handles pagination automatically -- the API only returns ~100 results at a time,
    so this function keeps asking for the next page until there are no more results.

    Returns a DataFrame (table) of awards, or None if nothing was found."""
    endpoint = "/search/spending_by_award/"
    all_results: List[dict] = []
    page_number = 1

    while True:
        payload = {
            "subawards": False,
            "limit": api.config.page_limit,
            "page": page_number,
            "filters": {
                "recipient_search_text": [company_name],
                "time_period": [{"start_date": start_date, "end_date": end_date}],
                "category": "awards",
                # A, B, C, D = different types of contracts/grants.
                "award_type_codes": ["A", "B", "C", "D"],
            },
            "fields": fields,
        }

        data = api.post(endpoint, payload)
        results = data.get("results", [])
        if not results:
            break
        all_results.extend(results)

        # If we got fewer results than the page limit, we've reached the last page.
        if len(results) < api.config.page_limit:
            break
        page_number += 1
        time.sleep(api.config.page_pause_seconds)

    return pd.DataFrame(all_results) if all_results else None


def process_companies_from_excel(
    api: ApiClient, excel_path: str, fields: List[str], start_date: str, end_date: str
) -> Optional[pd.DataFrame]:
    """Reads company names from the Excel file and pulls awards for each one.
    If one company fails, it keeps going with the rest (doesn't stop the whole batch)."""
    try:
        company_names = read_company_names(excel_path)
    except Exception as exc:
        logger.error("Failed to read excel: %s", exc)
        return None

    frames: List[pd.DataFrame] = []
    for company_name in company_names:
        logger.info("Processing: %s", company_name)
        df = fetch_awards_by_company(api, company_name, fields, start_date, end_date)
        if df is not None:
            frames.append(df)
        else:
            logger.info("No data for %s", company_name)

    if not frames:
        logger.warning("No data for any company.")
        return None
    # Stack all the individual company results into one big table.
    return pd.concat(frames, ignore_index=True)


def fetch_parent_recipients(api: ApiClient, keyword: str, max_pages: int = 2) -> List[dict]:
    """Searches the USAspending recipient directory for companies matching a keyword.
    This is used in the 'parents' step to find the official parent company entry
    (which has a UEI and DUNS number we need for later steps).

    Returns a list of recipient records from the API."""
    endpoint = "/recipient/duns/"
    results: List[dict] = []
    page = 1
    while page <= max_pages:
        payload = {
            "keyword": keyword,
            "page": page,
            "limit": 1000,
            "sort": "amount",
            "order": "desc",
            "award_type": "all",
        }
        data = api.post(endpoint, payload)
        results.extend(data.get("results", []))
        # Check if there are more pages of results.
        if not data.get("page_metadata", {}).get("hasNext", False):
            break
        page += 1
        time.sleep(0.5)
    return results


# =============================================================================
# CSV WRITING
# =============================================================================

def write_csv(df: pd.DataFrame, path: str) -> None:
    """Saves a DataFrame to a CSV file. Simple wrapper that adds logging so
    we always know what file was written and how many rows it has."""
    df.to_csv(path, index=False, encoding="utf-8")
    logger.info("Wrote %d rows to %s", len(df), path)


# =============================================================================
# NORMALIZED SCHEMA HELPERS
# New schema logic for entity_master.csv / relationships.csv / award_fact.csv.
# =============================================================================

def _clean_text(value: Any) -> str:
    if value is None or pd.isna(value):
        return ""
    return str(value).strip()


def _clean_uei(value: Any) -> str:
    text = _clean_text(value)
    return "" if not text or text.upper() == "N/A" else text


def _clean_duns(value: Any) -> str:
    text = _clean_text(value)
    return "" if not text or text.upper() == "N/A" else text


def _first_non_empty(values: Sequence[Any], fallback: str = "") -> str:
    for value in values:
        text = _clean_text(value)
        if text:
            return text
    return fallback


def build_normalized_schema(
    parent_csv: str,
    child_csv: str,
    entity_master_csv: str,
    relationships_csv: str,
) -> bool:
    """Builds normalized hierarchy outputs from parent/child discovery outputs.

    This keeps the existing workflow files, but also materializes:
    1) entity_master.csv (one row per UEI/entity)
    2) relationships.csv (child -> parent edges)
    """
    try:
        df_parents = pd.read_csv(parent_csv)
        df_children = pd.read_csv(child_csv)
    except FileNotFoundError as exc:
        logger.error("Missing input CSV for normalized schema: %s", exc)
        return False

    required_parent = ["Original Company Name", "Recipient Name", "DUNS", "UEI", "Recipient Level"]
    required_child = ["Original Company Name", "Recipient Name", "DUNS", "UEI", "Recipient Level"]
    if not validate_required_columns(df_parents, required_parent, "NormalizedSchema"):
        return False
    if not validate_required_columns(df_children, required_child, "NormalizedSchema"):
        return False

    run_date = date.today().isoformat()

    # Build a fallback map from original company input -> selected parent UEI/name.
    # This is used only when older child CSVs don't have explicit parent columns.
    parent_lookup: Dict[str, Dict[str, str]] = {}
    for _, row in df_parents.iterrows():
        original_name = _clean_text(row.get("Original Company Name"))
        uei = _clean_uei(row.get("UEI"))
        if not original_name or not uei:
            continue
        key = original_name.casefold()
        if key not in parent_lookup:
            parent_lookup[key] = {
                "parent_uei": uei,
                "parent_name": _clean_text(row.get("Recipient Name")),
            }

    relationship_rows: List[Dict[str, Any]] = []
    for _, row in df_children.iterrows():
        child_uei = _clean_uei(row.get("UEI"))
        if not child_uei:
            continue

        parent_uei = _clean_uei(row.get("Parent UEI"))
        parent_name = _clean_text(row.get("Parent Recipient Name"))
        source = "recipient_children_api"
        confidence = 1.0

        if not parent_uei:
            fallback = parent_lookup.get(_clean_text(row.get("Original Company Name")).casefold())
            if fallback:
                parent_uei = fallback["parent_uei"]
                parent_name = fallback["parent_name"]
                source = "original_company_parent_fallback"
                confidence = 0.7

        if not parent_uei or parent_uei == child_uei:
            continue

        relationship_rows.append(
            {
                "child_uei": child_uei,
                "parent_uei": parent_uei,
                "relationship_source": source,
                "relationship_confidence": float(confidence),
                "first_seen_date": run_date,
                "last_seen_date": run_date,
                # internal helper field; removed before output
                "_parent_name": parent_name,
            }
        )

    if relationship_rows:
        relationships_df = pd.DataFrame(relationship_rows)
        relationships_df = (
            relationships_df.groupby(
                ["child_uei", "parent_uei", "relationship_source"], as_index=False, dropna=False
            )
            .agg(
                relationship_confidence=("relationship_confidence", "max"),
                first_seen_date=("first_seen_date", "min"),
                last_seen_date=("last_seen_date", "max"),
            )
            .sort_values(by=["child_uei", "parent_uei", "relationship_source"])
            .reset_index(drop=True)
        )
    else:
        relationships_df = pd.DataFrame(
            columns=[
                "child_uei",
                "parent_uei",
                "relationship_source",
                "relationship_confidence",
                "first_seen_date",
                "last_seen_date",
            ]
        )

    write_csv(relationships_df, relationships_csv)

    combined = pd.concat([df_parents[required_parent], df_children[required_child]], ignore_index=True)
    combined["uei_norm"] = combined["UEI"].apply(_clean_uei)
    combined = combined[combined["uei_norm"] != ""].copy()

    entity_rows: List[Dict[str, str]] = []
    for uei, group in combined.groupby("uei_norm", dropna=False):
        levels = [_clean_text(value).upper() for value in group["Recipient Level"].tolist() if _clean_text(value)]
        recipient_level = "P" if "P" in levels else _first_non_empty(group["Recipient Level"].tolist())

        entity_rows.append(
            {
                "uei": uei,
                "entity_name": _first_non_empty(group["Recipient Name"].tolist()),
                "duns": _first_non_empty([_clean_duns(value) for value in group["DUNS"].tolist()]),
                "recipient_level": recipient_level,
                "original_company_name": _first_non_empty(group["Original Company Name"].tolist()),
            }
        )

    entity_df = pd.DataFrame(entity_rows)
    if entity_df.empty:
        entity_df = pd.DataFrame(
            columns=["uei", "entity_name", "duns", "recipient_level", "original_company_name"]
        )

    # Ensure all parent/child UEIs from relationships exist in entity_master.
    if not relationships_df.empty:
        known = set(entity_df["uei"].tolist())
        for uei in pd.concat([relationships_df["child_uei"], relationships_df["parent_uei"]]).dropna().unique():
            uei_str = _clean_uei(uei)
            if uei_str and uei_str not in known:
                entity_df.loc[len(entity_df)] = {
                    "uei": uei_str,
                    "entity_name": "",
                    "duns": "",
                    "recipient_level": "",
                    "original_company_name": "",
                }
                known.add(uei_str)

    child_to_parent: Dict[str, List[Tuple[str, float]]] = defaultdict(list)
    if not relationships_df.empty:
        for _, rel in relationships_df.iterrows():
            child = _clean_uei(rel.get("child_uei"))
            parent = _clean_uei(rel.get("parent_uei"))
            if not child or not parent:
                continue
            try:
                confidence_value = float(rel.get("relationship_confidence", 0.0))
            except (TypeError, ValueError):
                confidence_value = 0.0
            child_to_parent[child].append((parent, confidence_value))

    def resolve_ultimate_parent(uei: str) -> str:
        seen: set[str] = set()
        current = uei
        while True:
            if current in seen:
                return uei
            seen.add(current)
            candidates = child_to_parent.get(current, [])
            if not candidates:
                return current
            # Deterministic pick when multiple parents exist: highest confidence first.
            candidates_sorted = sorted(candidates, key=lambda item: (-item[1], item[0]))
            next_parent = candidates_sorted[0][0]
            if not next_parent or next_parent == current:
                return current
            current = next_parent

    name_lookup = dict(zip(entity_df["uei"], entity_df["entity_name"]))
    entity_df["ultimate_parent_uei"] = entity_df["uei"].apply(resolve_ultimate_parent)
    entity_df["ultimate_parent_name"] = entity_df["ultimate_parent_uei"].apply(
        lambda value: name_lookup.get(value, "")
    )

    entity_df = entity_df[
        [
            "uei",
            "entity_name",
            "duns",
            "recipient_level",
            "original_company_name",
            "ultimate_parent_uei",
            "ultimate_parent_name",
        ]
    ].sort_values(by=["uei"]).reset_index(drop=True)
    write_csv(entity_df, entity_master_csv)
    return True


# =============================================================================
# STEP 1: BUILD PARENT COMPANIES
# This is the most complex step. For each company name in your Excel file, it:
#   1. Searches USAspending for matching recipients
#   2. Filters to only parent-level recipients (recipient_level == "P")
#   3. Uses fuzzy matching to rank the candidates
#   4. Outputs a CSV with match scores, review notes, and typo warnings
# =============================================================================

def build_parent_companies(
    api: ApiClient,
    company_names: List[str],
    output_csv: str,
    fuzzy_mode: str = "strict",
    fuzzy_threshold: float = 96.0,
    fuzzy_min_gap: float = 12.0,
    fuzzy_top_k: int = 3,
    parent_search_max_pages: int = 1,
) -> Optional[pd.DataFrame]:
    """For each company name, searches USAspending and finds the best-matching
    parent recipient. The fuzzy_mode controls how much human review is expected:

    - "off": Just dump all parent-level results, no scoring.
    - "assist": Show ALL candidates with scores and review notes, so a human
                can look through them and pick the right one.
    - "strict": Auto-pick the best match if confidence is high enough,
                otherwise mark it as ambiguous.

    Returns a DataFrame with the results, or None if something went wrong."""
    extracted: List[dict] = []
    fuzzy_mode = str(fuzzy_mode).strip().lower()

    for original_name in company_names:
        # Ask the API: "do you know any recipients matching this name?"
        results = fetch_parent_recipients(api, original_name, max_pages=parent_search_max_pages)

        # Case 1: The API returned nothing at all for this name.
        if not results:
            row = {
                "Original Company Name": original_name,
                "Recipient Name": "N/A",
                "DUNS": "N/A",
                "UEI": "N/A",
                "Recipient Level": "No Match",
            }
            if fuzzy_mode != "off":
                row.update(
                    {
                        "Match Mode": "none",
                        "Match Score": "",
                        "Match Reason": "",
                        "Candidate Rank": "",
                        "Top Candidate Gap": "",
                        "Top Candidates": "",
                        "Suggested Match": "",
                        "Potential Typo": "",
                        "Review Note": "",
                    }
                )
            extracted.append(row)
            continue

        # Case 2: We got results, but none of them are parent-level.
        parent_recipients = [item for item in results if item.get("recipient_level") == "P"]
        if not parent_recipients:
            row = {
                "Original Company Name": original_name,
                "Recipient Name": original_name,
                "DUNS": "N/A",
                "UEI": "N/A",
                "Recipient Level": "No Parent",
            }
            if fuzzy_mode != "off":
                row.update(
                    {
                        "Match Mode": "none",
                        "Match Score": "",
                        "Match Reason": "",
                        "Candidate Rank": "",
                        "Top Candidate Gap": "",
                        "Top Candidates": "",
                        "Suggested Match": "",
                        "Potential Typo": "",
                        "Review Note": "",
                    }
                )
            extracted.append(row)
            continue

        # Case 3: Fuzzy matching is OFF -- just include all parent results as-is.
        if fuzzy_mode == "off":
            for recipient in parent_recipients:
                extracted.append(
                    {
                        "Original Company Name": original_name,
                        "Recipient Name": recipient.get("name"),
                        "DUNS": recipient.get("duns"),
                        "UEI": recipient.get("uei"),
                        "Recipient Level": "P",
                    }
                )
            continue

        # Case 4: Fuzzy matching is ON -- score and rank all the candidates.
        # First pass: get a rough ranking using wratio.
        candidate_names = [str(recipient.get("name") or "") for recipient in parent_recipients]
        ranked_matches = extract(
            original_name,
            candidate_names,
            scorer=wratio,
            processor=process_company_name,
            limit=len(candidate_names),
            score_cutoff=0.0,
        )

        # Second pass: do a detailed scoring of each candidate.
        scored_candidates: List[Dict[str, Any]] = []
        for _, base_rank_score, idx in ranked_matches:
            recipient = parent_recipients[idx]
            detailed = score_parent_candidate(original_name, str(recipient.get("name") or ""))
            detailed["score"] = _clamp_score(max(detailed["score"], float(base_rank_score)))
            scored_candidates.append({"recipient": recipient, **detailed})
        scored_candidates.sort(key=lambda item: item["score"], reverse=True)

        # Figure out how confident we are in the top match.
        top_candidate = scored_candidates[0]
        second_score = scored_candidates[1]["score"] if len(scored_candidates) > 1 else None
        top_gap = top_candidate["score"] - second_score if second_score is not None else top_candidate["score"]
        # We're "confident" if the top score is above the threshold AND the gap
        # between #1 and #2 is big enough that they're not basically tied.
        confident_top = bool(top_candidate["score"] >= fuzzy_threshold and top_gap >= fuzzy_min_gap)
        top_summary = summarize_top_candidates(scored_candidates, fuzzy_top_k)
        has_exact = any(candidate["exact_match"] for candidate in scored_candidates)

        # ASSIST MODE: Include ALL candidates in the output with review columns.
        # The user is expected to look through these and verify the matches.
        if fuzzy_mode == "assist":
            for rank, candidate in enumerate(scored_candidates, start=1):
                recipient = candidate["recipient"]
                review_note = ""
                potential_typo = ""
                if rank == 1:
                    if has_exact:
                        review_note = "Exact normalized match found."
                    elif confident_top:
                        potential_typo = "Y"
                        review_note = "No exact match; top fuzzy candidate suggested."
                    else:
                        potential_typo = "Y"
                        review_note = "No exact match; ambiguous candidates. Review spelling."
                extracted.append(
                    {
                        "Original Company Name": original_name,
                        "Recipient Name": recipient.get("name"),
                        "DUNS": recipient.get("duns"),
                        "UEI": recipient.get("uei"),
                        "Recipient Level": "P",
                        "Match Mode": "assist",
                        "Match Score": round(candidate["score"], 2),
                        "Match Reason": candidate["reason"],
                        "Candidate Rank": rank,
                        "Top Candidate Gap": round(top_gap, 2) if rank == 1 else "",
                        "Top Candidates": top_summary if rank == 1 else "",
                        "Suggested Match": "Y" if rank == 1 and confident_top else "",
                        "Potential Typo": potential_typo,
                        "Review Note": review_note,
                    }
                )
            continue

        # STRICT MODE: Auto-select the best match if confident, otherwise mark ambiguous.
        exact_candidates = [candidate for candidate in scored_candidates if candidate["exact_match"]]
        if exact_candidates:
            # Found an exact match -- use it automatically.
            selected = exact_candidates[0]
            recipient = selected["recipient"]
            extracted.append(
                {
                    "Original Company Name": original_name,
                    "Recipient Name": recipient.get("name"),
                    "DUNS": recipient.get("duns"),
                    "UEI": recipient.get("uei"),
                    "Recipient Level": "P",
                    "Match Mode": "exact",
                    "Match Score": round(selected["score"], 2),
                    "Match Reason": selected["reason"],
                    "Candidate Rank": 1,
                    "Top Candidate Gap": round(top_gap, 2),
                    "Top Candidates": top_summary,
                    "Suggested Match": "Y",
                    "Potential Typo": "",
                    "Review Note": "Exact normalized match selected.",
                }
            )
            continue

        if confident_top:
            # No exact match, but the fuzzy match is strong enough to auto-select.
            recipient = top_candidate["recipient"]
            extracted.append(
                {
                    "Original Company Name": original_name,
                    "Recipient Name": recipient.get("name"),
                    "DUNS": recipient.get("duns"),
                    "UEI": recipient.get("uei"),
                    "Recipient Level": "P",
                    "Match Mode": "fuzzy",
                    "Match Score": round(top_candidate["score"], 2),
                    "Match Reason": top_candidate["reason"],
                    "Candidate Rank": 1,
                    "Top Candidate Gap": round(top_gap, 2),
                    "Top Candidates": top_summary,
                    "Suggested Match": "Y",
                    "Potential Typo": "Y",
                    "Review Note": "No exact match; high-confidence fuzzy match selected.",
                }
            )
        else:
            # Not confident enough to pick automatically. Flag for human review.
            extracted.append(
                {
                    "Original Company Name": original_name,
                    "Recipient Name": original_name,
                    "DUNS": "N/A",
                    "UEI": "N/A",
                    "Recipient Level": "Ambiguous",
                    "Match Mode": "ambiguous",
                    "Match Score": round(top_candidate["score"], 2),
                    "Match Reason": top_candidate["reason"],
                    "Candidate Rank": 1,
                    "Top Candidate Gap": round(top_gap, 2),
                    "Top Candidates": top_summary,
                    "Suggested Match": "",
                    "Potential Typo": "Y",
                    "Review Note": "No exact match; confidence too low for auto-selection.",
                }
            )

    df = pd.DataFrame(extracted)
    write_csv(df, output_csv)
    return df


# =============================================================================
# STEP 2: BUILD CHILD COMPANIES
# For each parent company found in Step 1, look up all their subsidiaries.
# =============================================================================

def fetch_child_recipients(api: ApiClient, parent_id: str, year: str = "latest") -> List[dict]:
    """Calls the USAspending API to get all child companies under a parent.
    The parent_id is usually a UEI (preferred) or DUNS number.

    The API can return either a list directly or a dict with a "results" key,
    so we handle both cases."""
    endpoint = f"/recipient/children/{parent_id}/"
    data = api.get(endpoint, {"year": year})
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        return data.get("results", [])
    return []


def build_child_companies(
    api: ApiClient, parent_csv: str, output_csv: str
) -> Optional[pd.DataFrame]:
    """Reads the parent companies CSV (from Step 1), and for each parent, looks up
    all their child/subsidiary companies. Saves the results to a new CSV.

    Each child gets tagged with the original company name and marked as level "C"
    (for child) so we can tell them apart from parents later."""
    try:
        df_parents = pd.read_csv(parent_csv)
    except FileNotFoundError:
        logger.error("Parent CSV not found: %s", parent_csv)
        return None

    required = ["Original Company Name", "Recipient Name", "DUNS", "UEI"]
    if not validate_required_columns(df_parents, required, "Children"):
        return None

    child_rows: List[dict] = []
    for _, row in df_parents.iterrows():
        parent_name = row["Recipient Name"]
        parent_duns = row["DUNS"]
        parent_uei = row["UEI"]

        # Figure out which ID to use. UEI is the newer, preferred identifier.
        # DUNS is the older one, used as a fallback.
        identifier = None
        if pd.notna(parent_uei) and str(parent_uei) != "N/A":
            identifier = str(parent_uei)
        elif pd.notna(parent_duns) and str(parent_duns) != "N/A":
            identifier = str(parent_duns)
        else:
            logger.info("Skipping %s: no identifier.", parent_name)
            continue

        children = fetch_child_recipients(api, identifier)
        for child in children:
            child_rows.append(
                {
                    "Original Company Name": row["Original Company Name"],
                    "Recipient Name": child.get("name"),
                    "DUNS": child.get("duns"),
                    "UEI": child.get("uei"),
                    "Recipient Level": "C",
                    # New schema support: keep explicit parent linkage so we can
                    # write normalized relationships.csv without JSON context blobs.
                    "Parent Recipient Name": parent_name,
                    "Parent UEI": parent_uei,
                    "Parent DUNS": parent_duns,
                }
            )
        # Small delay between API calls to be nice to the server.
        time.sleep(0.5)

    df_children = pd.DataFrame(child_rows)
    write_csv(df_children, output_csv)
    return df_children


# =============================================================================
# STEP 3: COMBINE PARENT + CHILD INTO A HIERARCHY
# Just stacks the parent and child CSVs on top of each other.
# =============================================================================

def combine_company_data(
    parent_csv: str, child_csv: str, output_csv: str
) -> Optional[pd.DataFrame]:
    """Reads both the parent and child CSVs and combines them into a single
    hierarchy file. This combined file is what the awards step uses to know
    which UEIs to search for."""
    try:
        df_parents = pd.read_csv(parent_csv)
        df_children = pd.read_csv(child_csv)
    except FileNotFoundError as exc:
        logger.error("Missing input CSV: %s", exc)
        return None

    desired = ["Original Company Name", "Recipient Name", "DUNS", "UEI", "Recipient Level"]
    if not validate_required_columns(df_parents, desired, "Combine"):
        return None
    if not validate_required_columns(df_children, desired, "Combine"):
        return None

    # Stack them together and only keep the columns we care about.
    combined = pd.concat([df_parents, df_children], ignore_index=True)
    combined = combined[desired]
    write_csv(combined, output_csv)
    return combined


# =============================================================================
# STEP 4: PULL AWARDS BY UEI
# This is the big data pull. For every unique UEI in the hierarchy, it queries
# USAspending for all their federal awards/contracts.
# =============================================================================

class AwardRequestError(RuntimeError):
    """Carries enough context to retry or audit a failed award request."""

    def __init__(
        self,
        uei: str,
        start_date: str,
        end_date: str,
        page: int,
        endpoint: str,
        original_error: BaseException,
    ) -> None:
        super().__init__(
            f"Award request failed for UEI {uei}, {start_date} to {end_date}, "
            f"page {page}: {original_error}"
        )
        self.uei = uei
        self.start_date = start_date
        self.end_date = end_date
        self.page = page
        self.endpoint = endpoint
        self.original_error = original_error


def build_date_windows(start_date: str, end_date: str, chunk_mode: str) -> List[Tuple[str, str]]:
    """Splits an award date range into smaller resumable windows."""
    start_dt = datetime.strptime(start_date, "%Y-%m-%d").date()
    end_dt = datetime.strptime(end_date, "%Y-%m-%d").date()
    chunk = str(chunk_mode).strip().lower()
    if chunk in {"all", "none", ""}:
        return [(start_date, end_date)]

    windows: List[Tuple[str, str]] = []
    current = start_dt
    while current <= end_dt:
        if chunk == "month":
            if current.month == 12:
                next_start = date(current.year + 1, 1, 1)
            else:
                next_start = date(current.year, current.month + 1, 1)
        elif chunk == "quarter":
            next_month = ((current.month - 1) // 3 + 1) * 3 + 1
            if next_month > 12:
                next_start = date(current.year + 1, 1, 1)
            else:
                next_start = date(current.year, next_month, 1)
        else:
            raise ValueError("workflow.award_date_chunk must be one of: month, quarter, all.")

        window_end = min(next_start - timedelta(days=1), end_dt)
        windows.append((current.strftime("%Y-%m-%d"), window_end.strftime("%Y-%m-%d")))
        current = next_start
    return windows


def filter_unique_uei(df: pd.DataFrame) -> pd.DataFrame:
    """Removes duplicate UEIs from a DataFrame. We only want to query each UEI
    once, even if it appears multiple times in the hierarchy (which it will if
    a company is both a parent of one search and a child of another)."""
    filtered = df[df["UEI"].notna() & (df["UEI"].astype(str).str.strip().str.upper() != "N/A")].copy()
    return filtered.drop_duplicates(subset=["UEI"], keep="first")


def fetch_awards_by_uei(
    api: ApiClient,
    uei: str,
    fields: List[str],
    start_date: str,
    end_date: str,
) -> Optional[pd.DataFrame]:
    """Pulls all awards for a specific UEI (Unique Entity Identifier).
    Similar to fetch_awards_by_company, but searches by UEI instead of name.

    After getting results, it does an exact-match filter on the UEI column to make
    sure we only keep awards that actually belong to this exact entity (the API's
    text search can sometimes return partial matches)."""
    endpoint = "/search/spending_by_award/"
    all_results: List[dict] = []
    page_number = 1

    # Make sure we're requesting the UEI column so we can filter on it.
    if "Recipient UEI" not in fields:
        fields = fields + ["Recipient UEI"]

    while True:
        payload = {
            "subawards": False,
            "limit": api.config.page_limit,
            "page": page_number,
            "filters": {
                "recipient_search_text": [uei],
                "time_period": [{"start_date": start_date, "end_date": end_date}],
                "category": "awards",
                "award_type_codes": ["A", "B", "C", "D"],
            },
            "fields": fields,
        }

        logger.info(
            "Fetching awards UEI=%s window=%s..%s page=%d",
            uei,
            start_date,
            end_date,
            page_number,
        )
        try:
            data = api.post(
                endpoint,
                payload,
                context={
                    "uei": uei,
                    "start_date": start_date,
                    "end_date": end_date,
                    "page": page_number,
                },
            )
        except Exception as exc:  # pylint: disable=broad-exception-caught
            raise AwardRequestError(uei, start_date, end_date, page_number, endpoint, exc) from exc
        results = data.get("results", [])
        if not results:
            break
        all_results.extend(results)

        if len(results) < api.config.page_limit:
            break
        page_number += 1
        time.sleep(api.config.page_pause_seconds)

    if not all_results:
        return None

    df = pd.DataFrame(all_results)
    if "Recipient UEI" not in df.columns:
        logger.warning("Recipient UEI column missing for %s.", uei)
        return None

    # Only keep rows where the UEI matches EXACTLY (case-insensitive).
    # The API search is fuzzy, so we might get results for similar UEIs.
    df_filtered = df[df["Recipient UEI"].astype(str).str.strip().str.upper() == uei.upper()]
    return df_filtered if not df_filtered.empty else None


def load_processed_ueis(path: str) -> set:
    """Looks at the existing awards CSV to see which UEIs we've already processed.
    This is the "resume" feature -- if you had to stop a long run and restart it,
    this prevents re-downloading data we already have."""
    if not os.path.exists(path):
        return set()
    try:
        df = pd.read_csv(path)
    except pd.errors.EmptyDataError:
        return set()
    if "recipient_uei" in df.columns:
        series = df["recipient_uei"]
    elif "Recipient UEI" in df.columns:
        series = df["Recipient UEI"]
    else:
        logger.warning("Existing %s missing recipient UEI column; starting fresh.", path)
        return set()
    return set(series.astype(str).str.strip().str.upper().unique())


def load_completed_award_windows(path: str) -> set:
    """Loads completed UEI/date windows from the award progress CSV."""
    if not os.path.exists(path):
        return set()
    try:
        df = pd.read_csv(path)
    except pd.errors.EmptyDataError:
        return set()
    required = {"uei", "start_date", "end_date", "status"}
    if not required.issubset(set(df.columns)):
        logger.warning("Existing %s missing progress columns; ignoring it.", path)
        return set()
    completed = df[df["status"].astype(str).str.lower() == "completed"]
    return {
        (
            _clean_uei(row.get("uei")),
            str(row.get("start_date")),
            str(row.get("end_date")),
        )
        for _, row in completed.iterrows()
        if _clean_uei(row.get("uei"))
    }


def build_award_fact_rows(
    df_awards: pd.DataFrame,
    uei: str,
    ultimate_parent_lookup: Dict[str, str],
) -> pd.DataFrame:
    """Transforms raw award rows into the normalized award_fact schema."""
    row_count = len(df_awards)

    def _award_series(column_name: str, default_value: Any = "") -> pd.Series:
        if column_name in df_awards.columns:
            return df_awards[column_name]
        return pd.Series([default_value] * row_count, index=df_awards.index)

    award_fact_df = pd.DataFrame(
        {
            "award_id": _award_series("Award ID"),
            "recipient_uei": _award_series("Recipient UEI"),
            "award_amount": _award_series("Award Amount"),
            "awarding_agency": _award_series("Awarding Agency"),
            "awarding_sub_agency": _award_series("Awarding Sub Agency"),
            "start_date": _award_series("Start Date"),
            "end_date": _award_series("End Date"),
        }
    )
    award_fact_df["recipient_uei"] = award_fact_df["recipient_uei"].apply(lambda value: _clean_uei(value) or uei)
    award_fact_df["ultimate_parent_uei"] = award_fact_df["recipient_uei"].apply(
        lambda value: ultimate_parent_lookup.get(value, value)
    )
    return award_fact_df[
        [
            "award_id",
            "recipient_uei",
            "ultimate_parent_uei",
            "award_amount",
            "awarding_agency",
            "awarding_sub_agency",
            "start_date",
            "end_date",
        ]
    ]


def process_hierarchy_for_awards(
    api: ApiClient,
    hierarchy_csv: str,
    fields: List[str],
    output_csv: str,
    entity_master_csv: str,
    start_date: str,
    end_date: str,
    throttle_after_n: int,
    throttle_pause: int,
    failed_requests_csv: str,
    award_progress_csv: str,
    run_log_csv: str,
    award_date_chunk: str,
) -> bool:
    """The main awards-pulling function. It:
    1. Reads the hierarchy CSV (from Step 3)
    2. Builds unique UEI/date-window jobs
    3. Skips completed windows using award_progress.csv
    4. Appends successful award rows to the normalized output CSV
    5. Writes failed request and run-summary logs for traceability

    Returns True if everything worked, False if there was a problem."""
    run_id = datetime.now().strftime("%Y%m%d_%H%M%S")
    started_at = timestamp_now()
    rows_written_total = 0
    successful_windows = 0
    failed_windows = 0
    attempted_windows = 0
    try_append_csv_row(
        run_log_csv,
        RUN_LOG_FIELDS,
        {
            "run_id": run_id,
            "step": "awards",
            "started_at": started_at,
            "finished_at": "",
            "status": "started",
            "total_ueis": "",
            "total_windows": "",
            "completed_windows_at_start": "",
            "attempted_windows": 0,
            "successful_windows": 0,
            "failed_windows": 0,
            "rows_written": 0,
            "output_csv": output_csv,
            "failed_requests_csv": failed_requests_csv,
            "progress_csv": award_progress_csv,
        },
        "run",
    )

    try:
        hierarchy_df = pd.read_csv(hierarchy_csv)
    except FileNotFoundError:
        logger.error("Hierarchy CSV not found: %s", hierarchy_csv)
        return False

    required = ["Original Company Name", "Recipient Name", "UEI", "Recipient Level"]
    if not validate_required_columns(hierarchy_df, required, "Awards"):
        return False

    unique_ueis = sorted({_clean_uei(uei) for uei in hierarchy_df["UEI"].tolist() if _clean_uei(uei)})
    if not unique_ueis:
        logger.info("No valid UEIs found in hierarchy.")
        return True

    date_windows = build_date_windows(start_date, end_date, award_date_chunk)
    completed_windows = load_completed_award_windows(award_progress_csv)
    output_has_rows = os.path.exists(output_csv) and os.path.getsize(output_csv) > 0
    if completed_windows and not output_has_rows:
        logger.warning(
            "Found %d completed award windows in %s, but %s is missing or empty. "
            "Ignoring award progress so the awards output can be rebuilt.",
            len(completed_windows),
            award_progress_csv,
            output_csv,
        )
        completed_windows = set()
    legacy_processed_ueis = load_processed_ueis(output_csv) if not completed_windows else set()
    jobs = []
    for uei in unique_ueis:
        for window_start, window_end in date_windows:
            job_key = (uei.strip().upper(), window_start, window_end)
            if job_key in completed_windows:
                continue
            if legacy_processed_ueis and uei.strip().upper() in legacy_processed_ueis:
                continue
            jobs.append((uei, window_start, window_end))

    total_windows = len(unique_ueis) * len(date_windows)
    skipped_windows = total_windows - len(jobs)
    logger.info(
        "Award resume summary: %d UEIs, %d date windows each, %d total windows, %d complete/skipped, %d remaining.",
        len(unique_ueis),
        len(date_windows),
        total_windows,
        skipped_windows,
        len(jobs),
    )
    if legacy_processed_ueis:
        logger.info(
            "Found existing %s without progress metadata; treating %d UEIs already present in output as complete.",
            output_csv,
            len(legacy_processed_ueis),
        )
    if not jobs:
        logger.info("No award windows to process.")
        try_append_csv_row(
            run_log_csv,
            RUN_LOG_FIELDS,
            {
                "run_id": run_id,
                "step": "awards",
                "started_at": started_at,
                "finished_at": timestamp_now(),
                "status": "completed",
                "total_ueis": len(unique_ueis),
                "total_windows": total_windows,
                "completed_windows_at_start": skipped_windows,
                "attempted_windows": 0,
                "successful_windows": 0,
                "failed_windows": 0,
                "rows_written": 0,
                "output_csv": output_csv,
                "failed_requests_csv": failed_requests_csv,
                "progress_csv": award_progress_csv,
            },
            "run",
        )
        print(
            "\nAwards completed. No award windows remain to process.\n\n"
            "Confirm final state:\n"
            f"python -c \"import pandas as pd; print(pd.read_csv(r'{run_log_csv}').tail(1).T)\"\n"
        )
        return True

    # New schema support: read ultimate parent mapping produced by combine step.
    ultimate_parent_lookup: Dict[str, str] = {}
    if os.path.exists(entity_master_csv):
        try:
            entity_df = pd.read_csv(entity_master_csv)
            if validate_required_columns(entity_df, ["uei", "ultimate_parent_uei"], "AwardsEntityMaster"):
                for _, row in entity_df.iterrows():
                    entity_uei = _clean_uei(row.get("uei"))
                    ultimate_uei = _clean_uei(row.get("ultimate_parent_uei"))
                    if entity_uei:
                        ultimate_parent_lookup[entity_uei] = ultimate_uei or entity_uei
        except Exception as exc:  # pylint: disable=broad-exception-caught
            logger.warning("Unable to load entity master mapping from %s: %s", entity_master_csv, exc)

    # Thread safety: we use a lock to make sure only one thread writes to the
    # CSV file at a time. Without this, the file could get corrupted.
    csv_lock = threading.Lock()
    header_written = os.path.exists(output_csv) and os.path.getsize(output_csv) > 0

    for uei, window_start, window_end in jobs:
        attempted_windows += 1
        try:
            df_awards = fetch_awards_by_uei(api, uei, fields, window_start, window_end)
            rows_written = 0
            if df_awards is not None and not df_awards.empty:
                award_fact_df = build_award_fact_rows(df_awards, uei, ultimate_parent_lookup)
                rows_written = len(award_fact_df)
                with csv_lock:
                    write_header = not header_written
                    award_fact_df.to_csv(output_csv, mode="a", header=write_header, index=False)
                    header_written = True
                rows_written_total += rows_written
                logger.info(
                    "Appended %d award_fact rows for UEI=%s window=%s..%s",
                    rows_written,
                    uei,
                    window_start,
                    window_end,
                )
            else:
                logger.info("No awards for UEI=%s window=%s..%s", uei, window_start, window_end)

            try_append_csv_row(
                award_progress_csv,
                AWARD_PROGRESS_FIELDS,
                {
                    "timestamp": timestamp_now(),
                    "run_id": run_id,
                    "uei": uei,
                    "start_date": window_start,
                    "end_date": window_end,
                    "status": "completed",
                    "rows_written": rows_written,
                    "output_csv": output_csv,
                },
                "award progress",
            )
            successful_windows += 1
        except AwardRequestError as exc:
            failed_windows += 1
            logger.error("Error processing award window: %s", exc)
            try_append_csv_row(
                failed_requests_csv,
                FAILED_AWARD_REQUEST_FIELDS,
                {
                    "timestamp": timestamp_now(),
                    "run_id": run_id,
                    "uei": exc.uei,
                    "start_date": exc.start_date,
                    "end_date": exc.end_date,
                    "page": exc.page,
                    "endpoint": exc.endpoint,
                    "error_type": type(exc.original_error).__name__,
                    "error_message": str(exc.original_error),
                    "retry_status": "pending",
                },
                "failed award request",
            )
        except Exception as exc:  # pylint: disable=broad-exception-caught
            failed_windows += 1
            logger.error("Unexpected error processing UEI=%s window=%s..%s: %s", uei, window_start, window_end, exc)
            try_append_csv_row(
                failed_requests_csv,
                FAILED_AWARD_REQUEST_FIELDS,
                {
                    "timestamp": timestamp_now(),
                    "run_id": run_id,
                    "uei": uei,
                    "start_date": window_start,
                    "end_date": window_end,
                    "page": "",
                    "endpoint": "/search/spending_by_award/",
                    "error_type": type(exc).__name__,
                    "error_message": str(exc),
                    "retry_status": "pending",
                },
                "failed award request",
            )

        if throttle_after_n > 0 and attempted_windows % throttle_after_n == 0:
            logger.info("Throttling for %ds after %d award windows.", throttle_pause, attempted_windows)
            time.sleep(throttle_pause)

    status = "completed" if failed_windows == 0 else "partial_failure"
    try_append_csv_row(
        run_log_csv,
        RUN_LOG_FIELDS,
        {
            "run_id": run_id,
            "step": "awards",
            "started_at": started_at,
            "finished_at": timestamp_now(),
            "status": status,
            "total_ueis": len(unique_ueis),
            "total_windows": total_windows,
            "completed_windows_at_start": skipped_windows,
            "attempted_windows": attempted_windows,
            "successful_windows": successful_windows,
            "failed_windows": failed_windows,
            "rows_written": rows_written_total,
            "output_csv": output_csv,
            "failed_requests_csv": failed_requests_csv,
            "progress_csv": award_progress_csv,
        },
        "run",
    )
    logger.info(
        "Awards run summary: status=%s attempted=%d succeeded=%d failed=%d rows_written=%d",
        status,
        attempted_windows,
        successful_windows,
        failed_windows,
        rows_written_total,
    )
    script_name = os.path.basename(sys.argv[0]) or "usaspending_data_pull_refined.py"
    if failed_windows:
        logger.error(
            "Awards finished with %d failed window(s). Successful windows were saved in %s. "
            "Inspect %s for the failed UEI/date windows, then rerun only the awards step: "
            "python %s --step awards",
            failed_windows,
            award_progress_csv,
            failed_requests_csv,
            script_name,
        )
        print(
            "\nAwards finished with failed windows.\n\n"
            "Next command to retry only failed/incomplete award windows:\n"
            f"python {script_name} --step awards\n\n"
            "Check latest run summary:\n"
            f"python -c \"import pandas as pd; print(pd.read_csv(r'{run_log_csv}').tail(1).T)\"\n\n"
            "Check failed award requests:\n"
            f"python -c \"import pandas as pd; print(pd.read_csv(r'{failed_requests_csv}').tail())\"\n"
        )
    else:
        print(
            "\nAwards completed.\n\n"
            "Confirm final state:\n"
            f"python -c \"import pandas as pd; print(pd.read_csv(r'{run_log_csv}').tail(1).T)\"\n"
        )
    return failed_windows == 0


# =============================================================================
# ANALYSIS: ACTIVE AWARDS BY MONTH
# A bonus analysis function that counts how many awards are active for a given
# company in each month. Useful for seeing trends over time.
# =============================================================================

def analyze_active_awards_by_month(
    award_fact_csv: str, entity_master_csv: str, company_name: str
) -> Optional[pd.DataFrame]:
    """Reads normalized award/entity tables and counts how many awards are active
    (between their start and end dates) for each month for a specific company.

    This is useful for answering questions like: "How many active contracts does
    Raytheon have each month?" or "Are their contracts increasing or decreasing?"

    Returns a DataFrame with columns: Month, Active Awards Count."""
    try:
        df_awards = pd.read_csv(
            award_fact_csv,
            dtype={
                "award_id": str,
                "recipient_uei": str,
                "ultimate_parent_uei": str,
                "start_date": str,
                "end_date": str,
            },
        )
    except FileNotFoundError:
        logger.error("Award fact CSV not found: %s", award_fact_csv)
        return None

    try:
        entity_df = pd.read_csv(entity_master_csv, dtype={"uei": str, "entity_name": str, "original_company_name": str})
    except FileNotFoundError:
        logger.error("Entity master CSV not found: %s", entity_master_csv)
        return None

    required_awards = ["award_id", "ultimate_parent_uei", "start_date", "end_date"]
    required_entities = ["uei", "entity_name", "original_company_name", "ultimate_parent_uei"]
    if not validate_required_columns(df_awards, required_awards, "AnalyzeAwards"):
        return None
    if not validate_required_columns(entity_df, required_entities, "AnalyzeEntityMaster"):
        return None

    company_key = company_name.strip().casefold()
    if not company_key:
        logger.error("Company name cannot be empty.")
        return None

    matched_entities = entity_df[
        entity_df["original_company_name"].fillna("").astype(str).str.strip().str.casefold().eq(company_key)
        | entity_df["entity_name"].fillna("").astype(str).str.strip().str.casefold().eq(company_key)
    ].copy()
    if matched_entities.empty:
        logger.info("No entity_master match found for %s", company_name)
        return None

    target_ultimate_ueis = {
        _clean_uei(value)
        for value in pd.concat([matched_entities["ultimate_parent_uei"], matched_entities["uei"]]).tolist()
        if _clean_uei(value)
    }
    if not target_ultimate_ueis:
        logger.info("No valid UEIs resolved for %s", company_name)
        return None

    df_awards = df_awards.copy()
    df_awards["ultimate_parent_uei"] = df_awards["ultimate_parent_uei"].apply(_clean_uei)
    df_filtered = df_awards[df_awards["ultimate_parent_uei"].isin(target_ultimate_ueis)].copy()

    if df_filtered.empty:
        logger.info("No awards found for %s", company_name)
        return None

    # Remove duplicate Award IDs so each award is counted once.
    df_deduped = df_filtered.drop_duplicates(subset=["award_id"], keep="first").copy()

    # Convert date strings to actual datetime objects so we can do math with them.
    df_deduped["Start_Parsed"] = pd.to_datetime(df_deduped["start_date"], format="%Y-%m-%d", errors="coerce")
    df_deduped["End_Parsed"] = pd.to_datetime(df_deduped["end_date"], format="%Y-%m-%d", errors="coerce")

    # If an award doesn't have an end date, assume it's active for another year.
    fallback_end = pd.Timestamp(date.today() + timedelta(days=365))
    df_deduped["End_Parsed"] = df_deduped["End_Parsed"].fillna(fallback_end)

    # Drop awards with no valid start date (can't count them without knowing when they started).
    df_deduped = df_deduped.dropna(subset=["Start_Parsed"])
    if df_deduped.empty:
        logger.info("No valid dates for %s", company_name)
        return None

    # Convert dates to month periods (e.g., 2025-03-15 becomes 2025-03).
    df_deduped["Start_Month"] = df_deduped["Start_Parsed"].dt.to_period("M")
    df_deduped["End_Month"] = df_deduped["End_Parsed"].dt.to_period("M")

    # Build a list of every month from the earliest start to the latest end.
    min_period = df_deduped["Start_Month"].min()
    max_period = max(df_deduped["End_Month"].max(), pd.Timestamp(date.today()).to_period("M"))
    all_months = pd.period_range(start=min_period, end=max_period, freq="M")

    # For each month, count how many awards are active (started on or before
    # this month AND ending on or after this month).
    counts = []
    for month in all_months:
        count = int(((df_deduped["Start_Month"] <= month) & (df_deduped["End_Month"] >= month)).sum())
        counts.append({"Month": str(month), "Active Awards Count": count})

    result = pd.DataFrame(counts)
    return result.reset_index(drop=True)


# =============================================================================
# POWER BI READABLE EXPORTS
# =============================================================================

def build_powerbi_readable_exports(
    entity_master_csv: str,
    award_fact_csv: str,
    relationships_csv: str,
    output_dir: str,
    powerbi_entity_master_csv: str,
    award_fact_readable_csv: str,
    relationships_readable_csv: str,
) -> bool:
    """Creates dashboard-friendly readable CSVs from the normalized model.

    The normalized files remain the source of truth. These exports add company
    names to fact/relationship rows so analysts can build quick visuals without
    recreating the same joins in notebooks or Power Query.
    """
    try:
        entities_df = pd.read_csv(entity_master_csv, dtype=str).fillna("")
    except FileNotFoundError:
        logger.error("Entity master CSV not found: %s", entity_master_csv)
        return False
    except pd.errors.EmptyDataError:
        logger.error("Entity master CSV is empty: %s", entity_master_csv)
        return False

    if not validate_required_columns(entities_df, ["uei", "entity_name"], "PowerBIEntityMaster"):
        return False

    os.makedirs(output_dir, exist_ok=True)
    exports: List[Dict[str, Any]] = []

    entity_output_path = os.path.join(output_dir, powerbi_entity_master_csv)
    entities_df.to_csv(entity_output_path, index=False)
    exports.append({"file": entity_output_path, "rows": len(entities_df)})

    entity_names = entities_df[["uei", "entity_name"]].drop_duplicates()

    try:
        awards_df = pd.read_csv(award_fact_csv, dtype=str).fillna("")
    except FileNotFoundError:
        logger.error("Award fact CSV not found: %s", award_fact_csv)
        return False
    except pd.errors.EmptyDataError:
        awards_df = pd.DataFrame(
            columns=[
                "award_id",
                "recipient_uei",
                "ultimate_parent_uei",
                "award_amount",
                "awarding_agency",
                "awarding_sub_agency",
                "start_date",
                "end_date",
            ]
        )

    if not validate_required_columns(awards_df, ["recipient_uei", "ultimate_parent_uei"], "PowerBIAwards"):
        return False

    recipient_names = entity_names.rename(columns={"uei": "recipient_uei", "entity_name": "recipient_name"})
    parent_names = entity_names.rename(
        columns={"uei": "ultimate_parent_uei", "entity_name": "ultimate_parent_name"}
    )
    award_readable_df = awards_df.merge(recipient_names, on="recipient_uei", how="left")
    award_readable_df = award_readable_df.merge(parent_names, on="ultimate_parent_uei", how="left")
    award_output_path = os.path.join(output_dir, award_fact_readable_csv)
    award_readable_df.to_csv(award_output_path, index=False)
    exports.append({"file": award_output_path, "rows": len(award_readable_df)})

    try:
        relationships_df = pd.read_csv(relationships_csv, dtype=str).fillna("")
    except FileNotFoundError:
        logger.error("Relationships CSV not found: %s", relationships_csv)
        return False
    except pd.errors.EmptyDataError:
        relationships_df = pd.DataFrame(
            columns=[
                "child_uei",
                "parent_uei",
                "relationship_source",
                "relationship_confidence",
                "first_seen_date",
                "last_seen_date",
            ]
        )

    if not validate_required_columns(relationships_df, ["child_uei", "parent_uei"], "PowerBIRelationships"):
        return False

    child_names = entity_names.rename(columns={"uei": "child_uei", "entity_name": "child_name"})
    relationship_parent_names = entity_names.rename(columns={"uei": "parent_uei", "entity_name": "parent_name"})
    relationships_readable_df = relationships_df.merge(child_names, on="child_uei", how="left")
    relationships_readable_df = relationships_readable_df.merge(relationship_parent_names, on="parent_uei", how="left")
    relationships_output_path = os.path.join(output_dir, relationships_readable_csv)
    relationships_readable_df.to_csv(relationships_output_path, index=False)
    exports.append({"file": relationships_output_path, "rows": len(relationships_readable_df)})

    logger.info("Power BI readable exports written to %s", output_dir)
    for export in exports:
        logger.info("  %s rows=%s", export["file"], export["rows"])

    print("\nPower BI readable exports created:")
    for export in exports:
        print(f"{export['file']} ({export['rows']} rows)")
    return True


# =============================================================================
# CLI (COMMAND LINE INTERFACE)
# This section defines what command-line arguments the script accepts and how
# each "step" gets wired up to the functions above.
# =============================================================================

def build_cli_parser() -> argparse.ArgumentParser:
    """Builds the command-line argument parser. This defines all the flags you
    can pass when running the script, like --step, --input, --start-date, etc."""
    parser = argparse.ArgumentParser(description="USAspending workflow (refined)")
    parser.add_argument(
        "--step",
        required=True,
        choices=["parents", "children", "combine", "awards", "powerbi-exports", "analyze", "all"],
    )
    parser.add_argument(
        "--config",
        default="config/config.json",
        help="Path to JSON config file (defaults to config/config.json).",
    )
    parser.add_argument(
        "--input",
        help="Path to company names Excel file (overrides config/env for parents step).",
    )
    parser.add_argument("--start-date", help="Award query start date (YYYY-MM-DD).")
    parser.add_argument("--end-date", help="Award query end date (YYYY-MM-DD or 'now').")
    parser.add_argument(
        "--state-file",
        default=".usaspending_state.json",
        help="Path to lightweight runtime state file for last-used values.",
    )
    parser.add_argument(
        "--non-interactive",
        action="store_true",
        help="Never prompt for missing input paths; fail fast instead.",
    )
    parser.add_argument(
        "--company",
        help="Company name for the analyze step (overrides config analysis.default_company_name).",
    )
    return parser


def main() -> int:
    """The main entry point. This is what runs when you execute the script.
    It handles:
    1. Setting up logging so you can see what's happening
    2. Loading and merging config from all sources (file, env vars, CLI flags)
    3. Validating all the settings
    4. Running the requested step (or all steps if --step all)
    5. Saving state for next time"""

    # Set up logging so all our logger.info/warning/error calls actually show up.
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    parser = build_cli_parser()
    args = parser.parse_args()

    try:
        # --- LOAD CONFIG ---
        # Read config.json and merge it with built-in defaults.
        raw_config = load_config(args.config)
        api_values = raw_config.get("api", {})
        workflow_values = raw_config.get("workflow", {})
        fields_values = raw_config.get("fields", {})

        if not isinstance(api_values, dict) or not isinstance(workflow_values, dict):
            raise ValueError("Config sections 'api' and 'workflow' must be JSON objects.")

        # --- APPLY ENVIRONMENT VARIABLE OVERRIDES ---
        # These let you configure the script via env vars (useful for CI/CD).
        env_overrides = {
            "company_names_excel": os.getenv("USASPENDING_COMPANY_NAMES_EXCEL"),
            "start_date": os.getenv("USASPENDING_START_DATE"),
            "end_date": os.getenv("USASPENDING_END_DATE"),
            "parent_companies_csv": os.getenv("USASPENDING_PARENT_CSV"),
            "child_companies_csv": os.getenv("USASPENDING_CHILD_CSV"),
            "hierarchy_csv": os.getenv("USASPENDING_HIERARCHY_CSV"),
            "awards_csv": os.getenv("USASPENDING_AWARDS_CSV"),
            "entity_master_csv": os.getenv("USASPENDING_ENTITY_MASTER_CSV"),
            "relationships_csv": os.getenv("USASPENDING_RELATIONSHIPS_CSV"),
            "award_fact_csv": os.getenv("USASPENDING_AWARD_FACT_CSV"),
            "failed_award_requests_csv": os.getenv("USASPENDING_FAILED_AWARD_REQUESTS_CSV"),
            "award_request_log_csv": os.getenv("USASPENDING_AWARD_REQUEST_LOG_CSV"),
            "award_progress_csv": os.getenv("USASPENDING_AWARD_PROGRESS_CSV"),
            "run_log_csv": os.getenv("USASPENDING_RUN_LOG_CSV"),
            "powerbi_output_dir": os.getenv("USASPENDING_POWERBI_OUTPUT_DIR"),
            "powerbi_entity_master_csv": os.getenv("USASPENDING_POWERBI_ENTITY_MASTER_CSV"),
            "award_fact_readable_csv": os.getenv("USASPENDING_AWARD_FACT_READABLE_CSV"),
            "relationships_readable_csv": os.getenv("USASPENDING_RELATIONSHIPS_READABLE_CSV"),
            "award_date_chunk": os.getenv("USASPENDING_AWARD_DATE_CHUNK"),
            "fuzzy_mode": os.getenv("USASPENDING_FUZZY_MODE"),
            "fuzzy_threshold": os.getenv("USASPENDING_FUZZY_THRESHOLD"),
            "fuzzy_min_gap": os.getenv("USASPENDING_FUZZY_MIN_GAP"),
            "fuzzy_top_k": os.getenv("USASPENDING_FUZZY_TOP_K"),
            "parent_search_max_pages": os.getenv("USASPENDING_PARENT_SEARCH_MAX_PAGES"),
        }
        for key, value in env_overrides.items():
            if value:
                workflow_values[key] = value

        # --- APPLY CLI FLAG OVERRIDES ---
        # CLI flags have the highest priority.
        if args.start_date:
            workflow_values["start_date"] = args.start_date
        if args.end_date:
            workflow_values["end_date"] = args.end_date

        # --- TYPE COERCION AND VALIDATION ---
        # Config values might come as strings (from JSON or env vars). We need to
        # convert them to the right types (int, float) and validate they're in range.
        api_values["timeout_seconds"] = coerce_int(
            api_values.get("timeout_seconds", ApiConfig().timeout_seconds), "api.timeout_seconds"
        )
        api_values["connect_timeout_seconds"] = coerce_int(
            api_values.get("connect_timeout_seconds", ApiConfig().connect_timeout_seconds),
            "api.connect_timeout_seconds",
        )
        api_values["read_timeout_seconds"] = coerce_int(
            api_values.get("read_timeout_seconds", ApiConfig().read_timeout_seconds),
            "api.read_timeout_seconds",
        )
        api_values["max_retries"] = coerce_int(
            api_values.get("max_retries", ApiConfig().max_retries), "api.max_retries"
        )
        api_values["retry_delay_seconds"] = coerce_float(
            api_values.get("retry_delay_seconds", ApiConfig().retry_delay_seconds),
            "api.retry_delay_seconds",
        )
        api_values["retry_backoff_multiplier"] = coerce_float(
            api_values.get("retry_backoff_multiplier", ApiConfig().retry_backoff_multiplier),
            "api.retry_backoff_multiplier",
        )
        api_values["retry_max_delay_seconds"] = coerce_float(
            api_values.get("retry_max_delay_seconds", ApiConfig().retry_max_delay_seconds),
            "api.retry_max_delay_seconds",
        )
        api_values["retry_jitter_seconds"] = coerce_float(
            api_values.get("retry_jitter_seconds", ApiConfig().retry_jitter_seconds),
            "api.retry_jitter_seconds",
        )
        api_values["page_pause_seconds"] = coerce_float(
            api_values.get("page_pause_seconds", ApiConfig().page_pause_seconds),
            "api.page_pause_seconds",
        )
        api_values["page_limit"] = coerce_int(
            api_values.get("page_limit", ApiConfig().page_limit), "api.page_limit"
        )
        workflow_values["throttle_after_n_ueis"] = coerce_int(
            workflow_values.get("throttle_after_n_ueis", WorkflowConfig().throttle_after_n_ueis),
            "workflow.throttle_after_n_ueis",
        )
        workflow_values["throttle_pause_seconds"] = coerce_int(
            workflow_values.get("throttle_pause_seconds", WorkflowConfig().throttle_pause_seconds),
            "workflow.throttle_pause_seconds",
        )
        workflow_values["fuzzy_threshold"] = coerce_float(
            workflow_values.get("fuzzy_threshold", WorkflowConfig().fuzzy_threshold),
            "workflow.fuzzy_threshold",
        )
        workflow_values["fuzzy_min_gap"] = coerce_float(
            workflow_values.get("fuzzy_min_gap", WorkflowConfig().fuzzy_min_gap),
            "workflow.fuzzy_min_gap",
        )
        workflow_values["fuzzy_top_k"] = coerce_int(
            workflow_values.get("fuzzy_top_k", WorkflowConfig().fuzzy_top_k),
            "workflow.fuzzy_top_k",
        )
        workflow_values["parent_search_max_pages"] = coerce_int(
            workflow_values.get("parent_search_max_pages", WorkflowConfig().parent_search_max_pages),
            "workflow.parent_search_max_pages",
        )
        workflow_values["fuzzy_mode"] = str(
            workflow_values.get("fuzzy_mode", WorkflowConfig().fuzzy_mode)
        ).strip().lower()
        workflow_values["award_date_chunk"] = str(
            workflow_values.get("award_date_chunk", WorkflowConfig().award_date_chunk)
        ).strip().lower()

        # Sanity checks to make sure the config values make sense.
        if api_values["timeout_seconds"] <= 0:
            raise ValueError("api.timeout_seconds must be > 0.")
        if api_values["connect_timeout_seconds"] <= 0:
            raise ValueError("api.connect_timeout_seconds must be > 0.")
        if api_values["read_timeout_seconds"] <= 0:
            raise ValueError("api.read_timeout_seconds must be > 0.")
        if api_values["max_retries"] < 1:
            raise ValueError("api.max_retries must be >= 1.")
        if api_values["retry_delay_seconds"] < 0:
            raise ValueError("api.retry_delay_seconds must be >= 0.")
        if api_values["retry_backoff_multiplier"] < 1:
            raise ValueError("api.retry_backoff_multiplier must be >= 1.")
        if api_values["retry_max_delay_seconds"] < 0:
            raise ValueError("api.retry_max_delay_seconds must be >= 0.")
        if api_values["retry_jitter_seconds"] < 0:
            raise ValueError("api.retry_jitter_seconds must be >= 0.")
        if api_values["page_pause_seconds"] < 0:
            raise ValueError("api.page_pause_seconds must be >= 0.")
        if api_values["page_limit"] < 1:
            raise ValueError("api.page_limit must be >= 1.")
        if workflow_values["throttle_after_n_ueis"] < 0:
            raise ValueError("workflow.throttle_after_n_ueis must be >= 0.")
        if workflow_values["throttle_pause_seconds"] < 0:
            raise ValueError("workflow.throttle_pause_seconds must be >= 0.")
        if workflow_values["parent_search_max_pages"] < 1:
            raise ValueError("workflow.parent_search_max_pages must be >= 1.")
        if workflow_values["fuzzy_top_k"] < 1:
            raise ValueError("workflow.fuzzy_top_k must be >= 1.")
        if not 0 <= workflow_values["fuzzy_threshold"] <= 100:
            raise ValueError("workflow.fuzzy_threshold must be between 0 and 100.")
        if not 0 <= workflow_values["fuzzy_min_gap"] <= 100:
            raise ValueError("workflow.fuzzy_min_gap must be between 0 and 100.")
        if workflow_values["fuzzy_mode"] not in {"off", "assist", "strict"}:
            raise ValueError("workflow.fuzzy_mode must be one of: off, assist, strict.")
        if workflow_values["award_date_chunk"] not in {"month", "quarter", "all"}:
            raise ValueError("workflow.award_date_chunk must be one of: month, quarter, all.")

        # Clean up date values ("now" -> today's date, validate format).
        workflow_values["start_date"] = normalize_date_value(
            workflow_values.get("start_date"), "2025-01-01"
        )
        workflow_values["end_date"] = normalize_date_value(
            workflow_values.get("end_date"), "now"
        )
        start_dt = datetime.strptime(workflow_values["start_date"], "%Y-%m-%d").date()
        end_dt = datetime.strptime(workflow_values["end_date"], "%Y-%m-%d").date()
        if start_dt > end_dt:
            raise ValueError("start_date cannot be after end_date.")

        # --- BUILD OBJECTS ---
        # Now that config is validated, create the objects we'll use.
        api_config = dataclass_from_mapping(ApiConfig, api_values)
        workflow = dataclass_from_mapping(WorkflowConfig, workflow_values)
        api = ApiClient(api_config, request_log_csv=workflow.award_request_log_csv)

        # Which fields to request from the awards API. Can be customized in config.
        default_award_fields = [
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
        awards_fields = default_award_fields
        if isinstance(fields_values, dict) and isinstance(fields_values.get("awards"), list):
            configured_fields = [str(item) for item in fields_values["awards"] if str(item).strip()]
            if configured_fields:
                awards_fields = configured_fields

        state = load_state_file(args.state_file)
        analysis_values = raw_config.get("analysis", {})

        # --- STEP FUNCTIONS ---
        # Each step is wrapped in a small function that returns True/False.

        def run_parents() -> bool:
            """Step 1: Find parent companies for each name in the Excel file."""
            excel_path = resolve_company_names_excel(
                args.input, workflow.company_names_excel, state, args.non_interactive
            )
            names = read_company_names(excel_path)
            df = build_parent_companies(
                api,
                names,
                workflow.parent_companies_csv,
                fuzzy_mode=workflow.fuzzy_mode,
                fuzzy_threshold=workflow.fuzzy_threshold,
                fuzzy_min_gap=workflow.fuzzy_min_gap,
                fuzzy_top_k=workflow.fuzzy_top_k,
                parent_search_max_pages=workflow.parent_search_max_pages,
            )
            if df is None:
                return False
            state["last_company_names_excel"] = excel_path
            return True

        def run_children() -> bool:
            """Step 2: Find child/subsidiary companies for each parent."""
            df = build_child_companies(api, workflow.parent_companies_csv, workflow.child_companies_csv)
            return df is not None

        def run_combine() -> bool:
            """Step 3: Merge parents + children into a single hierarchy CSV."""
            df = combine_company_data(
                workflow.parent_companies_csv, workflow.child_companies_csv, workflow.hierarchy_csv
            )
            if df is None:
                return False
            return build_normalized_schema(
                workflow.parent_companies_csv,
                workflow.child_companies_csv,
                workflow.entity_master_csv,
                workflow.relationships_csv,
            )

        def run_awards() -> bool:
            """Step 4: Pull all awards and write normalized award_fact rows."""
            return process_hierarchy_for_awards(
                api,
                workflow.hierarchy_csv,
                awards_fields,
                workflow.award_fact_csv,
                workflow.entity_master_csv,
                workflow.start_date,
                workflow.end_date,
                workflow.throttle_after_n_ueis,
                workflow.throttle_pause_seconds,
                workflow.failed_award_requests_csv,
                workflow.award_progress_csv,
                workflow.run_log_csv,
                workflow.award_date_chunk,
            )

        def run_powerbi_exports() -> bool:
            """Step 5: Create readable Power BI export files from normalized outputs."""
            return build_powerbi_readable_exports(
                workflow.entity_master_csv,
                workflow.award_fact_csv,
                workflow.relationships_csv,
                workflow.powerbi_output_dir,
                workflow.powerbi_entity_master_csv,
                workflow.award_fact_readable_csv,
                workflow.relationships_readable_csv,
            )

        def run_analyze() -> bool:
            """Bonus step: Count active awards per month for a specific company."""
            company = (
                args.company
                or analysis_values.get("default_company_name", "")
            )
            if not company:
                logger.error("No company name provided. Use --company or set analysis.default_company_name in config.")
                return False
            result = analyze_active_awards_by_month(
                workflow.award_fact_csv,
                workflow.entity_master_csv,
                company,
            )
            if result is not None:
                print(result.to_string(index=False))
                return True
            return False

        steps = {
            "parents": run_parents,
            "children": run_children,
            "combine": run_combine,
            "awards": run_awards,
            "powerbi-exports": run_powerbi_exports,
            "analyze": run_analyze,
        }

        # --- RUN THE REQUESTED STEP(S) ---
        if args.step == "all":
            # Run all main production steps in order. Stop if any step fails.
            for step_name in ["parents", "children", "combine", "awards", "powerbi-exports"]:
                logger.info("%s Running step: %s %s", "=" * 60, step_name, "=" * 60)
                if not steps[step_name]():
                    logger.error("Step '%s' failed. Stopping.", step_name)
                    return 1
        else:
            if not steps[args.step]():
                return 1

        # Save state so next run can remember what we did.
        state["last_step"] = args.step
        state["last_run_at"] = datetime.now().isoformat(timespec="seconds")
        save_state_file(args.state_file, state)
        return 0
    except KeyboardInterrupt:
        logger.info("Interrupted by user.")
        return 130
    except Exception as exc:
        logger.error("%s", exc)
        return 1


# This is the standard Python way to say "run main() when this script is executed directly".
if __name__ == "__main__":
    sys.exit(main())
