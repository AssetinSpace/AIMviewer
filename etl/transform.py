"""Mapovanie IFC → staged model (D-031), podľa SCHEMA.md + CLAUDE konvencií.

Pokrýva štandardné IFC vzory, ktoré schéma modeluje:
  • priestorová hierarchia  Site→Building→Storey→Space  (IfcRelAggregates /
    IfcRelContainedInSpatialStructure)            → objects + rel_located_in
  • elementy (occurrence) + ich typy               → objects(asset/asset_type)
    + rel_defined_by_type (IfcRelDefinesByType)
  • property sety (Pset_/Qto_ = štandard, inak custom) → properties JSONB
  • klasifikácie na type aj occurrence              → classification_* + rel_has_classification
  • dokumenty, aktori (B)                            → documents/persons + rel_*

POZN. (doladiť na model diplomky — D-031 prereq): zdroj `object_ref`
(Tag/Name/GlobalId), ktoré elementy sú „asset", a konkrétne názvy psetov/klasifikácií
sú model-špecifické. Miesta sú označené `TODO(model)`.
"""

from __future__ import annotations

from typing import Any, Optional

import ifcopenshell
import ifcopenshell.util.element as ue

from .extract import attr
from .model import (
    ClassLink,
    ClassificationRef,
    ClassificationSystem,
    DocumentExt,
    Edge,
    GuidHistory,
    ObjectRow,
    PersonExt,
    StagedModel,
)

# IFC priestorové triedy → náš object_type.
_SPATIAL = {
    "IfcSite": "site",
    "IfcBuilding": "building",
    "IfcBuildingStorey": "floor",
    "IfcSpace": "space",
}


class _RefAllocator:
    """Stabilný, unikátny `object_ref`. Preferuje Tag → Name → GlobalId;
    kolízie rieši suffixom. TODO(model): potvrdiť zdroj refu pre diplomku."""

    def __init__(self) -> None:
        self._by_guid: dict[str, str] = {}
        self._used: set[str] = set()

    def ref(self, entity: Any) -> str:
        guid = attr(entity, "GlobalId")
        if guid and guid in self._by_guid:
            return self._by_guid[guid]
        base = attr(entity, "Tag") or attr(entity, "Name") or guid or entity.is_a()
        candidate = str(base)
        i = 2
        while candidate in self._used:
            candidate = f"{base}-{i}"
            i += 1
        self._used.add(candidate)
        if guid:
            self._by_guid[guid] = candidate
        return candidate


def _properties(entity: Any) -> dict[str, Any]:
    """Property sety entity ako vnorený dict (bez ifcopenshell `id` kľúčov).
    Type psety sa NEdedia do occurrence (merge rieši v_asset_effective, D-021)."""
    try:
        psets = ue.get_psets(entity, should_inherit=False)
    except TypeError:  # staršie ifcopenshell bez should_inherit
        psets = ue.get_psets(entity)
    out: dict[str, Any] = {}
    for pset_name, props in (psets or {}).items():
        if not isinstance(props, dict):
            continue
        clean = {k: v for k, v in props.items() if k != "id"}
        if clean:
            out[pset_name] = clean
    return out


def _is_asset(entity: Any) -> bool:
    """Fyzický element s polohou → asset. TODO(model): prípadne zúžiť na konkrétne triedy."""
    return entity.is_a("IfcElement")


def to_staged(model: ifcopenshell.file) -> StagedModel:
    staged = StagedModel()
    refs = _RefAllocator()
    systems_seen: dict[str, ClassificationSystem] = {}
    refs_seen: set[tuple[str, str]] = set()

    def add_object(entity: Any, object_type: str, **extra: Any) -> str:
        ref = refs.ref(entity)
        guid = attr(entity, "GlobalId")
        staged.objects.append(
            ObjectRow(
                object_ref=ref,
                object_type=object_type,
                name=attr(entity, "Name"),
                ifc_guid=guid,
                ifc_type=entity.is_a(),
                predefined_type=_predefined_type(entity),
                user_defined_type=attr(entity, "ObjectType") or attr(entity, "ElementType"),
                properties=_properties(entity),
                **extra,
            )
        )
        # Aktívny GUID = záznam histórie s valid_until NULL.
        if guid:
            staged.guid_history.append(
                GuidHistory(object_ref=ref, ifc_guid=guid, source="IFC import")
            )
        _collect_classifications(entity, ref, staged, systems_seen, refs_seen)
        return ref

    # 1) Priestorová hierarchia + located_in (cez dekompozíciu/containment).
    spatial_refs: dict[int, str] = {}
    for ifc_class, otype in _SPATIAL.items():
        for ent in model.by_type(ifc_class):
            extra = {"elevation": _to_float(attr(ent, "Elevation"))} if otype == "floor" else {}
            spatial_refs[ent.id()] = add_object(ent, otype, **extra)
    for ifc_class in _SPATIAL:
        for ent in model.by_type(ifc_class):
            parent = ue.get_aggregate(ent) or ue.get_container(ent)
            if parent is not None and parent.id() in spatial_refs:
                staged.edges.append(
                    Edge("located_in", spatial_refs[ent.id()], spatial_refs[parent.id()])
                )

    # 2) Typy (asset_type) — IfcTypeObject.
    type_refs: dict[int, str] = {}
    for t in model.by_type("IfcTypeObject"):
        type_refs[t.id()] = add_object(t, "asset_type")

    # 3) Elementy (asset) + located_in + defined_by_type.
    for el in model.by_type("IfcElement"):
        if not _is_asset(el):
            continue
        ref = add_object(el, "asset")
        container = ue.get_container(el)
        if container is not None and container.id() in spatial_refs:
            staged.edges.append(Edge("located_in", ref, spatial_refs[container.id()]))
        el_type = ue.get_type(el)
        if el_type is not None and el_type.id() in type_refs:
            staged.edges.append(Edge("defined_by_type", ref, type_refs[el_type.id()]))

    # 4) Dokumenty + aktori (best-effort, štruktúra je tu — doladiť na model).
    _collect_documents(model, refs, staged)
    _collect_actors(model, refs, staged)

    # Deduplikuj systémy/refy do staged zoznamov.
    staged.systems = list(systems_seen.values())
    staged.refs = [
        ClassificationRef(system_name=s, identification=i, name=None, location=None)
        for (s, i) in refs_seen
    ]
    return staged


