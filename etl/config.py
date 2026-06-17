"""Konfigurácia ETL — načítanie `DATABASE_URL` z prostredia (D-031).

`DATABASE_URL` je priame Postgres pripojenie na Supabase (Project Settings →
Database → Connection string). Tajné — žije v `.env.local`/`.env` (gitignored),
nikdy sa necommituje.
"""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

# Repo root = o úroveň vyššie ako etl/. Načítaj .env.local aj .env (ak existujú).
_REPO_ROOT = Path(__file__).resolve().parent.parent
for _name in (".env.local", ".env"):
    _path = _REPO_ROOT / _name
    if _path.exists():
        load_dotenv(_path, override=False)


def database_url() -> str:
    """Vráti `DATABASE_URL` alebo zrozumiteľne zlyhá."""
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise SystemExit(
            "Chýba DATABASE_URL. Doplň ho do .env.local (Supabase → Project "
            "Settings → Database → Connection string / URI)."
        )
    return url
