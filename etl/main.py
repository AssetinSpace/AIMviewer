"""ETL CLI (D-031) — IFC → Supabase.

Spustenie z koreňa repa:
    python -m etl.main --file etl/data/model.ifc            # zapíše do DB
    python -m etl.main --file etl/data/model.ifc --dry-run  # len zhrnutie, bez DB
"""

from __future__ import annotations

import argparse
from typing import Optional, Sequence

from . import config, extract, transform
from .db import load_model
from .model import StagedModel


def main(argv: Optional[Sequence[str]] = None) -> None:
    parser = argparse.ArgumentParser(description="AIM ETL — IFC → Supabase (D-031)")
    parser.add_argument("--file", required=True, help="cesta k IFC súboru")
    parser.add_argument(
        "--dry-run", action="store_true", help="nepíš do DB, len zhrnutie + vzorka"
    )
    args = parser.parse_args(argv)

    model = extract.open_model(args.file)
    print(f"IFC schéma: {extract.schema_version(model)}")

    staged = transform.to_staged(model)
    print(f"Staged: {staged.summary()}")

    if args.dry_run:
        print("--dry-run → do DB sa nezapisuje.")
        _print_sample(staged)
        return

    url = config.database_url()
    load_model(url, staged)
    print("Hotovo — zapísané do Supabase.")


def _print_sample(staged: StagedModel) -> None:
    print("Vzorka uzlov:")
    for o in staged.objects[:12]:
        print(f"  {o.object_type:12} {o.object_ref:28} {o.name or ''}")
    if len(staged.objects) > 12:
        print(f"  … +{len(staged.objects) - 12} ďalších")


if __name__ == "__main__":
    main()
