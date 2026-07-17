"""Regresné testy guardov hrán v transform.py — hrany dokumentov/aktorov smú
ukazovať len na objekty importované v tomto behu. Bez guardu `refs.ref()`
alokoval ref pre neimportovanú entitu (otvor, sub-komponent, federate spatial
root) a `_resolve_cross_file_refs` rollbackol celý load (ValueError).

Fake entity duck-typujú ifcopenshell rozhranie (`id()`, `is_a()`, atribúty) —
transform k nim pristupuje len cez `extract.attr` a tieto dve metódy.
"""
from __future__ import annotations

from itertools import count

from etl.scheme import SNIM
from etl.transform import _RefAllocator, _collect_actors, _collect_documents
from etl.model import StagedModel

_IDS = count(1)


class FakeEntity:
    def __init__(self, ifc_class: str, **attrs: object) -> None:
        self._ifc_class = ifc_class
        self._id = next(_IDS)
        for key, value in attrs.items():
            setattr(self, key, value)

    def id(self) -> int:
        return self._id

    def is_a(self, cls: str | None = None):
        if cls is None:
            return self._ifc_class
        return cls == self._ifc_class


class FakeModel:
    def __init__(self, entities: list[FakeEntity]) -> None:
        self._entities = entities

    def by_type(self, ifc_class: str) -> list[FakeEntity]:
        return [e for e in self._entities if e.is_a(ifc_class)]


def _staged_refs() -> tuple[_RefAllocator, FakeEntity, FakeEntity]:
    """Alokátor s jedným importovaným prvkom a jedným mimo importu."""
    refs = _RefAllocator(SNIM)
    imported = FakeEntity("IfcDoor", GlobalId="guid-imported", Name="DD02.05.04")
    refs._by_id[imported.id()] = "DD02.05.04"
    outside = FakeEntity("IfcOpeningElement", GlobalId="guid-outside", Name="Otvor 1")
    return refs, imported, outside


def test_collect_documents_skips_objects_outside_import() -> None:
    refs, imported, outside = _staged_refs()
    doc_info = FakeEntity("IfcDocumentInformation", Name="Výkres A")
    assoc = FakeEntity(
        "IfcRelAssociatesDocument",
        RelatingDocument=doc_info,
        RelatedObjects=(imported, outside),
    )
    staged = StagedModel()

    _collect_documents(FakeModel([assoc]), refs, staged)

    assert [o.object_type for o in staged.objects] == ["document"]
    assert [(e.edge_type, e.from_ref) for e in staged.edges] == [
        ("has_document", "DD02.05.04")
    ]
    # Guard nesmie ref alokovať ani ako vedľajší efekt — inak by neskorší
    # `refs.ref()` vrátil dangling ref bez staged objektu.
    assert outside.id() not in refs._by_id


def test_collect_actors_skips_objects_outside_import() -> None:
    refs, imported, outside = _staged_refs()
    person = FakeEntity("IfcPerson", GivenName="Jana", FamilyName="Nováková")
    actor = FakeEntity("IfcActor", TheActor=person)
    rel = FakeEntity(
        "IfcRelAssignsToActor",
        RelatingActor=actor,
        RelatedObjects=(imported, outside),
        ActingRole=FakeEntity("IfcActorRole", Role="ARCHITECT"),
    )
    staged = StagedModel()

    _collect_actors(FakeModel([rel]), refs, staged)

    person_rows = [o for o in staged.objects if o.object_type == "person"]
    assert len(person_rows) == 1 and person_rows[0].name == "Jana Nováková"
    assert [(e.edge_type, e.to_ref, e.role) for e in staged.edges] == [
        ("responsible_for", "DD02.05.04", "ARCHITECT")
    ]
    assert outside.id() not in refs._by_id
