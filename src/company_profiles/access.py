"""Load validated company profiles into Microsoft Access."""

from __future__ import annotations

from configparser import ConfigParser
from datetime import date, datetime
from typing import Any

import pandas as pd

from .schema import ACCESS_TABLE, CONFIG_PATH, PROFILE_COLUMNS


def read_database_config() -> tuple[str, str]:
    if not CONFIG_PATH.is_file():
        raise FileNotFoundError(f"Missing {CONFIG_PATH}.")
    parser = ConfigParser(interpolation=None)
    parser.read(CONFIG_PATH, encoding="utf-8-sig")
    if not parser.has_section("Database"):
        raise ValueError(f"{CONFIG_PATH} needs a [Database] section.")
    database_path = parser.get("Database", "path", fallback="").strip()
    driver = parser.get("Database", "driver", fallback="").strip()
    if not database_path or not driver:
        raise ValueError("[Database] must contain path and driver values.")
    return database_path, driver


def _value(value: Any) -> Any:
    if value is None or pd.isna(value):
        return None
    if isinstance(value, pd.Timestamp):
        return value.to_pydatetime()
    if isinstance(value, (datetime, date, str, int, float, bool)):
        return value
    return value.item() if hasattr(value, "item") else value


def load_profiles(profiles: pd.DataFrame, database_path: str, driver: str) -> None:
    """Replace CompanyProfilePOC rows in one transaction."""
    try:
        import pyodbc
    except ModuleNotFoundError as exc:
        raise RuntimeError("Install pyodbc with: python -m pip install pyodbc") from exc

    connection = pyodbc.connect(
        f"DRIVER={{{driver}}};DBQ={database_path};", autocommit=False, timeout=10
    )
    columns = ", ".join(f"[{column}]" for column in PROFILE_COLUMNS)
    markers = ", ".join("?" for _ in PROFILE_COLUMNS)
    sql = f"INSERT INTO [{ACCESS_TABLE}] ({columns}) VALUES ({markers})"
    rows = [
        tuple(_value(value) for value in row)
        for row in profiles.itertuples(index=False, name=None)
    ]
    try:
        cursor = connection.cursor()
        cursor.execute(f"DELETE FROM [{ACCESS_TABLE}]")
        cursor.executemany(sql, rows)
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()
