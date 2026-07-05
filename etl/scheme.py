"""Coding scheme — field-source resolver + projektová SNIM definícia (D-033).

`object_ref` (D-010 vrstva 2) sa **skladá z kódovacej schémy projektu**, nie z IFC
`Tag` (Revit interné číslo, napr. `959314` — nestabilné, nepoužiteľné na párovanie
s výkresmi). Schéma je sada usporiadaných **typovaných polí + delimiterov**; každé
pole má **deskriptor zdroja** (`from`), voliteľný `extract` (regex) a `format` (pad/
case/trim). Tá istá definícia poháňa extrakciu (ETL: odkiaľ čítať) aj — neskôr —
validáciu (IDS). Žiadny nový klasifikačný/kódovací systém nevyžaduje zmenu kódu, len
inú definíciu schémy → **mimo tohto súboru sa nič SNIM-špecifické nehardcoduje**.

Zistené z reálneho IFC diplomky (`Office centrum Brno.ifc`) a `SNIM - Hierarchia.pdf`:
  • SNIM kód má 6 pozícií: TSP·PSP | (delim) | UOT | (delim) | INST.
  • Zdroj kódu je **IFC `Name` prvku** — vyčistený re-export (2026-07-02) doň zapečie
    plný zložený kód `TSP·PSP[.UOT[.INST]]` (dvere `DD02.05.04`, okno `LP01.44`,
    stena `SN07`). Segmenty čítame z `Name` cez `extract` regex. (Do 2026-06 to boli
    tri samostatné properties `Assembly Code`/`Type Mark`/`Mark` naprieč psetmi; nový
    export ich už neexportuje, ale výstup schémy je identický — viď `_snim_parts`.)
  • **Kategóriu (TSP) určuje prefix kódu z `Name`, NIE IFC trieda ani názov psetu** —
    napr. fasáda `FS*` aj strecha `ST*` sa v modeli vyskytujú na `IfcWall`. Kategóriu
    rozlišujeme podľa TSP (prvé 2 znaky kódu).
  • **Typové entity (`IfcDoorType`…)** — type-level kód (TSP·PSP[.UOT]) sa odvodí z
    kódu occurrence (rieši `transform.py`); inštancia pridá `.INST`.
  • Prvky bez SNIM kódu v `Name` (VZT terminály `60`, nevyčistené `Fascia:Atika:…`)
    regex nezmatchuje → `object_ref` padne na GUID (správne — netlačí sa fiktívny kód).

Skladba kódu (overené dvere): `Name=DD02.05.04` ⇒ TSP·PSP `DD02`, UOT `05`, INST `04`
⇒ type `DD02.05`, inštancia `DD02.05.04`. Číselné segmenty sa zero-padujú (min. šírka).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

# Úrovne kódu — type-level pole tvorí `asset_type` ref, instance-level dopĺňa `asset`.
TYPE = "type"
INSTANCE = "instance"


# ── Field-source resolver (projektovo-nezávislý) ──────────────────────────────


@dataclass(frozen=True)
class Field:
    """Deskriptor jedného poľa kódu — odkiaľ a ako prečítať jeho hodnotu (D-033).

    `source`:
      • ``property``       — pomenovaný pset (`pset=`) alebo naprieč všetkými (`pset=None`)
      • ``attribute``      — IFC atribút (`Name`/`Tag`/`ObjectType`/`Description`/…)
      • ``classification`` — identifikátor referencie systému `key` (system+identification)
      • ``type_property``  — property z `IfcTypeObject` (pset na type)
    `extract` — regex s jednou capture skupinou (kód zapečený v texte, napr. `…CC:DD02.05`).
    `pad`     — **minimálna** šírka zero-paddingu číselného poľa (nikdy neoreže dlhšiu hodnotu).
    """

    source: str
    key: str
    pset: Optional[str] = None
    extract: Optional[str] = None
    pad: Optional[int] = None
    case: Optional[str] = None          # "upper" | "lower" | None
    trim: bool = True


@dataclass
class FieldContext:
    """Predčítané dáta jednej entity — drží resolver čistý a testovateľný.

    `transform.py` ho naplní cez ifcopenshell; resolver tu nezávisí od ifcopenshell.
    """

    psets: dict[str, dict[str, Any]] = field(default_factory=dict)        # occurrence (+inherited)
    type_psets: dict[str, dict[str, Any]] = field(default_factory=dict)   # IfcTypeObject psets
    attrs: Callable[[str], Any] = lambda _name: None                      # IFC atribút
    classifications: list[tuple[str, str]] = field(default_factory=list)  # (system, identification)


def _scan_psets(psets: dict[str, dict[str, Any]], pset: Optional[str], key: str) -> Any:
    """Hodnota property `key`: z pomenovaného psetu, inak naprieč všetkými (prvá zhoda)."""
    if pset is not None:
        block = psets.get(pset)
        if isinstance(block, dict) and block.get(key) not in (None, ""):
            return block.get(key)
        # named pset chýba/nemá pole → fallback na sken všetkých (robustné voči anomáliám)
    for block in psets.values():
        if isinstance(block, dict) and block.get(key) not in (None, ""):
            return block.get(key)
    return None


def _raw_value(spec: Field, ctx: FieldContext) -> Any:
    if spec.source == "property":
        return _scan_psets(ctx.psets, spec.pset, spec.key)
    if spec.source == "type_property":
        return _scan_psets(ctx.type_psets, spec.pset, spec.key)
    if spec.source == "attribute":
        return ctx.attrs(spec.key)
    if spec.source == "classification":
        for system, identification in ctx.classifications:
            if system == spec.key:
                return identification
        return None
    raise ValueError(f"Neznámy field source: {spec.source!r}")


def resolve_field(spec: Field, ctx: FieldContext) -> Optional[str]:
    """Vráti naformátovanú textovú hodnotu poľa, alebo None ak chýba."""
    raw = _raw_value(spec, ctx)
    if raw is None:
        return None
    text = str(raw)
    if spec.trim:
        text = text.strip()
    if not text:
        return None
    if spec.extract:
        match = re.search(spec.extract, text)
        if not match:
            return None
        text = match.group(1) if match.groups() else match.group(0)
    if spec.pad and text.isdigit():
        text = text.zfill(spec.pad)        # minimálna šírka — dlhšie hodnoty ostávajú
    if spec.case == "upper":
        text = text.upper()
    elif spec.case == "lower":
        text = text.lower()
    return text or None


# ── Zložený kód (object_ref) ──────────────────────────────────────────────────


@dataclass(frozen=True)
class CodePart:
    """Jedna pozícia zloženého `object_ref`. `level=INSTANCE` patrí len do asset refu."""

    field: Field
    level: str = TYPE


@dataclass
class ElementScheme:
    """Definícia jednej kategórie kódovacej schémy (napr. SNIM „Dvere")."""

    tsp: str                          # kľúč kategórie = prefix Assembly Code (napr. "DD")
    label: str                        # ľudský názov ("Dvere")
    applies_to: tuple[str, ...]       # IFC triedy, kde sa kód očakáva (mini-IDS applicability)
    parts: tuple[CodePart, ...]
    delimiter: str = "."

    def _join(self, ctx: FieldContext, max_level: str) -> tuple[Optional[str], list[str]]:
        """Poskladá kód po `max_level`. Vráti (kód|None, chýbajúce_polia).

        Type-level pole je povinné (bez neho niet kódu). Instance-level pole, ktoré
        chýba pri `max_level=INSTANCE`, znamená „kód neúplný" → None + dôvod.
        """
        out: list[str] = []
        missing: list[str] = []
        for part in self.parts:
            if part.level == INSTANCE and max_level != INSTANCE:
                continue
            value = resolve_field(part.field, ctx)
            if value is None:
                missing.append(part.field.key)
                if part.level == INSTANCE:
                    return None, missing      # chýbajúci INST = neúplný inštančný kód
                continue                      # voliteľné type pole (napr. chýbajúci UOT)
            out.append(value)
        if not out:
            return None, missing
        return self.delimiter.join(out), missing


@dataclass(frozen=True)
class ScopePolicy:
    """Rozsah importu (D-034) — ktoré IFC elementy sa stávajú `asset`.

    Princíp D-034: *„asset = to, na čo máme vypísanú informačnú požiadavku."*
    Štruktúrne kritérium (IFC-natívne, nezávislé od kvality kódovania):
      • asset = **top-level** prvok (visí priamo v priestore: `get_aggregate` =
        priestor/None) — reálne spravovateľné celky (steny, dvere, strechy, dosky,
        VZT terminály, stĺpy, podhľady, fasáda ako celok, schody, nábytok);
      • vyhodené sú **voidy** (`IfcFeatureElement` = otvory) a **sub-komponenty**
        (vnorené prvky — stĺpiky/výplne/panely fasády, vrstvy strechy, ramená schodov);
      • **výnimka:** vnorené `IfcDoor`/`IfcWindow`/`IfcRailing` ostávajú asset — funkčne
        sú samostatné prvky napriek vnoreniu. `IfcRailing` doplnené (D-034 dodatok):
        zábradlia/madlá (ZV) a tieniaca technika (TV) sú modelované vnorené v `IfcStair`,
        ale nesú vlastný SNIM kód a informačnú požiadavku — rovnaký dôvod ako dvere/okná.
        Naopak `IfcSlab` (vrstvy strechy, ST) a `IfcStairFlight` (ramená, SH) zostávajú
        vylúčené — tie sú reálne sub-komponenty zostavy (typy ST01.* sú už z `IfcRoof`).

    Definované ako **policy (config), nie hardcode v `transform.py`** — iný projekt
    = iná policy (línia D-033/D-034). Resolver nezávisí od ifcopenshell: dostáva
    `is_a` callable (IFC inheritance check) + príznak `top_level`.
    """

    exclude_classes: tuple[str, ...] = ("IfcFeatureElement",)   # otvory/voidy — nikdy asset
    # funkčne samostatné prvky aj vnorené (osadené vo fasáde / v schodisku)
    nested_keep: tuple[str, ...] = ("IfcDoor", "IfcWindow", "IfcRailing")
    # MEP „grouping" (D-049): prvky, kde nezáleží na inštancii — importujú sa ako asset,
    # ale NEdostávajú priestorové containment (nezahltia strom); sú len členmi systému
    # (rel_assigns_to_group). Potrubie/tvarovky/rozvody. Instančne-relevantné MEP prvky
    # (air terminals, VZT jednotky) sem NEpatria → dostanú podlažie normálne.
    group_only: tuple[str, ...] = (
        "IfcDuctSegment", "IfcDuctFitting",
        "IfcPipeSegment", "IfcPipeFitting",
        "IfcCableSegment", "IfcCableFitting", "IfcCableCarrierSegment", "IfcCableCarrierFitting",
    )

    def is_asset(self, is_a: Callable[[str], bool], top_level: bool) -> bool:
        if any(is_a(cls) for cls in self.exclude_classes):
            return False
        if top_level:
            return True
        return any(is_a(cls) for cls in self.nested_keep)

    def is_group_only(self, is_a: Callable[[str], bool]) -> bool:
        """Prvok sa importuje, ale bez priestorového containmentu (len člen systému, D-049)."""
        return any(is_a(cls) for cls in self.group_only)


@dataclass
class CodingScheme:
    """Projektová schéma: ako rozpoznať kategóriu a poskladať `object_ref`."""

    name: str
    discriminator: Field              # číta surový kód identifikujúci kategóriu (1. segment Name)
    discriminator_len: int            # koľko znakov tvorí TSP kľúč (SNIM = 2)
    categories: dict[str, ElementScheme]
    scope: ScopePolicy = field(default_factory=ScopePolicy)   # rozsah importu (D-034)

    def applicable_classes(self) -> set[str]:
        """Zjednotenie `applies_to` — IFC triedy, kde sa kód SNIM vôbec očakáva."""
        classes: set[str] = set()
        for cat in self.categories.values():
            classes.update(cat.applies_to)
        return classes

    def category_for(self, ctx: FieldContext) -> tuple[Optional[ElementScheme], Optional[str]]:
        """Nájde kategóriu podľa TSP prefixu. Vráti (kategória|None, tsp|None)."""
        raw = resolve_field(self.discriminator, ctx)
        if not raw:
            return None, None
        tsp = raw[: self.discriminator_len]
        return self.categories.get(tsp), tsp


# ── SNIM definícia projektu „Office centrum Brno" ─────────────────────────────
#
# Všetky SNIM kategórie zdieľajú rovnakú skladbu (TSP·PSP [type] + UOT [type] + INST
# [instance]); líšia sa TSP, ľudským názvom a `applies_to`. Všetky tri segmenty čítame
# z IFC `Name` cez `extract` regex — plný kód je zapečený tam (napr. `DD02.05.04`).
#
# Padding (D-033 otvorená otázka — INST šírka per výkres): UOT aj INST = min. šírka 2
# (overené na dverách `DD02.05.04`; `pad` neoreže dlhšie hodnoty). Per pole upraviteľné.

_TSP_PSP = r"[A-Z]{2}\d{2}"                                       # 1. segment, napr. DD02, SN07
# Diskriminátor = 1. segment kódu z Name (TSP·PSP); category_for berie prvé 2 znaky (TSP).
_ASSEMBLY_CODE = Field(source="attribute", key="Name", extract=rf"^({_TSP_PSP})")
_UOT_PAD = 2
_INST_PAD = 2


def _snim_parts() -> tuple[CodePart, ...]:
    # Segmenty kódu z `Name`: `DD02.05.04` → TSP·PSP `DD02`, UOT `05`, INST `04`.
    return (
        CodePart(_ASSEMBLY_CODE, level=TYPE),
        CodePart(Field(source="attribute", key="Name", extract=rf"^{_TSP_PSP}\.(\d+)", pad=_UOT_PAD), level=TYPE),
        CodePart(Field(source="attribute", key="Name", extract=rf"^{_TSP_PSP}\.\d+\.(\d+)", pad=_INST_PAD), level=INSTANCE),
    )


def _snim_category(tsp: str, label: str, applies_to: tuple[str, ...]) -> ElementScheme:
    return ElementScheme(tsp=tsp, label=label, applies_to=applies_to, parts=_snim_parts())


# `applies_to` = IFC triedy, na ktorých sa daný TSP v modeli reálne vyskytuje
# (overené skenom ASR IFC) + zmysluplné podľa `SNIM - Hierarchia.pdf` /
# `SNIM - Výpis skladieb.pdf`. Slúži ako mini-IDS applicability pre coverage report;
# samotná tvorba kódu beží podľa TSP prefixu (naprieč psetmi), nezávisle od triedy.
#
# Kategórie z `SNIM - Hierarchia.pdf` (8): DD, SN, FS, PH, ST, PD, ZV, KV.
# Doplnené z `SNIM - Výpis skladieb.pdf` + skenu ASR (E2): OV, PL, ZD, DZ, SD, VT,
# SH, LP, IH, TV. Label je diagnostický (coverage report); object.name vo Vieweri
# ide z IFC Name, nie odtiaľto. Skladba kódu je rovnaká pre všetky (Assembly Code
# [type] + Type Mark [type/UOT] + Mark [instance/INST]); väčšina kategórií nemá
# `Mark` → inštancia ide na GUID fallback (správne — netlačí sa inštančný tag).
SNIM = CodingScheme(
    name="SNIM — Office centrum Brno (diplomka)",
    discriminator=_ASSEMBLY_CODE,
    discriminator_len=2,
    categories={
        # — z Hierarchia.pdf —
        "DD": _snim_category("DD", "Dvere", ("IfcDoor",)),
        "SN": _snim_category("SN", "Steny", ("IfcWall",)),
        "PD": _snim_category("PD", "Podlahy", ("IfcSlab",)),
        "SL": _snim_category("SL", "Stĺpy", ("IfcColumn",)),
        "PH": _snim_category("PH", "Podhľady", ("IfcCovering",)),
        "ST": _snim_category("ST", "Strechy", ("IfcRoof", "IfcSlab", "IfcWall")),
        "FS": _snim_category(
            "FS", "Fasádny systém",
            ("IfcWall", "IfcSlab", "IfcCurtainWall", "IfcMember", "IfcPlate"),
        ),
        "ZV": _snim_category(
            "ZV", "Zámočnícke výrobky",
            ("IfcRailing", "IfcStair", "IfcStairFlight", "IfcBuildingElementProxy"),
        ),
        "KV": _snim_category(
            "KV", "Klampiarske výrobky",
            ("IfcPlate", "IfcCovering", "IfcBuildingElementProxy"),
        ),
        # — doplnené v E2 (Výpis skladieb + sken ASR) —
        "OV": _snim_category(
            "OV", "Otvorové výplne a vybavenie",
            ("IfcFlowTerminal", "IfcFurniture", "IfcCurtainWall"),
        ),
        "PL": _snim_category("PL", "Presklené steny/priečky", ("IfcCurtainWall",)),
        "LP": _snim_category("LP", "Ľahký obvodový plášť (LOP)", ("IfcCurtainWall", "IfcWindow")),
        "ZD": _snim_category("ZD", "Základové dosky", ("IfcSlab", "IfcWall")),
        "DZ": _snim_category("DZ", "Podkladný betón", ("IfcSlab", "IfcWall")),
        "SD": _snim_category("SD", "Stropné dosky", ("IfcSlab",)),
        "IH": _snim_category("IH", "Hydroizolácie spodnej stavby", ("IfcWall", "IfcSlab")),
        "VT": _snim_category("VT", "Vráta", ("IfcDoor",)),
        "SH": _snim_category("SH", "Schodiská", ("IfcStair", "IfcStairFlight", "IfcSlab")),
        "TV": _snim_category("TV", "Tieniaca technika", ("IfcRailing", "IfcBuildingElementProxy")),
    },
)
"""Aktívna schéma projektu. Iný projekt = iná `CodingScheme` (kód sa nemení)."""
