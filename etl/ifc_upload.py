"""IFC model upload — podklady/*.ifc → Supabase Storage bucket `ifc/` (D-044, D-050, F5).

Vytvorí public bucket `ifc/` (idempotentne) a nahrá **N IFC súborov** (federácia
disciplinárnych modelov, D-049/D-050 — ARCH+VZT a do budúcna ľubovoľne ďalšie).
Kľúč v buckete = názov súboru; verejná URL sa vypíše pre každý model. Modely číta
frontend cez `getIfcModels()` (`lib/data/ifc.ts`).

> Pozn.: pridávanie modelov robí **prevádzkovateľ** týmto skriptom / configom —
> self-upload používateľom na deme nie je v scope (D-055).

Použitie:
    python -m etl.ifc_upload                       # default: podklady/ASR.ifc + VZT.ifc
    python -m etl.ifc_upload --file a.ifc --file b.ifc   # vlastné cesty (N×)
    python -m etl.ifc_upload --dir podklady        # všetky *.ifc v adresári
    python -m etl.ifc_upload --dry-run             # iba overenie, bez uploadu

Env (`.env.local`): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
"""

from __future__ import annotations

import argparse
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent

BUCKET = "ifc"
# Default federačná sada (D-049/D-050). Rozšíriteľné — pridaj ďalší .ifc do podklady/
# a doplň sem, alebo použi --file/--dir.
DEFAULT_IFCS = [
    _REPO_ROOT / "podklady" / "ASR.ifc",
    _REPO_ROOT / "podklady" / "VZT.ifc",
]


# ── Supabase Storage helpers (rovnaký vzor ako doc_upload.py) ─────────────────

def _storage_env() -> tuple[str, str]:
    # .env.local načíta config pri importe; pre standalone spustenie načítame tu.
    try:
        from dotenv import load_dotenv
        for name in (".env.local", ".env"):
            p = _REPO_ROOT / name
            if p.exists():
                load_dotenv(p, override=False)
    except ImportError:
        print("Warning: python-dotenv not found — env vars won't be loaded from .env files. "
              "Install with: pip install python-dotenv")
    url = (os.environ.get("SUPABASE_URL") or "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or ""
    if not url or not key:
        raise SystemExit(
            "Chýba SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY v .env.local "
            "(Supabase → Project Settings → API)."
        )
    return url, key


def _request(
    method: str,
    url: str,
    key: str,
    *,
    data: bytes | None = None,
    content_type: str | None = None,
    extra_headers: dict | None = None,
) -> tuple[int, bytes]:
    headers = {"Authorization": f"Bearer {key}", "apikey": key}
    if content_type:
        headers["Content-Type"] = content_type
    if extra_headers:
        headers.update(extra_headers)
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def ensure_bucket(base: str, key: str) -> None:
    """Vytvorí public bucket `ifc/` (idempotentne)."""
    status, body = _request(
        "POST",
        f"{base}/storage/v1/bucket",
        key,
        data=json.dumps({"id": BUCKET, "name": BUCKET, "public": True}).encode(),
        content_type="application/json",
    )
    if status in (200, 201):
        print(f"  bucket '{BUCKET}' vytvorený (public)")
    elif status == 409 or b"already exists" in body or b"Duplicate" in body:
        print(f"  bucket '{BUCKET}' už existuje")
    else:
        raise SystemExit(f"Bucket zlyhal ({status}): {body.decode(errors='replace')}")


def upload_ifc(base: str, key: str, object_key: str, content: bytes) -> str:
    """Nahrá IFC súbor (upsert) pod `object_key` a vráti verejnú URL."""
    encoded = urllib.parse.quote(object_key)
    status, body = _request(
        "POST",
        f"{base}/storage/v1/object/{BUCKET}/{encoded}",
        key,
        data=content,
        content_type="application/octet-stream",
        extra_headers={"x-upsert": "true"},
    )
    if status not in (200, 201):
        raise SystemExit(
            f"Upload '{object_key}' zlyhal ({status}): {body.decode(errors='replace')}"
        )
    return f"{base}/storage/v1/object/public/{BUCKET}/{encoded}"


# ── CLI ───────────────────────────────────────────────────────────────────────

def _resolve_paths(files: list[Path] | None, directory: Path | None) -> list[Path]:
    """Zostaví zoznam IFC ciest z --file (N×) / --dir / defaultu."""
    if directory is not None:
        paths = sorted(directory.glob("*.ifc"))
        if not paths:
            raise SystemExit(f"V adresári nie sú žiadne *.ifc: {directory}")
        return paths
    if files:
        return files
    # Default federačná sada — len tie, čo reálne existujú (VZT môže chýbať v env).
    existing = [p for p in DEFAULT_IFCS if p.exists()]
    if not existing:
        raise SystemExit(
            "Žiadny default IFC nenájdený v podklady/.\n"
            "Skopíruj ASR.ifc / VZT.ifc do podklady/ alebo zadaj cesty cez --file/--dir."
        )
    return existing


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--file",
        type=Path,
        action="append",
        metavar="PATH",
        help="Cesta k IFC súboru (opakovateľné pre N modelov).",
    )
    parser.add_argument(
        "--dir",
        type=Path,
        metavar="DIR",
        help="Nahrá všetky *.ifc z adresára.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Iba overí súbory a env vars, žiadny upload.",
    )
    args = parser.parse_args(argv)

    paths = _resolve_paths(args.file, args.dir)
    for p in paths:
        if not p.exists():
            raise SystemExit(f"IFC súbor nenájdený: {p}")

    base, key = _storage_env()
    print(f"Supabase:  {base}")
    print(f"Modely ({len(paths)}):")
    for p in paths:
        print(f"  - {p.name}  ({p.stat().st_size / 1_048_576:.1f} MB)")

    if args.dry_run:
        print("\n[dry-run] OK — súbory nájdené, env vars nastavené.")
        for p in paths:
            url = f"{base}/storage/v1/object/public/{BUCKET}/{urllib.parse.quote(p.name)}"
            print(f"  {p.name} → {url}")
        return

    print(f"\nEnsure bucket '{BUCKET}'...")
    ensure_bucket(base, key)

    urls: list[tuple[str, str]] = []
    for p in paths:
        size_mb = p.stat().st_size / 1_048_576
        print(f"Nahrávam {p.name} ({size_mb:.1f} MB)...")
        url = upload_ifc(base, key, p.name, p.read_bytes())
        urls.append((p.name, url))

    print("\n✓ Hotovo! Public URL modelov:")
    for name, url in urls:
        print(f"  {name}: {url}")
    print(
        "\nFrontend číta modely cez getIfcModels() (lib/data/ifc.ts) — kľúče v buckete "
        "musia sedieť s IFC_MODELS. NEXT_PUBLIC_IFC_URL (voliteľné) prepíše prvý model."
    )


if __name__ == "__main__":
    main()