def _predefined_type(entity: Any) -> Optional[str]:
    pt = attr(entity, "PredefinedType")
    if pt is None:
        return None
    return str(pt)


def _to_float(value: Any) -> Optional[float]:
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _collect_classifications(
    entity: Any,
    obj_ref: str,
    staged: StagedModel,
    systems_seen: dict[str, ClassificationSystem],
    refs_seen: set[tuple[str, str]],
) -> None:
    """IfcRelAssociatesClassification → systém + referencia + rel_has_classification."""
    for assoc in attr(entity, "HasAssociations") or []:
        if not assoc.is_a("IfcRelAssociatesClassification"):
            continue
        cref = attr(assoc, "RelatingClassification")
        if cref is None or not cref.is_a("IfcClassificationReference"):
            continue
        identification = attr(cref, "Identification") or attr(cref, "ItemReference")
        if not identification:
            continue
        source = attr(cref, "ReferencedSource")
        sys_name = (attr(source, "Name") if source else None) or "Neznámy systém"
        if sys_name not in systems_seen:
            systems_seen[sys_name] = ClassificationSystem(
                name=sys_name,
                source=attr(source, "Source") if source else None,
                edition=attr(source, "Edition") if source else None,
                location=attr(source, "Location") if source else None,
            )
        refs_seen.add((sys_name, str(identification)))
        staged.class_links.append(
            ClassLink(from_ref=obj_ref, system_name=sys_name, identification=str(identification))
        )


def _collect_documents(model: ifcopenshell.file, refs: _RefAllocator, staged: StagedModel) -> None:
    """IfcRelAssociatesDocument → document objekt + rel_has_document. TODO(model)."""
    seen: dict[int, str] = {}
    for assoc in model.by_type("IfcRelAssociatesDocument"):
        info = attr(assoc, "RelatingDocument")
        if info is None:
            continue
        if info.id() not in seen:
            ref = refs.ref(info)
            staged.objects.append(
                ObjectRow(
                    object_ref=ref,
                    object_type="document",
                    name=attr(info, "Name"),
                    document=DocumentExt(
                        identification=attr(info, "Identification"),
                        description=attr(info, "Description"),
                        location=attr(info, "Location"),
                        purpose=attr(info, "Purpose"),
                        revision=attr(info, "Revision"),
                        status=str(attr(info, "Status")) if attr(info, "Status") else None,
                    ),
                )
            )
            seen[info.id()] = ref
        doc_ref = seen[info.id()]
        for obj in attr(assoc, "RelatedObjects") or []:
            obj_guid = attr(obj, "GlobalId")
            if obj_guid:
                staged.edges.append(
                    Edge("has_document", refs.ref(obj), doc_ref, role="document")
                )


def _collect_actors(model: ifcopenshell.file, refs: _RefAllocator, staged: StagedModel) -> None:
    """IfcRelAssignsToActor → person/organization + rel_responsible_for. TODO(model)."""
    for rel in model.by_type("IfcRelAssignsToActor"):
        actor = attr(rel, "RelatingActor")
        if actor is None:
            continue
        the_actor = attr(actor, "TheActor")
        actor_ref = _actor_object(the_actor, refs, staged)
        if actor_ref is None:
            continue
        role = attr(rel, "ActingRole")
        role_name = str(attr(role, "Role")) if role else None
        for obj in attr(rel, "RelatedObjects") or []:
            if attr(obj, "GlobalId"):
                staged.edges.append(
                    Edge("responsible_for", actor_ref, refs.ref(obj), role=role_name or "responsible")
                )


def _actor_object(the_actor: Any, refs: _RefAllocator, staged: StagedModel) -> Optional[str]:
    """IfcPerson / IfcOrganization / IfcPersonAndOrganization → objekt(y) + rel_member_of."""
    if the_actor is None:
        return None
    if the_actor.is_a("IfcPersonAndOrganization"):
        person_ref = _person_object(attr(the_actor, "ThePerson"), refs, staged)
        org_ref = _org_object(attr(the_actor, "TheOrganization"), refs, staged)
        if person_ref and org_ref:
            staged.edges.append(Edge("member_of", person_ref, org_ref))
        return person_ref or org_ref
    if the_actor.is_a("IfcPerson"):
        return _person_object(the_actor, refs, staged)
    if the_actor.is_a("IfcOrganization"):
        return _org_object(the_actor, refs, staged)
    return None


def _person_object(person: Any, refs: _RefAllocator, staged: StagedModel) -> Optional[str]:
    if person is None:
        return None
    ref = refs.ref(person)
    given, family = attr(person, "GivenName"), attr(person, "FamilyName")
    name = " ".join(x for x in (given, family) if x) or None
    staged.objects.append(
        ObjectRow(
            object_ref=ref,
            object_type="person",
            name=name,
            person=PersonExt(given_name=given, family_name=family),
        )
    )
    return ref


def _org_object(org: Any, refs: _RefAllocator, staged: StagedModel) -> Optional[str]:
    if org is None:
        return None
    ref = refs.ref(org)
    staged.objects.append(
        ObjectRow(object_ref=ref, object_type="organization", name=attr(org, "Name"))
    )
    return ref
