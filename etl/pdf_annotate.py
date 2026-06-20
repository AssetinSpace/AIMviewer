"""PDF URI-anotácie — kódy klikateľné v ľubovoľnom prehliadači (D-042 fáza B / MVP).

Číta link regióny z `objects.properties._drawing_links` (zapísané fázou A,
`pdf_link.py`) a pre každý región vloží do PDF URI-link anotáciu (`page.insert_link`)
mieriacu na `${SITE_URL}/{target_route}/{target_id}`. Výsledok je samostatné anotované
PDF — kódy sú klikateľné v akomkoľvek prehliadači, **nula frontendu**.

**Žiadna druhá detekcia** (D-042): súradnice sa neberú z PDF nanovo, ale z
`_drawing_links` (jeden zdroj pravdy). Zdrojové PDF sa **neprepíše** — anotované idú
do oddelenej cesty (`podklady/ANNOTATED/`, zrkadlí relatívnu `source_path`).

Súradnice v `_drawing_links` sú v PDF bottom-left (y hore); `page.insert_link` čaká
rect v `page.rect` priestore (top-left, y dole) → inverz y-flipu tu (`_to_page_rect`).
Strany výkresov majú rotáciu 0; PyMuPDF rieši offset mediaboxu interne (rovnaký
priestor ako `get_text`, z ktorého bbox vznikol).

`--dry-run` = report bez zápisu súborov.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Optional

import fitz  # PyMuPDF
import psycopg

from .config import database_url, site_url
from .pdf_link import _SOURCE_ROOT, DrawingRow, read_drawings

# Anotované PDF idú vedľa zdroja — zrkadlia relatívnu `source_path` (zdroj netknutý).
_OUT_ROOT = _SOURCE_ROOT.parent / "ANNOTATED"


def _to_page_rect(bbox: list[float], page_size: list[float]) -> "fitz.Rect":
    """`_drawing_links` bbox (PDF bottom-left) → `page.rect` rect (top-left). Inverz y-flipu."""
    x0, by0, x1, by1 = bbox
    _w, h = page_size
    return fitz.Rect(x0, h - by1, x1, h - by0)


def _load_links(cur, container_name: str) -> Optional[list[dict]]:
    """`_drawing_links` blob dokumentu (alebo None, ak dokument/kľúč chýba)."""
    row = cur.execute(
        "select properties->'_drawing_links' from objects "
        "where object_ref = %s and object_type = 'document'",
        (container_name,),
    ).fetchone()
    if row is None:
        return None
    return row[0]


def annotate_drawing(cur, row: DrawingRow, base_url: str, dry: bool) -> int:
    """Vloží URI-link anotácie do kópie výkresu; vráti počet vložených linkov."""
    pdf_path = _SOURCE_ROOT / row.source_path
    if not pdf_path.exists():
        raise SystemExit(f"PDF chýba: {row.source_path}")

    links = _load_links(cur, row.container_name)
    if links is None:
        raise SystemExit(
            f"dokument '{row.container_name}' nemá _drawing_links — najprv spusti "
            f"pdf_link (D-042 fáza A)."
        )
    if not links:
        return 0  # 0 regiónov (napr. PBR pôdorys) → netreba anotovať

    doc = fitz.open(pdf_path)
    for region in links:
        uri = f"{base_url}/{region['target_route']}/{region['target_id']}"
        rect = _to_page_rect(region["bbox"], region["page_size"])
        page = doc[region["page"] - 1]   # `page` je 1-based
        page.insert_link({"kind": fitz.LINK_URI, "from": rect, "uri": uri})

    if not dry:
        out_path = _OUT_ROOT / row.source_path
        out_path.parent.mkdir(parents=True, exist_ok=True)
        doc.save(out_path)
    doc.close()
    return len(links)


def main(argv: Optional[list[str]] = None) -> int:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")

    ap = argparse.ArgumentParser(description="PDF URI-anotácie výkresov (D-042 fáza B).")
    ap.add_argument("--dry-run", action="store_true",
                    help="report bez zápisu anotovaných PDF.")
    args = ap.parse_args(argv)

    base_url = site_url()
    drawings = read_drawings()
    print(f"Výkresy v manifeste (VD): {len(drawings)}")
    print(f"SITE_URL: {base_url}")
    print(f"Výstup:   {_OUT_ROOT}\n")

    total = 0
    with psycopg.connect(database_url()) as conn:
        with conn.cursor() as cur:
            for row in drawings:
                n = annotate_drawing(cur, row, base_url, args.dry_run)
                total += n
                status = "anotované" if (n and not args.dry_run) else (
                    "—" if not n else "(dry-run)")
                print(f"  {row.container_name:42s} linkov {n:3d}  {status}")
        conn.rollback()  # len čítame z DB; žiadny zápis do DB v tejto fáze

    tail = " (--dry-run → súbory sa nezapisujú)" if args.dry_run else ""
    print(f"\nHotovo: {total} URI-linkov{tail}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
