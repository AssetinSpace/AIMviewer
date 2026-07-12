"""Test `_write_document` — re-upload dokumentu nesmie zahodiť `_drawing_links` (E4).

Regresia: objects upsert nastavoval `properties = excluded.properties` (len pset
CDE), čím pri opakovanom E3 behu prepísal celý JSONB vrátane `_drawing_links`,
ktoré tam merguje pdf_link (E4, D-042). Klikateľné regióny výkresov tak po
re-uploade PDF zmizli, kým niekto nespustil E4 znova.

Overuje sa vygenerované SQL: nahradiť sa smie len kľúč 'CDE', zvyšok properties
sa musí zachovať (jsonb `- 'CDE' || excluded`).
"""

from __future__ import annotations

from etl.doc_upload import _write_document, read_manifest


class StubCursor:
    """Zaznamenáva execute() a servíruje fetchone výsledky v poradí."""

    def __init__(self, fetchone_results: list) -> None:
        self.calls: list[tuple[str, tuple]] = []
        self._fetchone = list(fetchone_results)

    def execute(self, sql: str, params: tuple = ()) -> "StubCursor":
        self.calls.append((" ".join(sql.split()), params))
        return self

    def fetchone(self):
        return self._fetchone.pop(0)


def _manifest_row(monkeypatch, tmp_path):
    import etl.doc_upload as du

    manifest = tmp_path / "docs.csv"
    manifest.write_text(
        "# komentár\n"
        "source_path,container_name,target_ref,status,revision\n"
        "ASR/pdf/v1.pdf,AIM_DSP_D1_ASR_VD_001_Pôdorys,1NP,S2,P01\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(du, "_MANIFEST", manifest)
    return read_manifest()[0]


def test_objects_upsert_preserves_non_cde_properties(monkeypatch, tmp_path) -> None:
    row = _manifest_row(monkeypatch, tmp_path)
    cur = StubCursor(fetchone_results=[("target-uuid",), ("doc-uuid",)])

    _write_document(cur, row, location="https://x/storage/doc.pdf", storage_type="supabase")

    upsert_sql = next(sql for sql, _ in cur.calls if "insert into objects" in sql)
    # celé properties sa nesmú nahradiť — iba pset CDE
    assert "properties = excluded.properties" not in upsert_sql
    assert "- 'CDE'" in upsert_sql
    assert "|| excluded.properties" in upsert_sql


def test_write_document_emits_all_three_writes(monkeypatch, tmp_path) -> None:
    row = _manifest_row(monkeypatch, tmp_path)
    cur = StubCursor(fetchone_results=[("target-uuid",), ("doc-uuid",)])

    _write_document(cur, row, location="https://x/storage/doc.pdf", storage_type="supabase")

    sqls = [sql for sql, _ in cur.calls]
    assert any("insert into objects" in s for s in sqls)
    assert any("insert into documents" in s for s in sqls)
    assert any("insert into relationships" in s for s in sqls)
    # hrana ide na base tabuľku relationships s kanonickým rel_type (D-051)
    rel_sql = next(s for s in sqls if "insert into relationships" in s)
    assert "'rel_associates_document'" in rel_sql
