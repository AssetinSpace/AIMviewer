"""Load vrstva — idempotentný upsert staged modelu do Supabase Postgresu (D-031).

Poradie rešpektuje FK závislosti. `objects` sa upsertujú cez `object_ref`
(`id` ostáva DB-generované, verné D-010); ostatné tabuľky bez prirodzeného
unique používajú deterministické UUID (`ids.py`). Všetko v jednej transakcii.
"""

from __future__ import annotations

import psycopg
from psycopg.types.json import Json

from . import ids
from .model import StagedModel

# edge_type → (tabuľka, či má stĺpec `role`)
_EDGE_TABLES = {
    "located_in": ("rel_located_in", False),
    "defined_by_type": ("rel_defined_by_type", False),
    "member_of": ("rel_member_of", True),
    "has_document": ("rel_has_document", True),
    "responsible_for": ("rel_responsible_for", True),
}


def load_model(url: str, model: StagedModel) -> None:
    """Zapíše celý staged model v jednej transakcii (commit na konci)."""
    with psycopg.connect(url) as conn:
        with conn.cursor() as cur:
            sys_ids = _load_systems(cur, model)
            ref_ids = _load_refs(cur, model, sys_ids)
            obj_ids = _load_objects(cur, model)
            _load_appendices(cur, model, obj_ids)
            _load_guid_history(cur, model, obj_ids)
            _load_edges(cur, model, obj_ids)
            _load_class_links(cur, model, obj_ids, ref_ids)
        conn.commit()


def _load_systems(cur, model: StagedModel) -> dict[str, str]:
    out: dict[str, str] = {}
    for s in model.systems:
        sid = ids.system_id(s.name)
        cur.execute(
            """
            insert into classification_systems
              (id, name, source, edition, edition_date, location)
            values (%s, %s, %s, %s, %s, %s)
            on conflict (id) do update set
              name = excluded.name, source = excluded.source,
              edition = excluded.edition, edition_date = excluded.edition_date,
              location = excluded.location, updated_at = now()
            """,
            (sid, s.name, s.source, s.edition, s.edition_date, s.location),
        )
        out[s.name] = sid
    return out


def _load_refs(cur, model: StagedModel, sys_ids: dict[str, str]) -> dict[tuple[str, str], str]:
    out: dict[tuple[str, str], str] = {}
    for r in model.refs:
        system_id = sys_ids[r.system_name]
        row = cur.execute(
            """
            insert into classification_references
              (system_id, identification, name, location)
            values (%s, %s, %s, %s)
            on conflict (system_id, identification) do update set
              name = excluded.name, location = excluded.location, updated_at = now()
            returning id
            """,
            (system_id, r.identification, r.name, r.location),
        ).fetchone()
        out[(r.system_name, r.identification)] = row[0]
    return out


def _load_objects(cur, model: StagedModel) -> dict[str, str]:
    """Upsert `objects` cez object_ref; vráti mapu object_ref → DB id."""
    out: dict[str, str] = {}
    for o in model.objects:
        if not o.object_ref:
            raise ValueError(f"objekt bez object_ref (typ {o.object_type}) — D-031 vyžaduje stabilný ref")
        row = cur.execute(
            """
            insert into objects
              (object_type, object_ref, name, ifc_guid, ifc_type,
               predefined_type, user_defined_type, properties)
            values (%s, %s, %s, %s, %s, %s, %s, %s)
            on conflict (object_ref) do update set
              object_type = excluded.object_type, name = excluded.name,
              ifc_guid = excluded.ifc_guid, ifc_type = excluded.ifc_type,
              predefined_type = excluded.predefined_type,
              user_defined_type = excluded.user_defined_type,
              properties = excluded.properties, updated_at = now()
            returning id
            """,
            (
                o.object_type, o.object_ref, o.name, o.ifc_guid, o.ifc_type,
                o.predefined_type, o.user_defined_type, Json(o.properties or {}),
            ),
        ).fetchone()
        out[o.object_ref] = row[0]
    return out


