"""Build the company-profile CSV and load it into Microsoft Access."""

from __future__ import annotations

import logging
import sys
from pathlib import Path


# Support the documented direct command from the repository root.
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

# These imports intentionally follow the direct-command path setup above.
from src.company_profiles.access import load_profiles, read_database_config  # noqa: E402
from src.company_profiles.builder import build_profiles, write_profiles  # noqa: E402
from src.company_profiles.schema import ACCESS_TABLE, PROFILE_OUTPUT_PATH  # noqa: E402


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    try:
        profiles = build_profiles()
        write_profiles(profiles)
        logging.info("Built %d profiles in %s", len(profiles), PROFILE_OUTPUT_PATH)
        database_path, driver = read_database_config()
        load_profiles(profiles, database_path, driver)
        logging.info("Loaded %d profiles into [%s]", len(profiles), ACCESS_TABLE)
        return 0
    except Exception as exc:  # pylint: disable=broad-exception-caught
        logging.error("Company profile build/load failed: %s", exc)
        return 1


if __name__ == "__main__":
    sys.exit(main())
