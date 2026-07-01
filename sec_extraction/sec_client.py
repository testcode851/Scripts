"""HTTP, file, and identifier helpers for SEC extraction."""

from __future__ import annotations

import csv
import difflib
import json
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

import pandas as pd
import requests

from .schemas import BASE_DATA_URL, REQUEST_DELAY_SECONDS, TIMEOUT_SECONDS


@dataclass(frozen=True)
class CompanyIdentifier:
    """Canonical SEC identifiers for a registrant."""

    ticker: str
    cik: str
    company_name: str


class SecClient:
    """Rate-limited HTTP client configured for SEC requests."""

    def __init__(self, user_agent: str, pause_seconds: float = REQUEST_DELAY_SECONDS) -> None:
        self.pause_seconds = pause_seconds
        self.last_call_ts = 0.0
        self.session = requests.Session()
        self.session.headers.update(
            {
                "User-Agent": user_agent,
                "Accept-Encoding": "gzip, deflate",
                "Accept": "application/json, text/html, text/plain, */*",
            }
        )

    def get(self, url: str) -> requests.Response:
        """Return a successful response after applying request throttling."""
        elapsed = time.time() - self.last_call_ts
        if elapsed < self.pause_seconds:
            time.sleep(self.pause_seconds - elapsed)

        response = self.session.get(url, timeout=TIMEOUT_SECONDS)
        self.last_call_ts = time.time()
        response.raise_for_status()
        return response

    def get_json(self, url: str) -> dict[str, Any]:
        """Fetch a JSON object from an SEC endpoint."""
        return self.get(url).json()

    def get_text(self, url: str) -> str:
        """Fetch text content from an SEC endpoint."""
        response = self.get(url)
        response.encoding = response.encoding or "utf-8"
        return response.text


def ensure_output_dir(path: Path) -> None:
    """Create an output directory and its parents when absent."""
    path.mkdir(parents=True, exist_ok=True)


def write_json(path: Path, payload: Any) -> None:
    """Write a JSON-serializable object with stable formatting."""
    path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")


def write_csv(path: Path, rows: Iterable[dict[str, Any]], fieldnames: list[str]) -> int:
    """Write dictionaries to CSV and return the data-row count."""
    count = 0
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow(row)
            count += 1
    return count


def read_table(path: Path) -> pd.DataFrame:
    """Read an Excel or CSV table as strings with empty null values."""
    if path.suffix.lower() in {".xlsx", ".xls"}:
        return pd.read_excel(path, dtype=str).fillna("")
    return pd.read_csv(path, dtype=str).fillna("")


def clean_text(value: Any) -> str:
    """Convert a value to stripped text, treating null values as empty."""
    return str(value or "").strip()


def normalize_name(value: Any) -> str:
    """Normalize a company name for comparison."""
    text = clean_text(value).casefold()
    text = text.replace("&", " and ")
    text = re.sub(r"[^a-z0-9]+", " ", text)
    words = [
        word
        for word in text.split()
        if word
        not in {
            "the",
            "inc",
            "incorporated",
            "corp",
            "corporation",
            "co",
            "company",
            "llc",
            "ltd",
            "limited",
            "plc",
            "holdings",
            "holding",
        }
    ]
    return " ".join(words)


def name_similarity(left: Any, right: Any) -> float:
    """Score normalized company-name similarity from zero to one hundred."""
    left_norm = normalize_name(left)
    right_norm = normalize_name(right)
    if not left_norm or not right_norm:
        return 0.0
    if left_norm == right_norm:
        return 100.0
    if left_norm in right_norm or right_norm in left_norm:
        shorter = min(len(left_norm), len(right_norm))
        longer = max(len(left_norm), len(right_norm))
        return round(90.0 + (10.0 * shorter / longer), 2)
    return round(difflib.SequenceMatcher(None, left_norm, right_norm).ratio() * 100.0, 2)


def normalize_cik(cik: str | int) -> str:
    """Return a CIK as a zero-padded ten-character string."""
    return str(cik).strip().lstrip("0").zfill(10)


def load_sec_ticker_map(client: SecClient) -> list[dict[str, str]]:
    """Load ticker, CIK, and registrant names from the SEC."""
    ticker_payload = client.get_json("https://www.sec.gov/files/company_tickers.json")
    rows: list[dict[str, str]] = []
    for item in ticker_payload.values():
        rows.append(
            {
                "ticker": clean_text(item.get("ticker")).upper(),
                "cik": normalize_cik(item.get("cik_str", "")),
                "sec_company_name": clean_text(item.get("title")),
            }
        )
    return rows


def resolve_company(client: SecClient, ticker: str | None, cik: str | None) -> CompanyIdentifier:
    """Resolve a ticker or CIK to canonical SEC identifiers."""
    if cik:
        normalized_cik = normalize_cik(cik)
        submissions = client.get_json(f"{BASE_DATA_URL}/submissions/CIK{normalized_cik}.json")
        tickers = submissions.get("tickers") or []
        return CompanyIdentifier(
            ticker=(tickers[0].upper() if tickers else ""),
            cik=normalized_cik,
            company_name=submissions.get("name", ""),
        )

    if not ticker:
        raise ValueError("Provide either --ticker or --cik.")

    ticker_payload = client.get_json("https://www.sec.gov/files/company_tickers.json")
    ticker_upper = ticker.strip().upper()
    for item in ticker_payload.values():
        if str(item.get("ticker", "")).upper() == ticker_upper:
            return CompanyIdentifier(
                ticker=ticker_upper,
                cik=normalize_cik(item["cik_str"]),
                company_name=item.get("title", ""),
            )

    raise ValueError(f"Ticker not found in SEC company_tickers.json: {ticker}")
