"""Test rotácie IFC GUID v `_load_guid_history` (D-010).

Regresia: nový aktívny záznam (valid_until NULL) sa insertol bez uzavretia
predošlého aktívneho záznamu toho istého objektu → partial unique index
`uniq_active_guid` (object_id WHERE valid_until IS NULL) vyhodil unique
violation a celá transakcia loadu sa rollbackla. Re-export z Revitu so
zmenenými GlobalId (presne workflow, pre ktorý GUID história existuje) tak
padal pri každom behu bez --reset.

DB sa v testoch nepoužíva — stub kurzor zaznamenáva (sql, params) a overuje
sa poradie a parametre príkazov.
"""

from __future__ import annotations

from etl.db import _load_guid_history
from etl.model import GuidHistory, StagedModel


class StubCursor:
    def __init__(self) -> None:
        self.calls: list[tuple[str, tuple]] = []

    def execute(self, sql: str, params: tuple = ()) -> "StubCursor":
        self.calls.append((" ".join(sql.split()), params))
        return self


def _model(*history: GuidHistory) -> StagedModel:
    m = StagedModel()
    m.guid_history.extend(history)
    return m


def test_active_record_closes_previous_active_guid_first() -> None:
    cur = StubCursor()
    model = _model(GuidHistory(object_ref="DV-001", ifc_guid="NEW_GUID", source="IFC import"))
    _load_guid_history(cur, model, {"DV-001": "uuid-dv-001"})

    assert len(cur.calls) == 2
    close_sql, close_params = cur.calls[0]
    insert_sql, insert_params = cur.calls[1]

    # 1) najprv sa uzavrie predošlý aktívny záznam s INÝM guid
    assert close_sql.startswith("update ifc_guid_history set valid_until = now()")
    assert "valid_until is null" in close_sql
    assert "ifc_guid <> %s" in close_sql
    assert close_params == ("uuid-dv-001", "NEW_GUID")

    # 2) až potom insert nového aktívneho záznamu
    assert insert_sql.startswith("insert into ifc_guid_history")
    assert insert_params[1] == "uuid-dv-001"
    assert insert_params[2] == "NEW_GUID"
    assert insert_params[4] is None  # valid_until NULL = aktívny


def test_closed_record_does_not_touch_active_row() -> None:
    """Historický (už uzavretý) záznam nesmie zavrieť aktuálne aktívny GUID."""
    cur = StubCursor()
    model = _model(
        GuidHistory(
            object_ref="DV-001",
            ifc_guid="OLD_GUID",
            valid_until="2026-01-01T00:00:00Z",
            source="manuálna korekcia",
        )
    )
    _load_guid_history(cur, model, {"DV-001": "uuid-dv-001"})

    assert len(cur.calls) == 1
    insert_sql, _ = cur.calls[0]
    assert insert_sql.startswith("insert into ifc_guid_history")
