"""Medziľahlý (staged) dátový model — výstup `transform.py`, vstup `load.py`.

Zrkadlí SCHEMA.md: centrálne `objects` + tenké prípony + hrany `rel_*` +
klasifikačné referenčné dáta + história GUID. Uzly sa adresujú cez `object_ref`
(konflikt-kľúč pri upserte, D-031); hrany a referenčné dáta cez tieto refy.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional


@dataclass
class DocumentExt:
    identification: Optional[str] = None
    description: Optional[str] = None
    location: Optional[str] = None
    purpose: Optional[str] = None
    revision: Optional[str] = None
    document_owner: Optional[str] = None
    status: Optional[str] = None
    valid_from: Optional[str] = None
    valid_until: Optional[str] = None


@dataclass
class PersonExt:
    given_name: Optional[str] = None
    family_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None


@dataclass
class ObjectRow:
    """Riadok `objects` + voliteľná 1:1 prípona podľa `object_type`."""

    object_ref: str                       # UNIQUE — konflikt-kľúč
    object_type: str                      # 'site','building',…,'asset_type','person',…
    name: Optional[str] = None
    ifc_guid: Optional[str] = None
    ifc_type: Optional[str] = None
    predefined_type: Optional[str] = None
    user_defined_type: Optional[str] = None
    properties: dict[str, Any] = field(default_factory=dict)
    # prípony (max jedna podľa typu):
    elevation: Optional[float] = None     # floor
    document: Optional[DocumentExt] = None
    person: Optional[PersonExt] = None


@dataclass
class Edge:
    """Hrana objekt→objekt (`rel_located_in`/`_defined_by_type`/`_member_of`/
    `_has_document`/`_responsible_for`). `role` len kde to tabuľka má."""

    edge_type: str
    from_ref: str
    to_ref: str
    role: Optional[str] = None
    valid_from: Optional[str] = None
    valid_until: Optional[str] = None
    source: str = "etl"


@dataclass
class ClassificationSystem:
    name: str
    source: Optional[str] = None
    edition: Optional[str] = None
    edition_date: Optional[str] = None
    location: Optional[str] = None


@dataclass
class ClassificationRef:
    system_name: str                      # FK na systém (cez názov)
    identification: str                   # napr. 'Pr_70_65_04'
    name: Optional[str] = None
    location: Optional[str] = None


@dataclass
class ClassLink:
    """`rel_has_classification`: objekt → klasifikačná referencia (D-023)."""

    from_ref: str
    system_name: str
    identification: str
    valid_from: Optional[str] = None
    valid_until: Optional[str] = None
    source: str = "etl"


@dataclass
class GuidHistory:
    object_ref: str
    ifc_guid: str
    valid_from: Optional[str] = None
    valid_until: Optional[str] = None     # NULL = aktívny (= objects.ifc_guid)
    source: Optional[str] = None


@dataclass
class StagedModel:
    objects: list[ObjectRow] = field(default_factory=list)
    edges: list[Edge] = field(default_factory=list)
    class_links: list[ClassLink] = field(default_factory=list)
    systems: list[ClassificationSystem] = field(default_factory=list)
    refs: list[ClassificationRef] = field(default_factory=list)
    guid_history: list[GuidHistory] = field(default_factory=list)

    def summary(self) -> str:
        return (
            f"objects={len(self.objects)} edges={len(self.edges)} "
            f"class_links={len(self.class_links)} systems={len(self.systems)} "
            f"refs={len(self.refs)} guid_history={len(self.guid_history)}"
        )
