"""Dokumentová naming convention — CDE štandard (D-036).

Pri prvkoch je identity spine `object_ref` (`scheme.py`); pri dokumentoch je ním
**naming convention**. Názov informačného kontajnera nesie metadáta v pevných
**pozičných poliach** oddelených `_`; tento modul ho rozseká na `DocumentMeta`
(rovnaký princíp ako `scheme.py` skladá `object_ref`).

Konvencia preberá **reálny CDE štandard** (Jihočeský kraj, „Standard CDE — Společné
datové prostředí", ISO 19650 línia), nie generické ISO — slovník kódov je hotový a
autoritatívny. Iný projekt = iný slovník v tomto súbore, kód sa nemení (línia D-033).

Skladba (7 pozícií, oddeľovač `_`):

    Projekt _ StupeňPD _ ČástDíla _ Profese _ TypSouboru _ Číslo _ Popis
     OCB    _  DPS     _  SO01    _  ARS    _  VD        _ 101   _ Pudorys-1NP

Pravidlá zápisu (z CDE): premenlivá dĺžka pozícií; bez diakritiky; kódy VEĽKÝMI
(okrem Popisu); chýbajúci údaj → zástupný `X`; v Popise medzery/bodky → `-`,
max 20 znakov.

**Väzba dokument↔uzol nie je v názve** (CDE nemá pole pre podlažie) — rieši ju
explicitný stĺpec `target_ref` v manifeste `docs.csv` (D-036). Tu len parsujeme
metadáta a odvodzujeme `role` z `Typ souboru`.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

DELIMITER = "_"
PLACEHOLDER = "X"          # CDE: chýbajúci údaj na pozícii
N_POSITIONS = 7

# Pozície (poradie = poradie v názve).
POS_PROJECT = "project"
POS_STAGE = "stage"           # Stupeň PD
POS_PART = "part"             # Část Díla
POS_DISCIPLINE = "discipline" # Profese
POS_TYPE = "doc_type"         # Typ souboru
POS_NUMBER = "number"
POS_DESCRIPTION = "description"


# ── Slovníky kódov (CDE — diagnostické labely; iný projekt = iný slovník) ──────

# Stupeň PD — fáza dokumentácie (mapuje náš ŽC „návrh → výstavba → prevádzka").
STAGES: dict[str, str] = {
    "ADS": "Architektonicko-dispozičná štúdia",
    "DPZ": "Dokumentácia pre povolenie zámeru",
    "DPS": "Dokumentácia pre prevedenie stavby",
    "DSPS": "Dokumentácia skutočného prevedenia",
    "PAS": "Pasportná dokumentácia",
    "XX": "Obecný dokument (mimo stupňa PD)",
}

# Profese — odbor (z dátového štandardu projektu, potvrdí BEP).
DISCIPLINES: dict[str, str] = {
    "ARS": "Architektúra / pozemné staviteľstvo",
    "STA": "Statika",
    "TZB": "Technika prostredia budov",
    "VZT": "Vzduchotechnika",
    "ZTI": "Zdravotechnika",
    "ELT": "Elektroinštalácie / FVE",
    "POZ": "Požiarna bezpečnosť",
    "STF": "Stavebná fyzika",
    "XX": "Neurčené",
}

# Typ souboru — forma dokumentu (výber z CDE relevantný pre stavebnú dokumentáciu).
DOC_TYPES: dict[str, str] = {
    "VD": "Výkresová dokumentácia",
    "RP": "Report, správa",
    "SP": "Špecifikácia",
    "TL": "Technický list",
    "VV": "Výkaz výmer",
    "KAL": "Kalkulácie, výpočty",
    "SC": "Schéma",
    "DiMS": "Digitálny model stavby",
    "TP": "Technologický predpis",
    "ST": "Štúdia",
    "TAB": "Tabuľka, databáza",
    "XX": "Neurčené",
}

# ISO 19650 stavy — do `documents.status` (NIE do názvu, D-036).
STATUSES: dict[str, str] = {
    "WIP": "Rozpracované (work in progress)",
    "S1": "Zdieľané — vhodné pre koordináciu",
    "S2": "Zdieľané — vhodné pre informovanie",
    "S3": "Zdieľané — interná kontrola",
    "S4": "Zdieľané — vhodné na schválenie",
    "A1": "Publikované — schválené a podpísané",
    "B1": "Publikované — čiastočne podpísané",
    "AB": "Skutočné prevedenie (as-built)",
}

# `rel_has_document.role` odvodené z Typ souboru (D-014 / object-type.ts vocab).
# Typ je forma kontajnera; rola je *vzťah* dokumentu k uzlu. Mapovanie je 1:N-bezpečné
# (viacero typov môže mať rovnakú rolu) a default = "document".
_TYPE_TO_ROLE: dict[str, str] = {
    "VD": "drawing",
    "RP": "report",
    "SP": "specification",
    "TL": "datasheet",
    "VV": "schedule",
    "KAL": "calculation",
    "SC": "diagram",
    "DiMS": "model",
    "TP": "specification",
    "ST": "study",
    "TAB": "schedule",
}
DEFAULT_ROLE = "document"


@dataclass(frozen=True)
class DocumentMeta:
    """Rozparsované pozičné polia názvu + odvodené hodnoty (D-036)."""

    project: Optional[str]
    stage: Optional[str]
    part: Optional[str]
    discipline: Optional[str]
    doc_type: Optional[str]
    number: Optional[str]
    description: Optional[str]
    container_name: str       # pôvodný (rekonštruovaný) názov bez prípony

    @property
    def role(self) -> str:
        """`rel_has_document.role` z Typ souboru (fallback `document`)."""
        if not self.doc_type:
            return DEFAULT_ROLE
        return _TYPE_TO_ROLE.get(self.doc_type, DEFAULT_ROLE)

    @property
    def stage_label(self) -> Optional[str]:
        return STAGES.get(self.stage) if self.stage else None

    @property
    def discipline_label(self) -> Optional[str]:
        return DISCIPLINES.get(self.discipline) if self.discipline else None

    @property
    def type_label(self) -> Optional[str]:
        return DOC_TYPES.get(self.doc_type) if self.doc_type else None

    def human_description(self) -> Optional[str]:
        """Popis s `-` → medzery (pre `objects.name` / `documents.description`)."""
        if not self.description:
            return None
        return self.description.replace("-", " ").strip() or None

    def unknown_codes(self) -> list[str]:
        """Kódy mimo slovníka — vstup do validačného reportu (mini-IDS)."""
        bad: list[str] = []
        if self.stage and self.stage not in STAGES:
            bad.append(f"StupeňPD={self.stage}")
        if self.discipline and self.discipline not in DISCIPLINES:
            bad.append(f"Profese={self.discipline}")
        if self.doc_type and self.doc_type not in DOC_TYPES:
            bad.append(f"TypSouboru={self.doc_type}")
        return bad


def _norm(value: str) -> Optional[str]:
    """Prázdne / zástupné `X` → None; inak orezané."""
    value = value.strip()
    if not value or value == PLACEHOLDER:
        return None
    return value


def parse_container_name(name: str) -> DocumentMeta:
    """Rozseká názov kontajnera (bez prípony) na `DocumentMeta`.

    Tolerantný k medzerám okolo `_` (zdroj ich občas má: `CMSP_DPZ _SO01_...`).
    Chýbajúce koncové pozície ostávajú None (kratší názov = menej polí); polia
    navyše (Popis s `_`) sa nezlučujú — Popis je posledná pozícia, takže prípadné
    ďalšie `_` v popise spojíme späť.
    """
    stem = name.rsplit(".", 1)[0] if "." in name else name
    raw = [p.strip() for p in stem.split(DELIMITER)]
    # Popis (7. pozícia) môže obsahovať `_`? CDE hovorí „slová oddelené `-`", takže
    # nie — ale pre robustnosť zvyšok zlepíme do Popisu.
    if len(raw) > N_POSITIONS:
        raw = raw[: N_POSITIONS - 1] + [DELIMITER.join(raw[N_POSITIONS - 1 :])]
    raw += [""] * (N_POSITIONS - len(raw))   # doplň chýbajúce pozície

    project, stage, part, discipline, doc_type, number, description = raw[:N_POSITIONS]
    return DocumentMeta(
        project=_norm(project),
        stage=_norm(stage),
        part=_norm(part),
        discipline=_norm(discipline),
        doc_type=_norm(doc_type),
        number=_norm(number),
        description=_norm(description),
        container_name=DELIMITER.join(
            p if p else PLACEHOLDER for p in raw[:N_POSITIONS]
        ),
    )


def build_container_name(
    *,
    project: str,
    stage: str = PLACEHOLDER,
    part: str = PLACEHOLDER,
    discipline: str = PLACEHOLDER,
    doc_type: str = PLACEHOLDER,
    number: str = PLACEHOLDER,
    description: str = PLACEHOLDER,
) -> str:
    """Poskladá kanonický názov kontajnera podľa CDE (D-036).

    Popis sa očistí (medzery/bodky → `-`, max 20 znakov); ostatné pozície VEĽKÝMI.
    """
    def clean_desc(d: str) -> str:
        d = d.strip().replace(" ", "-").replace(".", "-")
        return d[:20].strip("-")

    positions = [
        project.upper(),
        stage.upper(),
        part.upper(),
        discipline.upper(),
        doc_type,                       # DiMS má malé písmená — zachovať as-is
        number,
        clean_desc(description),
    ]
    return DELIMITER.join(p if p else PLACEHOLDER for p in positions)
