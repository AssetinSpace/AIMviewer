"""Otvorenie IFC modelu + nízkoúrovňové helpery (D-031).

Tenká vrstva nad ifcopenshell — drží import lokalizovaný, aby `transform.py`
ostal o mapovaní. Skutočné mapovanie (a jeho doladenie na model diplomky) je
v `transform.py`.
"""

from __future__ import annotations

from typing import Any

import ifcopenshell


def open_model(path: str) -> ifcopenshell.file:
    """Načíta IFC súbor (vyhodí zrozumiteľnú chybu, ak sa nedá)."""
    try:
        return ifcopenshell.open(path)
    except Exception as exc:  # noqa: BLE001 — chceme zrozumiteľnú hlášku
        raise SystemExit(f"Nepodarilo sa otvoriť IFC '{path}': {exc}") from exc


def attr(entity: Any, name: str) -> Any:
    """Bezpečné čítanie IFC atribútu (None ak chýba)."""
    return getattr(entity, name, None)


def schema_version(model: ifcopenshell.file) -> str:
    return getattr(model, "schema", "?")
