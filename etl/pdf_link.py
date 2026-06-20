"""PDF výkres auto-linking — element ↔ výkres z obsahu PDF (E4, D-032/D-033).

CDE názov dokumentu (E3, D-036) zámerne **nenesie** väzbu na konkrétny prvok —
tá sa získa až z **obsahu výkresu**. Tu skenujeme PDF pôdorysy, detegujeme SNIM
kódy (`scheme.py`) a vytvoríme `rel_has_document(prvok → výkres)`. Pôdorys 1NP sa
tak automaticky prepojí na typy/inštancie prvkov v ňom.

Pipeline (D-033):
  1. PyMuPDF (`fitz`) — slová + bounding boxy z každej strany.
  2. Detekcia kódov regexom **odvodeným zo schémy** (platné TSP prefixy z `SNIM`).
     Bublina na výkrese nie je vždy jeden reťazec (`SN11` a `01` zvlášť) → **proximity
     match**: holý Assembly Code sa spojí s blízkym číselným fragmentom.
  3. Match na `object_ref` v DB (typové `DD01.06` aj inštančné `DD01.06.03`).
  4. `rel_has_document(from=prvok, to=výkres, role='drawing', source='pdf_link (E4)')`.

Vstup = mapovanie výkres-PDF → dokument (`object_ref` z E3). Berie sa z `docs.csv`
(riadky s TypSouboru `VD`); cesta k PDF = `source_path`, cieľový dokument = `container_name`.

`--dry-run` = detekcia + coverage report (žiadny zápis). Idempotentné
(deterministické UUID hrán, `ids.py`). NIE je to IDS validácia — len pokrytie.
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import fitz  # PyMuPDF
import psycopg

from . import ids
from .config import database_url
from .doc_scheme import parse_container_name
from .scheme import SNIM, CodingScheme

_REPO_ROOT = Path(__file__).resolve().parent.parent
_SOURCE_ROOT = _REPO_ROOT / "podklady" / "FINAL"
_MANIFEST = _REPO_ROOT / "podklady" / "docs.csv"

LINK_ROLE = "drawing"
LINK_SOURCE = "pdf_link (E4)"

# Proximity práh pre spojenie holého kódu s číselným fragmentom (v bodoch PDF,
# 1 pt ≈ 0.35 mm). Bublina prvku má kód a Mark blízko seba; ladí sa na výkrese.
PROXIMITY_PT = 28.0


@dataclass(frozen=True)
class CodeMatcher:
    """Detektor SNIM kódov odvodený z `CodingScheme` (žiadny hardcode mimo schémy)."""

    scheme: CodingScheme

    @property
    def tsp_prefixes(self) -> set[str]:
        return set(self.scheme.categories.keys())

    @property
    def _full_re(self) -> re.Pattern:
        # Assembly Code (2 písmená + číslice) + aspoň jedna `.číslica` skupina.
        return re.compile(r"^[A-Z]{2}\d{2}(?:\.\d+)+$")

    @property
    def _bare_re(self) -> re.Pattern:
        # Holý Assembly Code bez Type Mark (napr. `DD01`, `SN11`).
        return re.compile(r"^[A-Z]{2}\d{2}$")

    @property
    def _frag_re(self) -> re.Pattern:
        # Číselný fragment (Type Mark / Mark), príp. zložený `06.03`.
        return re.compile(r"^\d{1,2}(?:\.\d{1,2})*$")

    def valid_tsp(self, code: str) -> bool:
        return code[:2] in self.tsp_prefixes


@dataclass
class Hit:
    """Jeden detegovaný kód na strane + jeho pôvod (pre report/debug)."""

    code: str
    page: int
    origin: str          # "full" | "proximity"


@dataclass
class PageWords:
    """Slová strany s bbox stredmi (x, y) — vstup proximity matchu."""

    words: list[tuple[str, float, float]] = field(default_factory=list)


def _page_words(page: "fitz.Page") -> PageWords:
    out: list[tuple[str, float, float]] = []
    for x0, y0, x1, y1, text, *_ in page.get_text("words"):
        out.append((text, (x0 + x1) / 2, (y0 + y1) / 2))
    return PageWords(out)


def detect_codes(page: "fitz.Page", page_no: int, m: CodeMatcher) -> list[Hit]:
    """Deteguje kódy na strane: priame (s bodkou) + proximity (holý + fragment)."""
    pw = _page_words(page)
    hits: list[Hit] = []

    # 1) priame celé kódy (`PD02.31`, `PH01.10`)
    for text, _x, _y in pw.words:
        if m._full_re.match(text) and m.valid_tsp(text):
            hits.append(Hit(text, page_no, "full"))

    # 2) proximity — holý Assembly Code + najbližší číselný fragment
    bares = [(t, x, y) for (t, x, y) in pw.words if m._bare_re.match(t) and m.valid_tsp(t)]
    frags = [(t, x, y) for (t, x, y) in pw.words if m._frag_re.match(t)]
    for bt, bx, by in bares:
        # najbližší fragment v okruhu PROXIMITY_PT
        best: Optional[tuple[str, float]] = None
        for ft, fx, fy in frags:
            dist = ((fx - bx) ** 2 + (fy - by) ** 2) ** 0.5
            if dist <= PROXIMITY_PT and (best is None or dist < best[1]):
                best = (ft, dist)
        if best is not None:
            hits.append(Hit(f"{bt}.{best[0]}", page_no, "proximity"))
        else:
            # holý kód bez fragmentu — aspoň typový prefix (môže matchnúť typ)
            hits.append(Hit(bt, page_no, "full"))
    return hits


# ── Manifest (výkres PDF → dokument object_ref) ───────────────────────────────


@dataclass(frozen=True)
class DrawingRow:
    source_path: str
    container_name: str    # object_ref dokumentu (z E3)


def read_drawings() -> list[DrawingRow]:
    """Riadky manifestu, ktoré sú výkresy (TypSouboru = VD)."""
    if not _MANIFEST.exists():
        raise SystemExit(f"Chýba manifest {_MANIFEST}")
    out: list[DrawingRow] = []
    with _MANIFEST.open(encoding="utf-8") as fh:
        reader = csv.DictReader(line for line in fh if not line.startswith("#"))
        for r in reader:
            cn = r["container_name"].strip()
            if parse_container_name(cn).doc_type == "VD":
                out.append(DrawingRow(r["source_path"].strip(), cn))
    return out


# ── Matching na DB + zápis hrán ───────────────────────────────────────────────


def _load_refs(cur) -> dict[str, tuple[str, str]]:
    """object_ref → (id, object_type) pre asset/asset_type."""
    rows = cur.execute(
        "select object_ref, id, object_type from objects "
        "where object_type in ('asset','asset_type')"
    ).fetchall()
    return {r[0]: (r[1], r[2]) for r in rows}


def _doc_id(cur, container_name: str) -> Optional[str]:
    row = cur.execute(
        "select id from objects where object_ref = %s and object_type = 'document'",
        (container_name,),
    ).fetchone()
    return row[0] if row else None


def _link(cur, from_id: str, doc_id: str, dry: bool) -> None:
    if dry:
        return
    # rel_has_document(from=prvok, to=výkres) — zachováva smer D-014 (objekt → dokument)
    eid = ids.edge_id(from_id, doc_id, "has_document")
    cur.execute(
        """
        insert into rel_has_document
          (id, from_id, to_id, role, valid_from, valid_until, source)
        values (%s, %s, %s, %s, now(), null, %s)
        on conflict (id) do update set role = excluded.role, source = excluded.source
        """,
        (eid, from_id, doc_id, LINK_ROLE, LINK_SOURCE),
    )


@dataclass
class DrawingResult:
    container_name: str
    detected: int
    matched: int
    unmatched_codes: set[str]


def process_drawing(cur, row: DrawingRow, m: CodeMatcher, refs: dict, dry: bool) -> DrawingResult:
    pdf_path = _SOURCE_ROOT / row.source_path
    if not pdf_path.exists():
        raise SystemExit(f"PDF chýba: {row.source_path}")
    doc_id = _doc_id(cur, row.container_name)
    if doc_id is None:
        raise SystemExit(
            f"dokument '{row.container_name}' nie je v DB — najprv spusti doc_upload (E3)."
        )

    doc = fitz.open(pdf_path)
    codes: set[str] = set()
    for i in range(doc.page_count):
        for hit in detect_codes(doc[i], i + 1, m):
            codes.add(hit.code)

    matched_ids: set[str] = set()
    unmatched: set[str] = set()
    for code in codes:
        ref = refs.get(code)
        if ref is None:
            unmatched.add(code)
            continue
        matched_ids.add(ref[0])

    for from_id in matched_ids:
        _link(cur, from_id, doc_id, dry)

    return DrawingResult(row.container_name, len(codes), len(matched_ids), unmatched)


# ── CLI ───────────────────────────────────────────────────────────────────────


def main(argv: Optional[list[str]] = None) -> int:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")

    ap = argparse.ArgumentParser(description="PDF výkres auto-linking (E4, D-033).")
    ap.add_argument("--dry-run", action="store_true",
                    help="detekcia + coverage, žiadny zápis do DB.")
    ap.add_argument("--show-unmatched", action="store_true",
                    help="vypíš kódy detegované vo výkrese bez zhody v DB (ladenie).")
    args = ap.parse_args(argv)

    matcher = CodeMatcher(SNIM)
    drawings = read_drawings()
    print(f"Výkresy v manifeste (VD): {len(drawings)}")

    total_links = 0
    with psycopg.connect(database_url()) as conn:
        with conn.cursor() as cur:
            refs = _load_refs(cur)
            print(f"object_ref v DB (asset/type): {len(refs)}\n")
            for row in drawings:
                res = process_drawing(cur, row, matcher, refs, args.dry_run)
                total_links += res.matched
                print(f"  {res.container_name:46s} detegovaných {res.detected:3d} "
                      f"→ zhoda {res.matched:3d} prvkov")
                if args.show_unmatched and res.unmatched_codes:
                    print(f"      bez zhody: {sorted(res.unmatched_codes)}")
        if args.dry_run:
            conn.rollback()
            print("\n--dry-run → do DB sa nezapisuje.")
        else:
            conn.commit()
            print(f"\nHotovo: {total_links} element-väzieb zapísaných (role='{LINK_ROLE}').")
    return 0


if __name__ == "__main__":
    sys.exit(main())