def _load_appendices(cur, model: StagedModel, obj_ids: dict[str, str]) -> None:
    for o in model.objects:
        oid = obj_ids[o.object_ref]
        if o.elevation is not None:
            cur.execute(
                "insert into floors (id, elevation) values (%s, %s) "
                "on conflict (id) do update set elevation = excluded.elevation",
                (oid, o.elevation),
            )
        if o.document is not None:
            d = o.document
            cur.execute(
                """
                insert into documents
                  (id, identification, description, location, purpose, revision,
                   document_owner, status, valid_from, valid_until)
                values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                on conflict (id) do update set
                  identification = excluded.identification, description = excluded.description,
                  location = excluded.location, purpose = excluded.purpose,
                  revision = excluded.revision, document_owner = excluded.document_owner,
                  status = excluded.status, valid_from = excluded.valid_from,
                  valid_until = excluded.valid_until
                """,
                (
                    oid, d.identification, d.description, d.location, d.purpose,
                    d.revision, d.document_owner, d.status, d.valid_from, d.valid_until,
                ),
            )
        if o.person is not None:
            p = o.person
            cur.execute(
                """
                insert into persons (id, given_name, family_name, email, phone)
                values (%s, %s, %s, %s, %s)
                on conflict (id) do update set
                  given_name = excluded.given_name, family_name = excluded.family_name,
                  email = excluded.email, phone = excluded.phone
                """,
                (oid, p.given_name, p.family_name, p.email, p.phone),
            )


def _load_guid_history(cur, model: StagedModel, obj_ids: dict[str, str]) -> None:
    for g in model.guid_history:
        hid = ids.guid_history_id(g.object_ref, g.ifc_guid)
        cur.execute(
            """
            insert into ifc_guid_history
              (id, object_id, ifc_guid, valid_from, valid_until, source)
            values (%s, %s, %s, %s, %s, %s)
            on conflict (id) do update set
              valid_from = excluded.valid_from, valid_until = excluded.valid_until,
              source = excluded.source
            """,
            (hid, obj_ids[g.object_ref], g.ifc_guid, g.valid_from, g.valid_until, g.source),
        )


def _load_edges(cur, model: StagedModel, obj_ids: dict[str, str]) -> None:
    for e in model.edges:
        table, has_role = _EDGE_TABLES[e.edge_type]
        eid = ids.edge_id(e.from_ref, e.to_ref, e.edge_type)
        from_id, to_id = obj_ids[e.from_ref], obj_ids[e.to_ref]
        if has_role:
            cur.execute(
                f"""
                insert into {table}
                  (id, from_id, to_id, role, valid_from, valid_until, source)
                values (%s, %s, %s, %s, %s, %s, %s)
                on conflict (id) do update set
                  role = excluded.role, valid_from = excluded.valid_from,
                  valid_until = excluded.valid_until, source = excluded.source
                """,
                (eid, from_id, to_id, e.role, e.valid_from, e.valid_until, e.source),
            )
        else:
            cur.execute(
                f"""
                insert into {table}
                  (id, from_id, to_id, valid_from, valid_until, source)
                values (%s, %s, %s, %s, %s, %s)
                on conflict (id) do update set
                  valid_from = excluded.valid_from, valid_until = excluded.valid_until,
                  source = excluded.source
                """,
                (eid, from_id, to_id, e.valid_from, e.valid_until, e.source),
            )


def _load_class_links(
    cur, model: StagedModel, obj_ids: dict[str, str], ref_ids: dict[tuple[str, str], str]
) -> None:
    for c in model.class_links:
        ref_id = ref_ids[(c.system_name, c.identification)]
        cid = ids.edge_id(c.from_ref, f"{c.system_name}:{c.identification}", "has_classification")
        cur.execute(
            """
            insert into rel_has_classification
              (id, from_id, to_id, valid_from, valid_until, source)
            values (%s, %s, %s, %s, %s, %s)
            on conflict (id) do update set
              valid_from = excluded.valid_from, valid_until = excluded.valid_until,
              source = excluded.source
            """,
            (cid, obj_ids[c.from_ref], ref_id, c.valid_from, c.valid_until, c.source),
        )
