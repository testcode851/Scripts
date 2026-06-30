from __future__ import annotations

import html
import re
from html.parser import HTMLParser
from typing import Any

from .schemas import BASE_ARCHIVES_URL

class TextExtractor(HTMLParser):
    """Small stdlib HTML-to-text helper for review-grade section extraction."""

    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []
        self.skip_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() in {"script", "style", "noscript"}:
            self.skip_depth += 1
        elif tag.lower() in {"br", "p", "div", "tr", "table", "h1", "h2", "h3"}:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() in {"script", "style", "noscript"} and self.skip_depth:
            self.skip_depth -= 1
        elif tag.lower() in {"p", "div", "tr", "table", "h1", "h2", "h3"}:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if not self.skip_depth:
            self.parts.append(data)

    def text(self) -> str:
        text = html.unescape(" ".join(self.parts))
        text = re.sub(r"[ \t\r\f\v]+", " ", text)
        text = re.sub(r"\n\s+", "\n", text)
        text = re.sub(r"\n{3,}", "\n\n", text)
        return text.strip()

def ten_k_filings(filing_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows = [row for row in filing_rows if row.get("form") == "10-K"]
    return sorted(rows, key=lambda row: (row.get("filingDate", ""), row.get("accessionNumber", "")), reverse=True)

def archive_base_url(cik: str, accession_number: str) -> str:
    cik_no_zeros = str(int(cik))
    accession_no_dashes = accession_number.replace("-", "")
    return f"{BASE_ARCHIVES_URL}/{cik_no_zeros}/{accession_no_dashes}"

def filing_document_url(cik: str, accession_number: str, document_name: str) -> str:
    return f"{archive_base_url(cik, accession_number)}/{document_name}"

def add_10k_urls(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    enriched: list[dict[str, Any]] = []
    for row in rows:
        accession = row.get("accessionNumber", "")
        primary_document = row.get("primaryDocument", "")
        cik = row.get("cik", "")
        copy = dict(row)
        copy["archive_base_url"] = archive_base_url(cik, accession) if accession and cik else ""
        copy["primary_document_url"] = (
            filing_document_url(cik, accession, primary_document) if accession and cik and primary_document else ""
        )
        copy["complete_submission_text_url"] = (
            filing_document_url(cik, accession, f"{accession}.txt") if accession and cik else ""
        )
        copy["filing_index_json_url"] = f"{copy['archive_base_url']}/index.json" if copy["archive_base_url"] else ""
        enriched.append(copy)
    return enriched

def extract_filing_documents(index_json: dict[str, Any], filing: dict[str, Any]) -> list[dict[str, Any]]:
    items = index_json.get("directory", {}).get("item", [])
    rows: list[dict[str, Any]] = []
    for item in items:
        name = item.get("name", "")
        rows.append(
            {
                "ticker": filing.get("ticker", ""),
                "cik": filing.get("cik", ""),
                "accessionNumber": filing.get("accessionNumber", ""),
                "filingDate": filing.get("filingDate", ""),
                "form": filing.get("form", ""),
                "name": name,
                "type": item.get("type", ""),
                "size": item.get("size", ""),
                "last_modified": item.get("last-modified", ""),
                "url": f"{filing.get('archive_base_url', '')}/{name}" if name else "",
            }
        )
    return rows

def html_to_text(markup: str) -> str:
    parser = TextExtractor()
    parser.feed(markup)
    return parser.text()

def extract_10k_sections(text: str) -> list[dict[str, str]]:
    item_pattern = re.compile(
        r"(?im)^\s*item\s+"
        r"(1A|1B|1C|1|2|3|4|5|6|7A|7|8|9A|9B|9C|9|10|11|12|13|14|15|16)"
        r"\.?\s+([^\n]{0,160})"
    )
    matches = list(item_pattern.finditer(text))
    sections: list[dict[str, str]] = []

    for index, match in enumerate(matches):
        item = f"Item {match.group(1).upper()}"
        heading = re.sub(r"\s+", " ", match.group(2)).strip()
        start = match.start()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        section_text = text[start:end].strip()
        if len(section_text) < 100:
            continue
        sections.append(
            {
                "item": item,
                "heading": heading,
                "char_start": str(start),
                "char_end": str(end),
                "text_length": str(len(section_text)),
                "text_preview": section_text[:1000],
            }
        )

    return sections
