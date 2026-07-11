"""Extrakcia textu PDF dokumentov → `document_pages` (D-063).

Dopĺňa E4 (`pdf_link.py` — väzby prvok↔výkres z obsahu): tu sa z KAŽDÉHO PDF
v manifeste (`docs.csv`, nie len výkresy VD) extrahuje text per strana, aby LLM
vedel vyhľadávať v OBSAHU dokumentov (RPC `search_documents`, migrácia
`20260715120000`). Rovnaký vstupný kontrakt ako E4: `source_path` = cesta k PDF
pod `podklady/FINAL`, `container_name` = `object_ref` dokumentu v DB (E3).

PyMuPDF (`fitz`) — už je ETL závislosť (D-041), žiadna nová. Extrakcia je
`page.get_text("text")` + normalizácia bielych znakov; OCR je zámerne mimo
scope (D-063) — vektorové výkresy majú riedky text (legendy, pečiatky) a to je
očakávané. Prázdne strany sa nevkladajú.

Idempotentné: per dokument `DELETE` + `INSERT` v jednej transakcii — opakovaný
beh = rovnaký stav. Dokument, ktorý nie je v DB (chýba E3 upload), sa preskočí
s warningom, beh nezhodí.

Spustenie (z koreňa repa):
    python -m etl.pdf_text [--dry-run] [--manifest podklady/docs.csv]
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import fitz  # PyMuPDF
import psycopg

from .config import database_url

_REPO_ROOT = Path(__file__).resolve().parent.parent
_SOURCE_ROOT = _REPO_ROOT / "podklady" / "FINAL"
_MANIFEST = _REPO_ROOT / "podklady" / "docs.csv"

_WS_RE = re.compile(r"\s+")


@dataclass
class PdfRow:
    source_path: str
    container_name: str  # object_ref dokumentu (E3)


def _load_pdf_rows(manifest: Path) -> list[PdfRow]:
    """Všetky riadky manifestu s PDF zdrojom (výkresy aj ostatné dokumenty)."""
    out: list[PdfRow] = []
    with manifest.open(encoding="utf-8-sig", newline="") as fh:
        for r in csv.DictReader(fh):
            src = (r.get("source_path") or "").strip()
            cn = (r.get("container_name") or "").strip()
            if src.lower().endswith(".pdf") and cn:
                out.append(PdfRow(src, cn))
    return out


def _doc_id(cur, container_name: str) -> Optional[str]:
    cur.execute(
        "select id from objects where object_ref = %s and object_type = 'document'",
        (container_name,),
    )
    row = cur.fetchone()
    return str(row[0]) if row else None


def extract_pages(pdf_path: Path) -> list[tuple[int, str]]:
    """(číslo strany 1-based, normalizovaný text) pre neprázdne strany."""
    pages: list[tuple[int, str]] = []
    with fitz.open(pdf_path) as doc:
        for i, page in enumerate(doc, start=1):
            text = _WS_RE.sub(" ", page.get_text("text")).strip()
            if text:
                pages.append((i, text))
    return pages


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(description="Extrakcia textu PDF → document_pages (D-063)")
    ap.add_argument("--manifest", type=Path, default=_MANIFEST, help="cesta k docs.csv")
    ap.add_argument("--source-root", type=Path, default=_SOURCE_ROOT, help="koreň PDF zdrojov")
    ap.add_argument("--dry-run", action="store_true", help="len extrakcia + report, bez zápisu")
    args = ap.parse_args(argv)

    rows = _load_pdf_rows(args.manifest)
    print(f"PDF v manifeste: {len(rows)}")
    if not rows:
        return 0

    conn = None if args.dry_run else psycopg.connect(database_url())
    written_docs = 0
    written_pages = 0
    skipped: list[str] = []
    try:
        cur = conn.cursor() if conn else None
        for row in rows:
            pdf_path = args.source_root / row.source_path
            if not pdf_path.exists():
                skipped.append(f"{row.container_name} (PDF chýba: {row.source_path})")
                continue
            pages = extract_pages(pdf_path)
            total_chars = sum(len(t) for _, t in pages)
            print(
                f"  {row.container_name:46s} strán s textom {len(pages):3d}"
                f"  znakov {total_chars:7d}"
            )
            if cur is None:
                continue
            doc_id = _doc_id(cur, row.container_name)
            if doc_id is None:
                skipped.append(f"{row.container_name} (nie je v DB — najprv doc_upload/E3)")
                continue
            # Idempotencia: plný refresh strán dokumentu.
            cur.execute("delete from document_pages where document_id = %s", (doc_id,))
            for page_no, text in pages:
                cur.execute(
                    "insert into document_pages (document_id, page, text) values (%s, %s, %s)",
                    (doc_id, page_no, text),
                )
            written_docs += 1
            written_pages += len(pages)
        if conn:
            conn.commit()
    finally:
        if conn:
            conn.close()

    if skipped:
        print("Preskočené:")
        for s in skipped:
            print(f"  - {s}")
    if not args.dry_run:
        print(f"Zapísané: {written_docs} dokumentov / {written_pages} strán.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
