"""IFC model upload — podklady/ASR.ifc → Supabase Storage bucket `ifc/` (D-044, S5).

Vytvorí public bucket `ifc/` (idempotentne) a nahrá IFC súbor. Výstupom je
verejná URL, ktorú treba nastaviť ako `NEXT_PUBLIC_IFC_URL` v Verceli / `.env.local`.

Použitie:
    python -m etl.ifc_upload                      # štandardná cesta podklady/ASR.ifc
    python -m etl.ifc_upload --file cesta/ifc     # vlastná cesta
    python -m etl.ifc_upload --dry-run            # iba overenie, bez uploadu

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
DEFAULT_IFC = _REPO_ROOT / "podklady" / "ASR.ifc"
OBJECT_KEY = "ASR.ifc"


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


def upload_ifc(base: str, key: str, content: bytes, object_key: str = OBJECT_KEY) -> str:
    """Nahrá IFC súbor (upsert) a vráti verejnú URL."""
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
            f"Upload '{OBJECT_KEY}' zlyhal ({status}): {body.decode(errors='replace')}"
        )
    return f"{base}/storage/v1/object/public/{BUCKET}/{encoded}"


# ── CLI ───────────────────────────────────────────────────────────────────────

def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--file",
        type=Path,
        default=DEFAULT_IFC,
        metavar="PATH",
        help=f"Cesta k IFC súboru (default: {DEFAULT_IFC})",
    )
    parser.add_argument(
        "--key",
        default=None,
        metavar="OBJECT_KEY",
        help=f"Object key v bucketе `ifc/` (default: {OBJECT_KEY} pre ASR; VZT federáciu "
             "nahraj ako --key VZT.ifc, D-049).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Iba overí súbor a env vars, žiadny upload.",
    )
    args = parser.parse_args(argv)

    object_key: str = args.key or OBJECT_KEY
    ifc_path: Path = args.file
    if not ifc_path.exists():
        raise SystemExit(
            f"IFC súbor nenájdený: {ifc_path}\n"
            f"Skopíruj ASR.ifc do podklady/ alebo zadaj cestu cez --file."
        )

    size_mb = ifc_path.stat().st_size / 1_048_576
    print(f"IFC súbor: {ifc_path}  ({size_mb:.1f} MB)")

    base, key = _storage_env()
    print(f"Supabase:  {base}")

    if args.dry_run:
        print("\n[dry-run] OK — súbor nájdený, env vars nastavené.")
        print(f"  Výsledná URL by bola: {base}/storage/v1/object/public/{BUCKET}/{urllib.parse.quote(object_key)}")
        return

    content = ifc_path.read_bytes()
    print(f"\nEnsure bucket '{BUCKET}'...")
    ensure_bucket(base, key)

    print(f"Nahrávam {object_key} ({size_mb:.1f} MB)...")
    public_url = upload_ifc(base, key, content, object_key)

    print(f"\n✓ Hotovo!")
    print(f"\nPublic URL:\n  {public_url}")
    print(f"\nNastav v Verceli (Environment Variables):")
    print(f"  NEXT_PUBLIC_IFC_URL={public_url}")
    print(f"\nAlebo do .env.local pre lokálny dev:")
    print(f"  NEXT_PUBLIC_IFC_URL={public_url}")


if __name__ == "__main__":
    main()
